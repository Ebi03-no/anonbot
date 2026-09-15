// ---------- Helper ----------
const tg = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

function escapeHtml(t = '') {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function randomCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => chars[b % chars.length]).join('');
}

async function sendMessage(env, chatId, text) {
  return fetch(tg(env.BOT_TOKEN, 'sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  }).then(r => r.json());
}

// نام کاربری ربات را یک‌بار می‌گیریم و در KV کش می‌کنیم
async function getBotUsername(env) {
  let u = await env.CACHE.get('bot_username');
  if (u) return u;
  const res = await fetch(tg(env.BOT_TOKEN, 'getMe')).then(r => r.json());
  u = res.result.username;
  await env.CACHE.put('bot_username', u);
  return u;
}

// ثبت کاربر جدید با کد ناشناس یکتا
async function ensureUser(msg, env) {
  const existing = await env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?')
    .bind(msg.from.id).first();
  if (existing) return existing;

  for (let i = 0; i < 5; i++) {
    const code = randomCode(8);
    try {
      await env.DB.prepare(
        'INSERT INTO users (telegram_id, anon_code, first_name) VALUES (?, ?, ?)'
      ).bind(msg.from.id, code, msg.from.first_name || '').run();
      return { telegram_id: msg.from.id, anon_code: code };
    } catch (e) { /* کد تکراری → دوباره تلاش کن */ }
  }
  throw new Error('create user failed');
}

// ---------- Command Handlers ----------

async function handleStart(msg, env) {
  const user = await ensureUser(msg, env);
  const chatId = msg.chat.id;
  const targetCode = msg.text.split(' ')[1]; // مثلا /start AB12CD34
  const username = await getBotUsername(env);

  // اگر از طریق لینک اختصاصی آمده → شروع گفتگوی ناشناس
  if (targetCode) {
    const target = await env.DB.prepare('SELECT * FROM users WHERE anon_code = ?')
      .bind(targetCode.toUpperCase()).first();

    if (!target) return sendMessage(env, chatId, '❌ چنین کدی پیدا نشد.');
    if (target.telegram_id === msg.from.id)
      return sendMessage(env, chatId, '😅 نمی‌توانی به خودت پیام ناشناس بدهی!');

    await env.CACHE.put(`session:${chatId}`, String(target.telegram_id));
    return sendMessage(env, chatId,
      '🎭 حالا در حال گفتگوی ناشناس هستی.\nهر متنی بنویسی ناشناس برایش ارسال می‌شود.\n\nبرای پایان: /stop');
  }

  // شروع عادی → نمایش لینک اختصاصی
  const link = `https://t.me/${username}?start=${user.anon_code}`;
  await sendMessage(env, chatId,
    `🎭 <b>به ربات پیام ناشناس خوش آمدی!</b>\n\n` +
    `🔗 لینک اختصاصی تو (برای دوستانت بفرست):\n${link}\n\n` +
    `هر کس این لینک را باز کند می‌تواند ناشناس به تو پیام بدهد.\n\n` +
    `/link - نمایش دوباره لینک\n/stop - پایان گفتگو\n/help - راهنما`);
}

async function handleMyLink(msg, env) {
  const user = await ensureUser(msg, env);
  const username = await getBotUsername(env);
  await sendMessage(env, msg.chat.id,
    `🔗 لینک اختصاصی تو:\nhttps://t.me/${username}?start=${user.anon_code}`);
}

// ارسال پیام ناشناس
async function handleUserMessage(msg, env) {
  const chatId = msg.chat.id;
  const session = await env.CACHE.get(`session:${chatId}`);

  if (!session) {
    return sendMessage(env, chatId,
      '🤔 فعلاً در حال گفتگو با کسی نیستی.\nلینک اختصاصی دوستت را باز کن یا /help را بزن.');
  }

  const targetId = Number(session);
  const result = await sendMessage(env, targetId,
    `💌 <b>پیام ناشناس:</b>\n\n${escapeHtml(msg.text)}`);

  if (result.ok) {
    await sendMessage(env, chatId, '✅ پیامت ناشناس ارسال شد.');
    await env.DB.prepare('INSERT INTO messages (sender_id, receiver_id, text) VALUES (?, ?, ?)')
      .bind(chatId, targetId, msg.text).run();
  } else {
    await sendMessage(env, chatId, '❌ ارسال نشد (شاید طرف ربات را بلاک کرده است).');
  }
}

// ---------- Router ----------
async function handleUpdate(update, env) {
  const msg = update.message;
  if (!msg || msg.chat.type !== 'private') return;

  const text = (msg.text || '').trim();

  if (text.startsWith('/start'))      return handleStart(msg, env);
  if (text.startsWith('/link') || text.startsWith('/id')) return handleMyLink(msg, env);
  if (text.startsWith('/stop')) {
    await env.CACHE.delete(`session:${msg.chat.id}`);
    return sendMessage(env, msg.chat.id, '✅ گفتگو پایان یافت.');
  }
  if (text.startsWith('/help')) {
    return sendMessage(env, msg.chat.id,
      '📖 <b>راهنما:</b>\n/start - شروع و دریافت لینک اختصاصی\n/link - نمایش لینک\n/stop - پایان گفتگوی فعلی');
  }
  if (text) return handleUserMessage(msg, env);
}

// ---------- Entry Point ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET') return new Response('🤖 Bot is alive!');

    // فقط درخواست‌های webhook با مسیر مخفی پذیرفته می‌شوند
    if (request.method === 'POST' && url.pathname === `/webhook/${env.WEBHOOK_SECRET}`) {
      const update = await request.json();
      try { await handleUpdate(update, env); } catch (e) { console.error(e); }
      return new Response('OK');
    }
    return new Response('Not Found', { status: 404 });
  }
};