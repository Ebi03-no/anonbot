// رابط مینی‌اپ تلگرام — صندوق پیام‌های ناشناس
export default `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Hidden Chat | صندوق ورودی</title>
<link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
<style>
  :root{ --bg:#0b0b12; --card:rgba(255,255,255,.05); --border:rgba(255,255,255,.1);
         --text:#e8e8f0; --muted:#9a9ab0; --accent:#8b5cf6; --accent2:#22d3ee;
         --grad:linear-gradient(135deg,#8b5cf6,#22d3ee); }
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Vazirmatn,sans-serif;background:var(--bg);color:var(--text);line-height:1.8;min-height:100vh;overflow-x:hidden}
  .glow{position:fixed;border-radius:50%;filter:blur(110px);opacity:.28;pointer-events:none;z-index:0}
  .g1{width:320px;height:320px;background:#7c3aed;top:-120px;right:-100px}
  .g2{width:280px;height:280px;background:#0891b2;bottom:-100px;left:-100px}
  .wrap{position:relative;z-index:1;max-width:520px;margin:0 auto;padding:18px 16px 40px}
  header{display:flex;justify-content:space-between;align-items:center;padding:6px 4px 18px}
  .logo{font-weight:800;font-size:1.1rem}
  .logo span{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
  #uname{color:var(--muted);font-size:.85rem}
  .card{background:var(--card);border:1px solid var(--border);border-radius:20px;padding:18px;margin-bottom:16px;backdrop-filter:blur(10px)}
  .lc-title{font-weight:700;font-size:.95rem;margin-bottom:10px}
  .link-box{background:rgba(0,0,0,.3);border:1px solid var(--border);border-radius:12px;padding:10px 14px;font-size:.82rem;color:var(--accent2);word-break:break-all;direction:ltr;text-align:left;margin-bottom:12px}
  .row{display:flex;gap:10px}
  .btn{flex:1;padding:11px;border-radius:12px;border:none;font-family:inherit;font-weight:700;font-size:.88rem;cursor:pointer;transition:.2s}
  .btn.primary{background:var(--grad);color:#fff}
  .btn.ghost{background:transparent;color:var(--text);border:1px solid var(--border)}
  .btn:active{transform:scale(.97)}
  .inbox-head{display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:.95rem;margin-bottom:14px}
  #refresh{background:transparent;border:1px solid var(--border);color:var(--text);width:36px;height:36px;border-radius:10px;font-size:1rem;cursor:pointer}
  #refresh.spin{animation:rot .7s linear infinite}
  @keyframes rot{to{transform:rotate(360deg)}}
  .msg{background:rgba(0,0,0,.25);border:1px solid var(--border);border-radius:14px;padding:12px 14px;margin-bottom:10px;animation:pop .3s ease}
  @keyframes pop{from{opacity:0;transform:translateY(8px)}}
  .m-meta{font-size:.72rem;color:var(--muted);margin-bottom:4px}
  .m-text{font-size:.92rem;white-space:pre-wrap;word-break:break-word}
  .status{text-align:center;color:var(--muted);padding:26px 10px;font-size:.9rem}
  .empty{font-size:2.4rem;text-align:center;padding-bottom:8px}
</style>
</head>
<body>
<div class="glow g1"></div><div class="glow g2"></div>
<div class="wrap">

  <header>
    <div class="logo">🎭 Hidden <span>Chat</span></div>
    <div id="uname"></div>
  </header>

  <div class="card">
    <div class="lc-title">🔗 لینک اختصاصی تو</div>
    <div class="link-box" id="link">در حال دریافت...</div>
    <div class="row">
      <button class="btn primary" id="copyBtn">📋 کپی لینک</button>
      <button class="btn ghost" id="shareBtn">📤 اشتراک‌گذاری</button>
    </div>
  </div>

  <div class="card">
    <div class="inbox-head">
      📥 پیام‌های ناشناس دریافتی
      <button id="refresh">⟳</button>
    </div>
    <div id="list"><div class="status">⏳ در حال بارگذاری...</div></div>
  </div>

</div>

<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script>
  var tg = window.Telegram.WebApp;
  tg.ready(); tg.expand();
  var LINK = '';
  var ICONS = { text:'💌', photo:'📷', voice:'🎙', video:'🎬', audio:'🎵',
                video_note:'📹', document:'📎', sticker:'🎭' };
  var NAMES = { text:'پیام متنی', photo:'عکس', voice:'ویس', video:'ویدیو',
                audio:'موسیقی', video_note:'ویدیو دایره‌ای', document:'فایل', sticker:'استیکر' };

  var list = document.getElementById('list');
  var linkEl = document.getElementById('link');

  function fmtTime(s) {
    try { return new Date(s.replace(' ','T') + 'Z').toLocaleString('fa-IR', {dateStyle:'short', timeStyle:'short'}); }
    catch(e) { return s; }
  }

  function render(msgs) {
    if (!msgs.length) {
      list.innerHTML = '<div class="empty">📭</div><div class="status">هنوز پیام ناشناسی نداری.<br>لینکت را برای دوستانت بفرست!</div>';
      return;
    }
    list.innerHTML = '';
    msgs.forEach(function (m) {
      var card = document.createElement('div'); card.className = 'msg';
      var meta = document.createElement('div'); meta.className = 'm-meta';
      meta.textContent = (ICONS[m.kind] || '💌') + ' ' + (NAMES[m.kind] || '') + '  •  ' + fmtTime(m.created_at);
      var body = document.createElement('div'); body.className = 'm-text';
      body.textContent = m.text || ('(' + (NAMES[m.kind] || 'رسانه') + ' بدون کپشن)');
      card.appendChild(meta); card.appendChild(body); list.appendChild(card);
    });
  }

  function load(spin) {
    var btn = document.getElementById('refresh');
    if (spin) btn.classList.add('spin');
    list.innerHTML = '<div class="status">⏳ در حال دریافت...</div>';
    fetch('/api/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      btn.classList.remove('spin');
      if (!data.ok) {
        list.innerHTML = '<div class="status">⛔ تأیید هویت نشد.<br>مینی‌اپ را فقط از داخل ربات باز کن.</div>';
        return;
      }
      LINK = data.link || '';
      linkEl.textContent = LINK;
      try {
        var u = JSON.parse(new URLSearchParams(tg.initData).get('user'));
        document.getElementById('uname').textContent = 'سلام ' + (u.first_name || '') + ' 👋';
      } catch (e) {}
      render(data.messages || []);
    })
    .catch(function () {
      btn.classList.remove('spin');
      list.innerHTML = '<div class="status">⚠️ خطای شبکه؛ دوباره تلاش کن.</div>';
    });
  }

  document.getElementById('refresh').onclick = function () { load(true); };

  document.getElementById('copyBtn').onclick = function () {
    var b = this;
    navigator.clipboard.writeText(LINK).then(function () {
      b.textContent = '✅ کپی شد!';
      setTimeout(function () { b.textContent = '📋 کپی لینک'; }, 1500);
    });
  };

  document.getElementById('shareBtn').onclick = function () {
    tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(LINK) +
                        '&text=' + encodeURIComponent('به من ناشناس پیام بده 🎭'));
  };

  load(false);
</script>
</body>
</html>`;
