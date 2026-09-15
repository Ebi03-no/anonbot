import APP_HTML from './app.js';


const MAX_MSG_LEN = 1000;      
const RATE_LIMIT  = 10;         

const tg = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

function escapeHtml(t = '') {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function randomCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => chars[b % chars.length]).join('');
}

async function api(env, method, payload) {
  return fetch(tg(env.BOT_TOKEN, method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(r => r.json());
}

async function sendMessage(env, chatId, text, keyboard) {
  const payload = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
  return api(env, 'sendMessage', payload);
}

async function answerCallback(env, cbId, text = '') {
  return api(env, 'answerCallbackQuery', { callback_query_id: cbId, text });
}

async function getBotUsername(env) {
  let u = await env.CACHE.get('bot_username');
  if (u) return u;
  const res = await api(env, 'getMe', {});
  u = res.result.username;
  await env.CACHE.put('bot_username', u);
  return u;
}

const BAD_WORDS = ['کیر','کسکش','جنده','کون','حرومزاده','fuck','bitch','whore','asshole','bastard'];

async function aiGuardCheck(env, text) {
  const low = text.toLowerCase();
  if (BAD_WORDS.some(w => low.includes(w))) return true;

  try {
    const res = await env.AI.run('@cf/meta/llama-3.2-3b-instruct', {
      messages: [
        { role: 'system', content:
          'You are a strict content moderator for an anonymous messaging app. ' +
          'The message may be in Persian (Farsi) or English. ' +
          'Decide if it contains insults, threats, sexual harassment, or severe bullying. ' +
          'Reply with ONLY one word: SAFE or UNSAFE.' },
        { role: 'user', content: text.slice(0, 500) },
      ],
      max_tokens: 5,
    });
    const verdict = (res.response || '').trim().toUpperCase();
    return verdict.includes('UNSAFE');
  } catch (e) {
    console.error('AI guard error:', e);
    return false; 
  }
}

const KIND_LABELS = {
  text:       { icon: '💌', label: 'پیام' },
  photo:      { icon: '📷', label: 'عکس' },
  voice:      { icon: '🎙', label: 'ویس' },
  video:      { icon: '🎬', label: 'ویدیو' },
  audio:      { icon: '🎵', label: 'موسیقی' },
  video_note: { icon: '📹', label: 'ویدیو دایره‌ای' },
  document:   { icon: '📎', label: 'فایل' },
  sticker:    { icon: '🎭', label: 'استیکر' },
};

const MEDIA_METHODS = {
  photo: 'sendPhoto', voice: 'sendVoice', video: 'sendVideo', audio: 'sendAudio',
  video_note: 'sendVideoNote', document: 'sendDocument', sticker: 'sendSticker',
};

function detectMedia(msg) {
  if (msg.photo)      return { kind: 'photo',      field: 'photo',      fileId: msg.photo[msg.photo.length - 1].file_id };
  if (msg.voice)      return { kind: 'voice',      field: 'voice',      fileId: msg.voice.file_id };
  if (msg.video)      return { kind: 'video',      field: 'video',      fileId: msg.video.file_id };
  if (msg.audio)      return { kind: 'audio',      field: 'audio',      fileId: msg.audio.file_id };
  if (msg.video_note) return { kind: 'video_note', field: 'video_note', fileId: msg.video_note.file_id };
  if (msg.document)   return { kind: 'document',   field: 'document',   fileId: msg.document.file_id };
  if (msg.sticker)    return { kind: 'sticker',    field: 'sticker',    fileId: msg.sticker.file_id };
  return null;
}

const mainMenuKb = (env) => [
  [{ text: '📥 صندوق ورودی', web_app: { url: `${env.APP_URL}/app` } }],
  [
    { text: '🔗 لینک من',     callback_data: 'menu:link' },
    { text: '📖 راهنما',      callback_data: 'menu:help' },
  ],
  [
    { text: '⛔ بلاک‌شده‌ها',  callback_data: 'menu:blocked' },
    { text: '🛑 پایان گفتگو', callback_data: 'menu:stop' },
  ],
];

const msgKb = (senderId, rowId) => [[
  { text: '↩️ پاسخ', callback_data: `rp:${senderId}:${rowId || 0}` },
  { text: '🚫 بلاک', callback_data: `bl:${senderId}` },
]];

const blockConfirmKb = (senderId) => [[
  { text: '✅ آره، بلاکش کن',  callback_data: `blc:${senderId}` },
  { text: '❌ نه، اشتباه بود', callback_data: `blx:${senderId}` },
]];

async function isRateLimited(env, id) {
  const key = `rl:${id}`;
  const cur = Number((await env.CACHE.get(key)) || 0);
  if (cur >= RATE_LIMIT) return true;
  await env.CACHE.put(key, String(cur + 1), { expirationTtl: 60 });
  return false;
}

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
    } catch (e) { /* کد تکراری → دوباره */ }
  }
  throw new Error('create user failed');
}

async function handleStart(msg, env) {
  const user = await ensureUser(msg, env);
  const chatId = msg.chat.id;
  const targetCode = msg.text.split(' ')[1];
  const username = await getBotUsername(env);

  if (targetCode) {
    const target = await env.DB.prepare('SELECT * FROM users WHERE anon_code = ?')
      .bind(targetCode.toUpperCase()).first();

    if (!target) return sendMessage(env, chatId, '❌ چنین کدی پیدا نشد.');
    if (target.telegram_id === msg.from.id)
      return sendMessage(env, chatId, '😅 نمی‌توانی به خودت پیام ناشناس بدهی!');

    await env.CACHE.put(`session:${chatId}`, String(target.telegram_id));
    return sendMessage(env, chatId,
      '🎭 <b>حالت گفتگوی ناشناس فعال شد.</b>\n\n' +
      'متن، عکس، ویس یا استیکر بفرست؛ همه ناشناس ارسال می‌شوند.\n' +
      '🤖 پیام‌های توهین‌آمیز توسط هوش مصنوعی نگهبان رد می‌شوند.',
      [[{ text: '🛑 پایان گفتگو', callback_data: 'menu:stop' }]]);
  }

  const link = `https://t.me/${username}?start=${user.anon_code}`;
  return sendMessage(env, chatId,
    `🎭 <b>به Hidden Chat خوش آمدی!</b>\n\n` +
    `🔗 <b>لینک اختصاصی تو:</b>\n${link}\n\n` +
    `هر کی این لینک را باز کند، ناشناس بهت پیام می‌دهد.\n\n` +
    `📥 از «صندوق ورودی» پیام‌هایت را ببین:`, mainMenuKb(env));
}

async function handleMyLink(msg, env) {
  const user = await ensureUser(msg, env);
  const username = await getBotUsername(env);
  await sendMessage(env, msg.chat.id,
    `🔗 لینک اختصاصی تو:\nhttps://t.me/${username}?start=${user.anon_code}`);
}

async function handleBlockedList(msg, env) {
  const { results } = await env.DB.prepare(
    'SELECT blocked_id FROM blocks WHERE blocker_id = ? LIMIT 30'
  ).bind(msg.chat.id).all();

  if (!results.length)
    return sendMessage(env, msg.chat.id, '✅ تو هیچ‌کس را بلاک نکرده‌ای.');

  const kb = results.map(r => [{
    text: `🔓 آزادسازی کاربر ${r.blocked_id}`,
    callback_data: `ub:${r.blocked_id}`,
  }]);
  return sendMessage(env, msg.chat.id, '⛔ <b>کاربران بلاک‌شده:</b>', kb);
}

async function chatChecks(msg, env) {
  const chatId = msg.chat.id;

  if (await isRateLimited(env, chatId)) {
    await sendMessage(env, chatId, '⏳ آهسته‌تر! حداکثر ۱۰ پیام در دقیقه مجاز است.');
    return null;
  }

  const session = await env.CACHE.get(`session:${chatId}`);
  if (!session) {
    await sendMessage(env, chatId,
      '🤔 در حال گفتگو با کسی نیستی.\nلینک اختصاصی دوستت را باز کن یا لینک خودت را بگیر:',
      [[{ text: '🔗 لینک من', callback_data: 'menu:link' }]]);
    return null;
  }

  const targetId = Number(session);

  const theyBlockedMe = await env.DB.prepare(
    'SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?'
  ).bind(targetId, chatId).first();
  if (theyBlockedMe) {
    await env.CACHE.delete(`session:${chatId}`);
    await sendMessage(env, chatId, '❌ ارسال پیام به این کاربر ممکن نیست.');
    return null;
  }

  const iBlocked = await env.DB.prepare(
    'SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?'
  ).bind(chatId, targetId).first();
  if (iBlocked) {
    await sendMessage(env, chatId, '🚫 تو این کاربر را بلاک کرده‌ای! اول از /blocked آزادش کن.');
    return null;
  }

  return targetId;
}

async function handleUserMessage(msg, env) {
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (text.length > MAX_MSG_LEN)
    return sendMessage(env, chatId, `📏 پیام خیلی طولانی است! حداکثر ${MAX_MSG_LEN} کاراکتر.`);

  const targetId = await chatChecks(msg, env);
  if (!targetId) return;

  if (await aiGuardCheck(env, text))
    return sendMessage(env, chatId, '🤖 <b>نگهبان هوشمند</b> اجازه ارسال این پیام را نداد.\nمحتوای توهین‌آمیز در Hidden Chat ممنوع است 💙');

  const ins = await env.DB.prepare(
    'INSERT INTO messages (sender_id, receiver_id, text, kind) VALUES (?, ?, ?, ?)'
  ).bind(chatId, targetId, text, 'text').run();
  const rowId = ins?.meta?.last_row_id;

  let quotePart = '';
  const quote = await env.CACHE.get(`quote:${chatId}`);
  if (quote) {
    quotePart = `↩️ <i>در پاسخ به:</i>\n«${escapeHtml(quote.slice(0, 120))}»\n\n`;
    await env.CACHE.delete(`quote:${chatId}`);
  }

  const result = await sendMessage(env, targetId,
    `💌 <b>پیام ناشناس:</b>\n\n${quotePart}${escapeHtml(text)}`,
    msgKb(chatId, rowId));

  if (result.ok) {
    await sendMessage(env, chatId, '✅ پیامت ناشناس ارسال شد.');
  } else {
    await env.CACHE.delete(`session:${chatId}`);
    await sendMessage(env, chatId, '❌ ارسال نشد (احتمالاً طرف ربات را بلاک کرده). گفتگو بسته شد.');
  }
}

async function handleUserMedia(msg, env) {
  const chatId = msg.chat.id;
  const targetId = await chatChecks(msg, env);
  if (!targetId) return;

  const media = detectMedia(msg);
  if (!media) return sendMessage(env, chatId, '🙏 این نوع پیام پشتیبانی نمی‌شود.');

  const caption = (msg.caption || '').trim();
  if (caption.length > 1000)
    return sendMessage(env, chatId, '📏 کپشن خیلی طولانی است! حداکثر ۱۰۰۰ کاراکتر.');

  if (caption && await aiGuardCheck(env, caption))
    return sendMessage(env, chatId, '🤖 <b>نگهبان هوشمند</b> اجازه ارسال این پیام را نداد.\nمحتوای توهین‌آمیز در Hidden Chat ممنوع است 💙');

  const ins = await env.DB.prepare(
    'INSERT INTO messages (sender_id, receiver_id, text, kind) VALUES (?, ?, ?, ?)'
  ).bind(chatId, targetId, caption, media.kind).run();
  const rowId = ins?.meta?.last_row_id;

  let quotePart = '';
  const quote = await env.CACHE.get(`quote:${chatId}`);
  if (quote) {
    quotePart = `↩️ <i>در پاسخ به:</i>\n«${escapeHtml(quote.slice(0, 120))}»\n\n`;
    await env.CACHE.delete(`quote:${chatId}`);
  }

  const info = KIND_LABELS[media.kind];
  const supportsCaption = !['sticker', 'video_note'].includes(media.kind);

  let result;
  if (supportsCaption) {
    const cap = `${info.icon} <b>${info.label} ناشناس:</b>\n\n${quotePart}${caption ? escapeHtml(caption) : ''}`.trim();
    result = await api(env, MEDIA_METHODS[media.kind], {
      chat_id: targetId,
      [media.field]: media.fileId,
      caption: cap,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: msgKb(chatId, rowId) },
    });
  } else {
    result = await api(env, MEDIA_METHODS[media.kind], {
      chat_id: targetId, [media.field]: media.fileId,
    });
    if (result.ok)
      await sendMessage(env, targetId,
        `${info.icon} <b>یک ${info.label} ناشناس</b> (بالا ↑)`,
        msgKb(chatId, rowId));
  }

  if (result.ok) {
    await sendMessage(env, chatId, '✅ رساله‌ات ناشناس ارسال شد.');
  } else {
    await env.CACHE.delete(`session:${chatId}`);
    await sendMessage(env, chatId, '❌ ارسال نشد (احتمالاً طرف ربات را بلاک کرده). گفتگو بسته شد.');
  }
}

async function handleCallback(cb, env) {
  const parts = (cb.data || '').split(':');
  const act = parts[0], p1 = parts[1], p2 = parts[2];
  const chatId = cb.message.chat.id;
  const msgId = cb.message.message_id;

  switch (act) {
    case 'menu': {
      if (p1 === 'link') {
        await answerCallback(env, cb.id);
        return handleMyLink({ chat: { id: chatId }, from: { id: chatId } }, env);
      }
      if (p1 === 'help') {
        await answerCallback(env, cb.id);
        return sendMessage(env, chatId,
          '📖 <b>راهنما:</b>\n' +
          '🔗 لینک اختصاصی‌ات را با دوستانت به اشتراک بگذار\n' +
          '📥 «صندوق ورودی» همه پیام‌های ناشناس را نشان می‌دهد\n' +
          '✍️ روی «پاسخ» هر پیام بزن تا ناشناس جوابش را بدهی\n' +
          '🚫 مزاحم‌ها را بلاک کن\n' +
          '🤖 پیام توهین‌آمیز توسط AI رد می‌شود\n' +
          '/stop - پایان گفتگوی فعلی\n/blocked - مدیریت بلاک‌ها');
      }
      if (p1 === 'blocked') {
        await answerCallback(env, cb.id);
        return handleBlockedList({ chat: { id: chatId } }, env);
      }
      if (p1 === 'stop') {
        await env.CACHE.delete(`session:${chatId}`);
        await answerCallback(env, cb.id, '✅ گفتگو پایان یافت');
        return sendMessage(env, chatId, '🛑 گفتگو پایان یافت.');
      }
      return answerCallback(env, cb.id);
    }

    case 'rp': {
      await env.CACHE.put(`session:${chatId}`, p1);
      if (Number(p2) > 0) {
        const row = await env.DB.prepare('SELECT text, kind FROM messages WHERE id = ?')
          .bind(Number(p2)).first();
        if (row) {
          const info = KIND_LABELS[row.kind] || KIND_LABELS.text;
          const q = row.text ? row.text : `${info.icon} ${info.label}`;
          await env.CACHE.put(`quote:${chatId}`, q, { expirationTtl: 3600 });
        }
      }
      await answerCallback(env, cb.id, '✍️ حالا پیامت را بنویس');
      return sendMessage(env, chatId,
        '✍️ پیامت را بنویس؛ ناشناس ارسال می‌شود.\nبرای پایان: /stop',
        [[{ text: '🛑 پایان گفتگو', callback_data: 'menu:stop' }]]);
    }

    case 'bl': {
      await api(env, 'editMessageReplyMarkup', {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: blockConfirmKb(Number(p1)) },
      });
      return answerCallback(env, cb.id, 'این فرستنده بلاک شود؟');
    }

    case 'blc': {
      await env.DB.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)')
        .bind(chatId, Number(p1)).run();
      const s = await env.CACHE.get(`session:${chatId}`);
      if (s && Number(s) === Number(p1)) await env.CACHE.delete(`session:${chatId}`);
      await api(env, 'editMessageReplyMarkup', {
        chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] },
      });
      await answerCallback(env, cb.id, '🚫 بلاک شد');
      return sendMessage(env, chatId,
        '🚫 این فرستنده بلاک شد و دیگر پیامش را دریافت نمی‌کنی.\nمدیریت بلاک‌ها: /blocked');
    }

    case 'blx': {
      await api(env, 'editMessageReplyMarkup', {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: msgKb(Number(p1)) },
      });
      return answerCallback(env, cb.id, 'انصراف داده شد');
    }

    case 'ub': {
      await env.DB.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
        .bind(chatId, Number(p1)).run();
      await answerCallback(env, cb.id, '🔓 آزاد شد');
      return api(env, 'editMessageReplyMarkup', {
        chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] },
      });
    }

    default:
      return answerCallback(env, cb.id);
  }
}

async function validateInitData(env, initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;

    const authDate = Number(params.get('auth_date') || 0);
    if (!authDate || Math.floor(Date.now() / 1000) - authDate > 86400) return false;

    params.delete('hash');
    const dataCheckString = [...params.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const enc = new TextEncoder();
    const sKey = await crypto.subtle.importKey('raw', enc.encode('WebAppData'),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const secret = await crypto.subtle.sign('HMAC', sKey, enc.encode(env.BOT_TOKEN));

    const hKey = await crypto.subtle.importKey('raw', secret,
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', hKey, enc.encode(dataCheckString));
    const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');

    return hex === hash;
  } catch (e) {
    return false;
  }
}

async function handleApiInbox(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.initData) return json({ ok: false, error: 'no initData' }, 401);

  const valid = await validateInitData(env, body.initData);
  if (!valid) return json({ ok: false, error: 'invalid signature' }, 401);

  const params = new URLSearchParams(body.initData);
  const user = JSON.parse(params.get('user') || '{}');
  const uid = user.id;
  if (!uid) return json({ ok: false, error: 'no user' }, 401);

  const { results } = await env.DB.prepare(
    'SELECT id, kind, text, created_at FROM messages WHERE receiver_id = ? ORDER BY id DESC LIMIT 50'
  ).bind(uid).all();

  const u = await env.DB.prepare('SELECT anon_code FROM users WHERE telegram_id = ?')
    .bind(uid).first();
  const username = await getBotUsername(env);
  const link = u ? `https://t.me/${username}?start=${u.anon_code}` : null;

  return json({ ok: true, link, messages: results });
}

async function handleUpdate(update, env) {
  if (update.callback_query) return handleCallback(update.callback_query, env);

  const msg = update.message;
  if (!msg || msg.chat.type !== 'private') return;

  const text = (msg.text || '').trim();

  if (text.startsWith('/start'))    return handleStart(msg, env);
  if (text.startsWith('/link'))     return handleMyLink(msg, env);
  if (text.startsWith('/blocked'))  return handleBlockedList(msg, env);
  if (text.startsWith('/stop')) {
    await env.CACHE.delete(`session:${msg.chat.id}`);
    return sendMessage(env, msg.chat.id, '🛑 گفتگو پایان یافت.');
  }
  if (text.startsWith('/help')) {
    return sendMessage(env, msg.chat.id,
      '📖 <b>راهنما:</b>\n/start - شروع و دریافت لینک\n/link - نمایش لینک\n/blocked - بلاک‌شده‌ها\n/stop - پایان گفتگو');
  }
  if (text) return handleUserMessage(msg, env);
  if (detectMedia(msg)) return handleUserMedia(msg, env);

  return sendMessage(env, msg.chat.id, '🙏 این نوع پیام پشتیبانی نمی‌شود.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && (url.pathname === '/app' || url.pathname === '/'))
      return new Response(APP_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });

    if (request.method === 'POST' && url.pathname === '/api/inbox')
      return handleApiInbox(request, env);

    if (request.method === 'GET') return new Response('🤖 Bot is alive!');

    if (request.method === 'POST' && url.pathname === `/webhook/${env.WEBHOOK_SECRET}`) {
      const update = await request.json();
      try { await handleUpdate(update, env); } catch (e) { console.error(e); }
      return new Response('OK');
    }
    return new Response('Not Found', { status: 404 });
  }
};
