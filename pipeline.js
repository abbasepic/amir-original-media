// Daily flow (New York time): ask 03:30 -> preview 08:30 -> publish 09:30 (= 12/17/18 Tehran in winter).
// Telegram: the name question to Shavandi, previews/reports/commands for the owner.
// Rubika: the post in the group.
// modes: ask | preview | publish | register | ping | test <n> | render <id> <name> <out>
// env: FORCE=1 skips the time window (manual runs). NOW=<iso> fakes the clock and
//      TG_BASE / RB_BASE point the APIs at a mock server (local tests only).
const fs = require('fs'), path = require('path');
const RT = process.env.RUBIKA_TOKEN || '', TT = process.env.TELEGRAM_TOKEN || '';
const TG_BASE = process.env.TG_BASE || 'https://api.telegram.org';
const RB_BASE = process.env.RB_BASE || 'https://botapi.rubika.ir/v3';
const FORCE = process.env.FORCE === '1';
const clean = s => { s = String(s); for (const t of [RT, TT]) if (t) s = s.split(t).join('***'); return s };
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const cfg = read('config.json'), Q = read('queue.json'), S = read('state.json');
const save = () => fs.writeFileSync('state.json', JSON.stringify(S, null, 1));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- clock (Tehran, UTC+3:30, no DST) ----------
const nowMs = () => process.env.NOW ? Date.parse(process.env.NOW) : Date.now();
const teh = () => new Date(nowMs() + 3.5 * 3600e3);
const today = () => teh().toISOString().slice(0, 10);
// The schedule follows New York time: ask 03:30, preview 08:30, publish 09:30 (America/New_York).
// In winter that is 12:00 / 17:00 / 18:00 Tehran; in US summer time one hour earlier.
const SCHED = { ask: [3, 30], preview: [8, 30], publish: [9, 30] };
const nyParts = ms => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
const hour = () => { const p = nyParts(nowMs()); return +p.hour + +p.minute / 60 };
function nyAt(h, m) { // instant of today's h:m New York time
  const p = nyParts(nowMs()), guess = Date.UTC(+p.year, +p.month - 1, +p.day, h, m);
  const q = nyParts(guess), off = Date.UTC(+q.year, +q.month - 1, +q.day, +q.hour, +q.minute) - guess;
  return guess - off;
}
const fa = s => String(s).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
const tehClock = ms => { const d = new Date(ms + 3.5 * 3600e3); return fa(String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0')) };
const T = k => tehClock(nyAt(...SCHED[k]));
const WINDOW = { ask: [3, 7.5], preview: [8, 9.5], publish: [9.25, 13] };

// ---------- network with retries ----------
async function call(label, url, opts, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(60000) });
      const txt = await r.text();
      if (r.status >= 500) throw new Error(label + ' HTTP ' + r.status);
      return { status: r.status, txt };
    } catch (e) { last = e; console.log('retry', label, i + 1, clean(e.message)); await sleep(3000 * 2 ** i) }
  }
  throw new Error(label + ' failed after retries: ' + clean(last && last.message));
}

// ---------- Telegram ----------
async function tg(m, body, form) {
  const opts = form ? { method: 'POST', body: form } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const { status, txt } = await call('telegram ' + m, `${TG_BASE}/bot${TT}/${m}`, opts);
  console.log('TG', m, status, clean(txt).slice(0, 160));
  const j = JSON.parse(txt);
  if (!j.ok) throw new Error('telegram ' + m + ': ' + (j.description || status));
  return j.result;
}
const tgText = (chat, text) => chat ? tg('sendMessage', { chat_id: chat, text }) : console.log('NO CHAT:', text);
function tgPhoto(chat, file, caption) {
  if (!chat) return console.log('NO CHAT (photo):', caption);
  const f = new FormData(); f.append('chat_id', String(chat)); f.append('caption', caption.slice(0, 1024));
  f.append('photo', new Blob([fs.readFileSync(file)], { type: 'image/jpeg' }), 'p.jpg');
  return tg('sendPhoto', null, f);
}
const owner = t => tgText(S.owner_tg, t);
const amirUser = (cfg.amir_username || '').toLowerCase();

// Pull new Telegram messages into a persistent inbox so no run can lose them.
async function pull() {
  S.inbox = S.inbox || [];
  for (let n = 0; n < 10; n++) {
    const b = { timeout: 0, allowed_updates: ['message'] }; if (S.tg_offset) b.offset = S.tg_offset;
    const u = await tg('getUpdates', b); if (!u.length) break;
    for (const x of u) {
      S.tg_offset = x.update_id + 1; const m = x.message; if (!m || !m.text) continue;
      const user = (m.from && m.from.username || '').toLowerCase(), chat = m.chat.id, text = m.text.trim();
      if (user === amirUser && !S.amir_tg) { S.amir_tg = chat; await tgText(chat, `ثبت شد ✅ از این به بعد هر روز ساعت ${T('ask')} نام قطعه از شما پرسیده می‌شود.`) }
      if (text.startsWith('/start') && !S.owner_tg && chat !== S.amir_tg && user !== amirUser) { S.owner_tg = chat; await tgText(chat, 'ثبت شد ✅ شما مدیر هستید.') }
      const who = chat === S.amir_tg ? 'amir' : chat === S.owner_tg ? 'owner' : 'other';
      S.inbox.push({ who, text, t: m.date });
      if (who === 'owner') await ownerCommand(text);
      if (who === 'amir') await amirMessage(text);
    }
    save();
  }
  const cut = nowMs() / 1000 - 3 * 86400; S.inbox = S.inbox.filter(x => x.t > cut).slice(-80); save();
}
async function amirMessage(text) {
  const c = S.cycle;
  if (!c || c.day !== today() || !c.item || c.published || !nameOk(text)) return;
  const name = cleanName(text);
  if (c.previewed || c.override) return owner('📩 آقای شوندی بعد از پیش‌نمایش نوشت: «' + name + '»\nاگر باید همین منتشر شود بنویس: نام: ' + name);
  await tgText(S.amir_tg, '✅ ممنون، ثبت شد: ' + name + (c.urgent ? '\nهمین الان توی کانال روبیکا منتشر می‌شه.' : `\nساعت ${T('publish')} توی کانال روبیکا منتشر می‌شه.`));
  const pre = SCHED.preview[0] + SCHED.preview[1] / 60;
  await owner('📩 آقای شوندی نام قطعه را فرستاد: ' + name + (c.urgent ? '' : hour() < pre ? `\nپیش‌نمایش ساعت ${T('preview')} برایت می‌آید.` : `\nساعت ${T('publish')} اول پیش‌نمایش می‌آید و بعد منتشر می‌شود.`));
}
async function ownerCommand(text) {
  const c = S.cycle;
  if (/^توقف/.test(text)) {
    if (c && c.day === today() && !c.published) { c.stop = true; save(); await owner('✋ باشه، پست امروز منتشر نمی‌شود.') }
    else await owner('امروز پستی در صف انتشار نیست.');
  } else if (/^نام\s*[:：]/.test(text)) {
    const name = cleanName(text.replace(/^نام\s*[:：]\s*/, ''));
    if (c && c.day === today() && !c.published && nameOk(name)) { c.override = name; save(); await owner('✅ نام قطعه‌ی امروز ثبت شد: ' + name) }
    else await owner('نام ثبت نشد (یا امروز پستی در صف نیست، یا نام کوتاه/بلند است).');
  } else if (/^وضعیت/.test(text)) await owner(status());
  else if (/^الان/.test(text)) { // ask now and publish as soon as the name arrives
    if (c && c.day === today() && c.published) return owner('پست امروز قبلاً منتشر شده. برای فرستادن دوباره بنویس: دوباره');
    S.urgentReq = true; save(); await owner('⏱ باشه، همین الان از آقای شوندی می‌پرسم و به محض جواب منتشر می‌کنم.');
  } else if (/^دوباره/.test(text)) {
    if (c && c.day === today() && c.published) { c.repost = true; save(); await owner('🔁 باشه، پست امروز دوباره در گروه فرستاده می‌شود.') }
    else await owner('امروز هنوز پستی منتشر نشده که دوباره فرستاده شود.');
  } else if (/^(راهنما|\/help)/.test(text)) await owner('دستورها:\nوضعیت — وضعیت امروز\nتوقف — پست امروز منتشر نشود\nنام: ... — ثبت نام قطعه\nالان — همین الان بپرس و با جواب منتشر کن\nدوباره — پست امروز را دوباره در گروه بفرست');
}
function status() {
  const c = S.cycle, it = Q[S.index];
  const lines = ['📋 وضعیت', 'قطعه‌ی بعدی صف: ' + (it ? it.id + ' (' + it.type + ' ' + it.brand + ')' : 'صف تمام شده'), 'تعداد باقی‌مانده: ' + Math.max(0, Q.length - S.index)];
  if (c) lines.push('امروز (' + c.day + '): ' + (c.published ? 'منتشر شد ✅' : c.stop ? 'متوقف شد ✋' : c.skip ? 'منتشر نمی‌شود' : c.previewed ? 'پیش‌نمایش رفته، منتظر ساعت ' + T('publish') : 'منتظر نام از آقای شوندی') + (cycleName(c) ? ' — ' + cycleName(c) : ''));
  return lines.join('\n');
}

// ---------- name ----------
const PLEASANT = /^(سلام|درود|وقت\s*بخیر|عرض\s*ادب|ممنون|مرسی|متشکرم|باشه|چشم|اوکی|ok|آقای\s*شوندی|شوندی)[\s!.,،:؛🌹🙏]*/i;
const cleanName = x => { x = String(x).trim(); for (let i = 0; i < 4; i++) x = x.replace(PLEASANT, '').trim(); return x.replace(/[\s.!،]+$/, '').trim() };
const nameOk = x => { const n = cleanName(x); return n.length >= 4 && n.length <= 70 && !n.startsWith('/') && !/^(مدیر|توقف|وضعیت)/.test(n) };
function cycleName(c) {
  if (!c) return '';
  if (c.override) return c.override;
  if (c.name) return c.name;
  const n = (S.inbox || []).filter(m => m.who === 'amir' && m.t >= c.asked_t - 5).map(m => m.text).filter(nameOk);
  return n.length ? cleanName(n[n.length - 1]) : '';
}

// ---------- Rubika ----------
async function rb(m, b) {
  const { status, txt } = await call('rubika ' + m, `${RB_BASE}/${RT}/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  console.log('RB', m, status, clean(txt).slice(0, 200));
  return JSON.parse(txt);
}
async function rubikaPost(chat, file, text) {
  if (!RT) throw new Error('RUBIKA_TOKEN missing');
  const up = await rb('requestSendFile', { type: 'Image' });
  if (!up.data || !up.data.upload_url) throw new Error('rubika requestSendFile: ' + JSON.stringify(up).slice(0, 120));
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(file)], { type: 'image/jpeg' }), 'post.jpg');
  const u = await call('rubika upload', up.data.upload_url, { method: 'POST', body: fd });
  const j = JSON.parse(u.txt); if (!j.data || !j.data.file_id) throw new Error('rubika upload: ' + u.txt.slice(0, 120));
  const s = await rb('sendFile', { chat_id: chat, file_id: j.data.file_id, text });
  if (s.status !== 'OK') throw new Error('rubika sendFile: ' + JSON.stringify(s).slice(0, 160));
  return (s.data && s.data.message_id) || 'ok';
}
async function rubikaTestChat() {
  if (S.rb_test_chat) return S.rb_test_chat;
  const r = await rb('getUpdates', { limit: 100 });
  const ups = (r.data && r.data.updates) || [];
  for (const x of ups) { const t = x.new_message && x.new_message.text; if (t && t.trim() === 'تست' && x.chat_id && !x.chat_id.startsWith('g')) S.rb_test_chat = x.chat_id }
  save(); return S.rb_test_chat;
}

// ---------- content ----------
const askCaption = () => `سلام آقای شوندی 🌹\nنام دقیق این قطعه چیه؟ لطفاً فقط نام کامل رو بنویسید تا ساعت ${T('publish')} توی کانال روبیکا بره.`;
const caption = (p, name) => `همکار عزیز، ${name} با دو سال ضمانت موجوده. قفسه‌ت رو پر کن. 👇\n\n${name} از برند ${p.brand}\n✅ موجود برای سفارش عمده\n✅ دو سال ضمانت\n✅ تأمین و ارسال سریع\n\nقطعه‌ای که ضمانتش معلومه، راحت‌تر فروش می‌ره و کمتر برگشت می‌خوره.\n\n📞 برای قیمت عمده و ثبت سفارش، همین الان تماس بگیر:\n09122525516\n\n📍 قم، خیابان کشاورز شمالی، نبش ۳۶\nفروش فقط به‌صورت عمده\n\n#پخش_عمده #لوازم_یدکی #قطعات_یدکی #${p.brand.replace(/[ .]/g, '_')} #قم`;
async function askPhoto(p) {
  const sharp = require('sharp'); const pic = path.join(fs.mkdtempSync('/tmp/a'), 'q.jpg');
  await sharp(p.img).flatten({ background: '#ffffff' }).resize(900, 900, { fit: 'inside' }).jpeg({ quality: 88 }).toFile(pic); return pic;
}
async function render(p, name, out) {
  if (process.env.FAKE_RENDER) { fs.copyFileSync(process.env.FAKE_RENDER, out); return }
  const { chromium } = require('playwright'); const esc = s => s.replace(/[<>&]/g, '');
  const post = { id: 'x', img: '../' + p.img, box: p.box ? 'carton.png' : undefined, card: p.card, h: p.h, s: `${p.brand} با <em>دو سال ضمانت</em>`, c: p.c, name: esc(name) };
  fs.writeFileSync('template/posts.js', 'window.POSTS=' + JSON.stringify([post]));
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1080, height: 1350 } });
  await pg.goto('file://' + path.resolve('template/post.html')); await pg.evaluate(() => document.fonts.ready); await pg.evaluate(() => show(0));
  await pg.waitForFunction(() => [...document.images].every(x => x.complete)); await pg.waitForTimeout(200);
  await pg.screenshot({ path: out, type: 'jpeg', quality: 93 }); await b.close();
}
const itemOf = c => Q.find(q => q.id === c.item);

// ---------- steps ----------
async function ask(urgent) {
  if (S.cycle && S.cycle.day === today()) return console.log('already asked today');
  const it = Q[S.index];
  if (!it) { S.cycle = { day: today(), skip: true }; save(); return owner('⚠️ صف پست‌ها تمام شده؛ عکس قطعه‌های جدید لازم است.') }
  const cyc = { day: today(), item: it.id, asked_t: Math.floor(nowMs() / 1000) - 60, urgent: !!urgent };
  if (!S.amir_tg) { S.cycle = { ...cyc, skip: true }; save(); return owner('⚠️ آقای شوندی هنوز در ربات ثبت نشده؛ امروز پستی منتشر نمی‌شود.') }
  await tgPhoto(S.amir_tg, await askPhoto(it), urgent ? 'سلام آقای شوندی 🌹\nنام دقیق این قطعه چیه؟ همین که بنویسید، توی کانال روبیکا منتشر می‌شه.' : askCaption());
  S.cycle = cyc; save(); // only after the question really went out
  if (urgent) return owner(`📨 همین الان نام قطعه (${it.type}، ${it.brand}) از آقای شوندی پرسیده شد. به محض جواب منتشر می‌شود.`);
  await owner(`📨 نام قطعه‌ی امروز از آقای شوندی پرسیده شد (${it.type}، ${it.brand}).\nساعت ${T('preview')} پیش‌نمایش برایت می‌آید.\nاگر خودت نام را می‌دانی بنویس: نام: ...`);
}
async function sendPreview(c, note) {
  const it = itemOf(c), name = cycleName(c);
  await render(it, name, 'today.jpg');
  await tgPhoto(S.owner_tg, 'today.jpg', `👀 پیش‌نمایش پست ساعت ${T('publish')} — نام قطعه: ` + name);
  await owner('کپشن:\n\n' + caption(it, name) + '\n\n———\n' + note);
  c.name = name; c.previewed = true; save();
}
async function preview() {
  const c = S.cycle;
  if (!c || c.day !== today()) return owner('⚠️ امروز نام قطعه پرسیده نشده بود؛ پستی منتشر نمی‌شود.');
  if (c.skip || c.published || c.stop || c.previewed) return console.log('preview: nothing to do');
  if (!cycleName(c)) { c.skip = true; save(); return owner(`⚠️ آقای شوندی تا ساعت ${T('preview')} نام قطعه را نفرستاد؛ پست امروز منتشر نمی‌شود.\n(اگر تا ساعت ${T('publish')} نام برسد، یا خودت بنویسی «نام: ...»، ساعت ${T('publish')} اول پیش‌نمایش می‌آید و ۱۰ دقیقه بعد منتشر می‌شود.)`) }
  await sendPreview(c, `اگر نمی‌خواهی منتشر شود، تا ساعت ${T('publish')} بنویس: توقف\nبرای عوض کردن نام بنویس: نام: ...`);
  if (S.amir_tg) await tgText(S.amir_tg, `ممنون 🌹 ساعت ${T('publish')} توی کانال روبیکا منتشر می‌شه.`);
}
async function publish() {
  const c = S.cycle;
  if (!c || c.day !== today()) return console.log('publish: no cycle today');
  if (c.published) return console.log('already published');
  if (c.stop) { if (!c.stopReported) { c.stopReported = true; save(); await owner('✋ پست امروز طبق درخواستت منتشر نشد.') } return }
  if (c.skip && !cycleName(c)) return console.log('publish: skipped today');
  if (!cycleName(c)) { c.skip = true; save(); return owner('⚠️ نام قطعه ثبت نشد؛ پست امروز منتشر نشد.') }
  if (!c.previewed || (c.override && c.override !== c.name)) {
    // preview did not run (or name changed after it): show it now and give a 10-minute stop window
    await sendPreview(c, '۱۰ دقیقه‌ی دیگر منتشر می‌شود. اگر نمی‌خواهی، بنویس: توقف');
    const end = nowMs() + (process.env.NOW ? 0 : 10 * 60e3); if (process.env.NOW) await pull();
    while (nowMs() < end && !S.cycle.stop) { await sleep(20000); try { await pull() } catch (e) { console.log('pull', clean(e.message)) } }
    if (S.cycle.stop) { c.stopReported = true; save(); return owner('✋ پست امروز منتشر نشد.') }
  }
  const wait = nyAt(...SCHED.publish) - nowMs();
  if (wait > 0 && wait < 20 * 60e3 && !process.env.NOW) { console.log('waiting until publish time', Math.round(wait / 1000)); await sleep(wait); await pull() }
  if (S.cycle.stop) { c.stopReported = true; save(); return owner('✋ پست امروز منتشر نشد.') }
  const it = itemOf(c), name = cycleName(c);
  await render(it, name, 'today.jpg');
  const id = await rubikaPost(cfg.group_chat_id, 'today.jpg', caption(it, name));
  c.published = true; c.rubika_id = id; S.index++; save();
  await tgPhoto(S.owner_tg, 'today.jpg', '✅ پست امروز در گروه روبیکا منتشر شد — ' + name);
  if (S.amir_tg) await tgText(S.amir_tg, '✅ پست «' + name + '» توی کانال روبیکا منتشر شد. ممنون 🌹');
  const next = Q[S.index]; if (!next) await owner('⚠️ این آخرین قطعه‌ی صف بود؛ عکس قطعه‌های جدید لازم است.');
}
// End-to-end test against the real APIs, without touching the real cycle or the group.
async function test(n) {
  const it = Q[(S.index + n) % Q.length], res = [];
  const step = async (label, fn) => { try { const v = await fn(); res.push('✅ ' + label + (v ? ' — ' + v : '')); return true } catch (e) { res.push('❌ ' + label + ' — ' + clean(e.message)); return false } };
  await step('تلگرام: ارسال عکس و سؤال نام', async () => { await tgPhoto(S.owner_tg, await askPhoto(it), `🧪 تست ${n} — این پیام در روز واقعی برای آقای شوندی می‌رود:\n\n` + askCaption()) });
  const name = `تست ${n} ${it.type} ${it.brand}`;
  await step('تشخیص نام از جواب‌ها', async () => {
    const saved = S.inbox; S.inbox = [{ who: 'amir', text: 'سلام', t: 100 }, { who: 'amir', text: name, t: 101 }, { who: 'amir', text: 'ممنون', t: 102 }, { who: 'other', text: 'x y z w', t: 103 }];
    const got = cycleName({ asked_t: 50 }); S.inbox = saved; if (got !== name) throw new Error('got ' + got); return got;
  });
  await step('ساخت عکس پست و پیش‌نمایش در تلگرام', async () => { await render(it, name, 'today.jpg'); await tgPhoto(S.owner_tg, 'today.jpg', `🧪 تست ${n} — پیش‌نمایش`); });
  await step('روبیکا: ارسال پست (چت خصوصی تست)', async () => {
    const chat = await rubikaTestChat(); if (!chat) throw new Error('در روبیکا به ربات پیام «تست» نداده‌ای');
    return 'message ' + await rubikaPost(chat, 'today.jpg', `🧪 تست ${n}\n\n` + caption(it, name));
  });
  await owner(`🧪 نتیجه‌ی تست ${n}:\n` + res.join('\n'));
  console.log(res.join('\n'));
  if (res.some(r => r.startsWith('❌'))) process.exitCode = 1;
}

// One-off: ask right now and post to the group as soon as the name arrives (waits up to 3 hours).
async function now() {
  let c = S.cycle;
  if (c && c.day === today() && c.published) return owner('پست امروز قبلاً منتشر شده است.');
  const it = c && c.day === today() && c.item ? itemOf(c) : Q[S.index];
  if (!it) return owner('⚠️ صف پست‌ها تمام شده.');
  if (!S.amir_tg) return owner('⚠️ آقای شوندی در ربات ثبت نشده.');
  if (!c || c.day !== today() || !c.item) c = S.cycle = { day: today(), item: it.id, asked_t: Math.floor(nowMs() / 1000) - 60 };
  c.stop = false; c.skip = false; save();
  if (!cycleName(c)) {
    await tgPhoto(S.amir_tg, await askPhoto(it), 'سلام آقای شوندی 🌹\nنام دقیق این قطعه چیه؟ همین که بنویسید، توی کانال روبیکا منتشر می‌شه.');
    await owner(`📨 همین الان نام قطعه (${it.type}، ${it.brand}) از آقای شوندی پرسیده شد. به محض جواب، پست در روبیکا منتشر می‌شود و خبرت می‌کنم. (برای جلوگیری بنویس: توقف)`);
  }
  const end = Date.now() + 180 * 60e3;
  while (!cycleName(c) && !S.cycle.stop && Date.now() < end) { await sleep(20000); try { await pull() } catch (e) { console.log('pull', clean(e.message)) } }
  if (S.cycle.stop) return owner('✋ منتشر نشد.');
  const name = cycleName(c);
  if (!name) { c.skip = true; save(); return owner('⚠️ آقای شوندی تا ۳ ساعت جواب نداد؛ پستی منتشر نشد. (اگر نام را داری بنویس «نام: ...» و به من بگو)') }
  c.name = name; c.previewed = true; save();
  await render(it, name, 'today.jpg');
  const id = await rubikaPost(cfg.group_chat_id, 'today.jpg', caption(it, name));
  c.published = true; c.rubika_id = id; S.index++; save();
  await tgPhoto(S.owner_tg, 'today.jpg', '✅ پست در گروه روبیکا منتشر شد — ' + name);
  await tgText(S.amir_tg, '✅ پست «' + name + '» توی کانال روبیکا منتشر شد. ممنون 🌹');
}

// ---------- always-on runner ----------
async function postNow(c, label) {
  const it = itemOf(c), name = cycleName(c);
  await render(it, name, 'today.jpg');
  const id = await rubikaPost(cfg.group_chat_id, 'today.jpg', caption(it, name));
  return { id, name };
}
async function tick() {
  const h = hour(), c = S.cycle, isToday = c && c.day === today();
  if (S.urgentReq) { // owner wrote «الان»
    S.urgentReq = false;
    if (!isToday) { S.cycle = null; await ask(true) }
    else if (!c.published) { c.urgent = true; c.skip = false; c.stop = false; save(); if (!cycleName(c) && S.amir_tg) await tgPhoto(S.amir_tg, await askPhoto(itemOf(c)), 'سلام آقای شوندی 🌹\nنام دقیق این قطعه چیه؟ همین که بنویسید، توی کانال روبیکا منتشر می‌شه.') }
    save(); return;
  }
  if (isToday && c.urgent && !c.published && !c.stop && cycleName(c)) {
    const r = await postNow(c); c.name = r.name; c.published = true; c.previewed = true; c.rubika_id = r.id; S.index++; save();
    await tgPhoto(S.owner_tg, 'today.jpg', '✅ پست در گروه روبیکا منتشر شد — ' + r.name + '\n(اگر در گروه نیست بنویس: دوباره)');
    if (S.amir_tg) await tgText(S.amir_tg, '✅ پست «' + r.name + '» توی کانال روبیکا منتشر شد. ممنون 🌹'); return;
  }
  if (isToday && c.repost && c.published) {
    c.repost = false; save(); const r = await postNow(c); c.rubika_id = r.id; save();
    await tgPhoto(S.owner_tg, 'today.jpg', '🔁 پست دوباره در گروه روبیکا فرستاده شد — ' + r.name); return;
  }
  if (h >= WINDOW.ask[0] && h < WINDOW.ask[1] && hour() >= SCHED.ask[0] + SCHED.ask[1] / 60 && !isToday) return ask();
  if (isToday && !c.urgent && h >= SCHED.preview[0] + SCHED.preview[1] / 60 && h < WINDOW.preview[1] && !c.previewed && !c.skip && !c.stop && !c.published) return preview();
  if (isToday && !c.urgent && h >= SCHED.publish[0] + SCHED.publish[1] / 60 && h < WINDOW.publish[1] && !c.published) return publish();
}
let lastSaved = '';
function persist() {
  if (!process.env.DAEMON) return;
  const now = JSON.stringify(S); if (now === lastSaved) return;
  const { execSync } = require('child_process');
  try {
    execSync('git add state.json && (git diff --cached --quiet || git commit -q -m "state ' + new Date().toISOString().slice(0, 16) + '") && git pull -q --rebase --autostash && git push -q', { stdio: 'inherit' });
    lastSaved = now;
  } catch (e) { console.log('persist failed', e.message) }
}
async function dispatchNext() {
  const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/bot.yml/dispatches`, { method: 'POST', headers: { authorization: 'Bearer ' + process.env.GITHUB_TOKEN, accept: 'application/vnd.github+json' }, body: JSON.stringify({ ref: 'main' }) });
  console.log('dispatch next', r.status);
}
async function daemon() {
  const start = Date.now(), LIFE = (5 * 60 + 40) * 60e3; let next = false, errs = 0, lastErr = 0;
  lastSaved = JSON.stringify(S);
  while (Date.now() - start < LIFE) {
    try { await pull(); await tick(); errs = 0 }
    catch (e) { errs++; console.error('tick error', clean(e.stack || e)); if (Date.now() - lastErr > 3600e3) { lastErr = Date.now(); try { await owner('❌ خطا: ' + clean(e.message) + '\n(ربات دوباره تلاش می‌کند)') } catch (_) { } } }
    persist();
    if (!next && Date.now() - start > LIFE - 8 * 60e3) { next = true; try { await dispatchNext() } catch (e) { console.log('dispatch failed', e.message) } }
    await sleep(15000);
  }
  persist();
}

// ---------- main ----------
(async () => {
  const mode = process.argv[2];
  console.log('mode', mode, 'tehran', teh().toISOString().slice(0, 16), 'index', S.index, 'force', FORCE);
  if (mode === 'render') return render(Q.find(q => q.id === process.argv[3]), process.argv[4], process.argv[5]);
  if (!TT) throw new Error('TELEGRAM_TOKEN missing');
  if (WINDOW[mode] && !FORCE) { const h = hour(); if (h < WINDOW[mode][0] || h >= WINDOW[mode][1]) return console.log('outside window, skip', mode, h.toFixed(2)) }
  if (['daemon', 'tick', 'ask', 'preview', 'publish', 'register', 'ping', 'now'].includes(mode)) await pull(); // only the bot reads Telegram, so no message is consumed twice
  if (mode === 'register') return console.log('amir', !!S.amir_tg, 'owner', !!S.owner_tg);
  if (mode === 'ping') return owner('⏰ زمان‌بند کار می‌کند.\n' + status());
  if (mode === 'daemon') return daemon();
  if (mode === 'tick') return tick();
  if (mode === 'ask') return ask();
  if (mode === 'preview') return preview();
  if (mode === 'publish') return publish();
  if (mode === 'rbinfo') { const g = await rb('getChat', { chat_id: cfg.group_chat_id }); console.log('GROUP', JSON.stringify(g)); const u = await rb('getUpdates', { limit: 100 }); const chats = {}; for (const x of (u.data && u.data.updates) || []) chats[x.chat_id] = x.type; console.log('CHATS', JSON.stringify(chats)); for (const id of Object.keys(chats)) { try { const c = await rb('getChat', { chat_id: id }); console.log('CHAT', id, JSON.stringify(c)) } catch (e) { } } return }
  if (mode === 'rbfwd') { const r = await rb('forwardMessage', { from_chat_id: cfg.group_chat_id, message_id: process.argv[3], to_chat_id: S.rb_test_chat }); console.log('FWD', JSON.stringify(r)); return }
  if (mode === 'repost') { // re-send today's post to the group with a given name (no queue change)
    const c = S.cycle, it = itemOf(c), name = cleanName(process.argv.slice(3).join(' '));
    if (!nameOk(name)) throw new Error('repost needs a name');
    await render(it, name, 'today.jpg'); const id = await rubikaPost(cfg.group_chat_id, 'today.jpg', caption(it, name));
    c.name = name; c.rubika_id = id; save(); await tgPhoto(S.owner_tg, 'today.jpg', '🔁 پست دوباره در گروه روبیکا فرستاده شد — ' + name + '\nلطفاً در گروه چک کن.'); return }
  if (mode === 'diag') { // Rubika group delivery diagnostics
    const g = cfg.group_chat_id, old = process.argv[3];
    if (old) console.log('DIAG delete-old', JSON.stringify(await rb('deleteMessage', { chat_id: g, message_id: old })));
    const t = await rb('sendMessage', { chat_id: g, text: '🔧 تست اتصال ربات (متن)' }); console.log('DIAG text', JSON.stringify(t));
    const it = itemOf(S.cycle) || Q[0]; const pic = await askPhoto(it);
    const id = await rubikaPost(g, pic, '🔧 تست اتصال ربات (عکس)'); console.log('DIAG image', id);
    S.diag = { text: t.data && t.data.message_id, image: id }; save();
    await owner('🔧 دو پیام تستی به گروه روبیکا رفت: یک متن «🔧 تست اتصال ربات (متن)» و یک عکس «🔧 تست اتصال ربات (عکس)». کدام را در گروه می‌بینی؟'); return }
  if (mode === 'diagclean') { for (const k of ['text', 'image']) if (S.diag && S.diag[k]) console.log('DIAG del', k, JSON.stringify(await rb('deleteMessage', { chat_id: cfg.group_chat_id, message_id: S.diag[k] }))); return }
  if (mode === 'now') return now();
  if (mode === 'test') return test(+process.argv[3] || 1);
  throw new Error('unknown mode ' + mode);
})().catch(async e => { console.error('ERR', clean(e.stack || e)); try { save(); await owner('❌ خطا در روند پست روزانه: ' + clean(e.message)) } catch (_) { } process.exit(1) });
