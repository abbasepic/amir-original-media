// modes: ask | preview | publish | render <id> <name> <out>
// Name question + preview + stop go through Telegram; the post goes to the Rubika group.
const fs=require('fs'),path=require('path');
const RT=process.env.RUBIKA_TOKEN||'',TT=process.env.TELEGRAM_TOKEN||'';
const clean=s=>{s=String(s);for(const t of [RT,TT])if(t)s=s.split(t).join('***');return s};
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));const write=(f,o)=>fs.writeFileSync(f,JSON.stringify(o,null,1));
const cfg=read('config.json'),Q=read('queue.json'),S=read('state.json');
const today=new Date(Date.now()+3.5*3600e3).toISOString().slice(0,10);
// ---------- Telegram ----------
const tg=async(m,body,form)=>{const r=await fetch(`https://api.telegram.org/bot${TT}/${m}`,form?{method:'POST',body:form,signal:AbortSignal.timeout(60000)}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const j=await r.json();console.log('TG',m,r.status,clean(JSON.stringify(j)).slice(0,300));if(!j.ok)throw new Error('telegram '+m+' failed: '+(j.description||''));return j.result};
const tgText=(chat,text)=>chat?tg('sendMessage',{chat_id:chat,text}):console.log('NO TG CHAT:',text);
const tgPhoto=(chat,file,caption)=>{const f=new FormData();f.append('chat_id',String(chat));f.append('caption',caption);f.append('photo',new Blob([fs.readFileSync(file)],{type:'image/jpeg'}),'p.jpg');return tg('sendPhoto',null,f)};
async function tgUpdates(){const out=[];for(let n=0;n<10;n++){const b={timeout:0,allowed_updates:['message']};if(S.tg_offset)b.offset=S.tg_offset;const u=await tg('getUpdates',b);if(!u.length)break;for(const x of u){S.tg_offset=x.update_id+1;if(x.message&&x.message.text)out.push({chat:x.message.chat.id,user:(x.message.from&&x.message.from.username||'').toLowerCase(),text:x.message.text.trim()})}}
 for(const m of out){if(cfg.amir_username&&m.user===cfg.amir_username.toLowerCase()&&!S.amir_tg){S.amir_tg=m.chat;console.log('amir registered by username')}}
 for(const m of out){if(m.text.startsWith('/start')&&!S.owner_tg&&m.chat!==S.amir_tg&&m.user!==(cfg.amir_username||'').toLowerCase()){S.owner_tg=m.chat;await tgText(m.chat,'ثبت شد ✅ شما مدیر هستید؛ پیش‌نمایش‌ها و گزارش‌ها برای شما می‌آید.')}}
 for(const m of out){if(m.text==='شوندی'&&!S.amir_tg){S.amir_tg=m.chat;await tgText(m.chat,'ثبت شد ✅ از این به بعد هر روز ساعت ۱۲ نام قطعه‌ی همان روز از شما پرسیده می‌شود.')}
  if(m.text==='مدیر'&&!S.owner_tg){S.owner_tg=m.chat;await tgText(m.chat,'ثبت شد ✅ پیش‌نمایش‌ها و گزارش‌ها برای شما می‌آید. برای جلوگیری از انتشار، تا ساعت ۱۸ بنویسید: توقف')}}
 return out}
const owner=t=>tgText(S.owner_tg,t);
const nameOk=x=>x.length>=4&&x.length<=70&&!x.startsWith('/')&&!/^(سلام|باشه|ممنون|شوندی|مدیر)/.test(x);
// ---------- Rubika (group post) ----------
const rb=async(m,b)=>{const r=await fetch(`https://botapi.rubika.ir/v3/${RT}/${m}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b),signal:AbortSignal.timeout(30000)});const x=await r.text();console.log('RB',m,r.status,clean(x).slice(0,300));return JSON.parse(x)};
async function rubikaPost(chat,file,text){const up=await rb('requestSendFile',{type:'Image'});const fd=new FormData();fd.append('file',new Blob([fs.readFileSync(file)],{type:'image/jpeg'}),'post.jpg');const u=await fetch(up.data.upload_url,{method:'POST',body:fd,signal:AbortSignal.timeout(60000)});const j=JSON.parse(await u.text());const s=await rb('sendFile',{chat_id:chat,file_id:j.data.file_id,text});if(s.status!=='OK')throw new Error('rubika sendFile failed');return s}
// ---------- content ----------
const caption=(p,name)=>`همکار عزیز، ${name} با دو سال ضمانت موجوده. قفسه‌ت رو پر کن. 👇\n\n${name} از برند ${p.brand}\n✅ موجود برای سفارش عمده\n✅ دو سال ضمانت\n✅ تأمین و ارسال سریع\n\nقطعه‌ای که ضمانتش معلومه، راحت‌تر فروش می‌ره و کمتر برگشت می‌خوره.\n\n📞 برای قیمت عمده و ثبت سفارش، همین الان تماس بگیر:\n09122525516\n\n📍 قم، خیابان کشاورز شمالی، نبش ۳۶\nفروش فقط به‌صورت عمده\n\n#پخش_عمده #لوازم_یدکی #قطعات_یدکی #${p.brand.replace(/[ .]/g,'_')} #قم`;
async function render(p,name,out){const {chromium}=require('playwright');const esc=s=>s.replace(/[<>&]/g,'');
 const post={id:'x',img:'../'+p.img,box:p.box?'carton.png':undefined,card:p.card,h:p.h,s:`${p.brand} با <em>دو سال ضمانت</em>`,c:p.c,name:esc(name)};
 fs.writeFileSync('template/posts.js','window.POSTS='+JSON.stringify([post]));
 const b=await chromium.launch();const pg=await b.newPage({viewport:{width:1080,height:1350}});await pg.goto('file://'+path.resolve('template/post.html'));await pg.evaluate(()=>document.fonts.ready);await pg.evaluate(()=>show(0));await pg.waitForFunction(()=>[...document.images].every(x=>x.complete));await pg.waitForTimeout(200);await pg.screenshot({path:out,type:'jpeg',quality:93});await b.close()}
async function nowMode(first){try{const me=await tg('getMe',{});console.log('BOT @'+me.username)}catch(e){}const it=Q[S.index];const end=Date.now()+320*60e3;let msgs=first;
 const save=()=>write('state.json',S);
 if(S.today&&S.today.date===today&&S.today.published){console.log('already published today');return}
 while(Date.now()<end){
  if(S.amir_tg&&!(S.today&&S.today.date===today&&S.today.asked)){
   const sharp=require('sharp');const pic=path.join(fs.mkdtempSync('/tmp/a'),'q.jpg');await sharp(it.img).flatten({background:'#ffffff'}).resize(900,900,{fit:'inside'}).jpeg({quality:88}).toFile(pic);
   await tgPhoto(S.amir_tg,pic,'سلام آقای شوندی 🌹\nنام دقیق این قطعه چیه؟ لطفاً فقط نام کامل رو بنویسید تا توی کانال روبیکا بره.');
   S.today={date:today,item:it.id,asked:true};save();await owner('آقای شوندی ربات را استارت کرد و نام قطعه از او پرسیده شد.');msgs=[]}
  else if(S.amir_tg){const n=msgs.filter(m=>m.chat===S.amir_tg).map(m=>m.text).filter(nameOk);
   if(n.length){S.today.name=n[n.length-1];save();
    if(!RT)throw new Error('RUBIKA_TOKEN missing');
    await render(it,S.today.name,'today.jpg');await rubikaPost(cfg.group_chat_id,'today.jpg',caption(it,S.today.name));
    S.today.published=true;S.index++;save();await tgText(S.amir_tg,'ممنون 🌹 پست ثبت شد.');
    if(S.owner_tg)await tgPhoto(S.owner_tg,'today.jpg','✅ پست امروز در گروه روبیکا منتشر شد — '+S.today.name);return}}
  await new Promise(r=>setTimeout(r,20000));try{msgs=await tgUpdates()}catch(e){console.log('poll error',clean(e.message));msgs=[]}save()}
 if(!(S.today&&S.today.date===today)){S.today={date:today,item:it.id}}S.today.skip=true;save();await owner('امروز آقای شوندی تا پایان زمان انتظار جواب نداد؛ پستی منتشر نشد.')}
// ---------- main ----------
(async()=>{const mode=process.argv[2];console.log('mode',mode,'date',today,'index',S.index);
 if(mode==='render'){await render(Q.find(q=>q.id===process.argv[3]),process.argv[4],process.argv[5]);return}
 if(!TT)throw new Error('TELEGRAM_TOKEN missing');
 const msgs=await tgUpdates();write('state.json',S);
 if(mode==='register'){console.log('amir',!!S.amir_tg,'owner',!!S.owner_tg);return}
 if(mode==='now')return nowMode(msgs);
 const it=Q[S.index];
 if(!it){await owner('صف پست‌ها تمام شد؛ عکس قطعه‌های جدید لازم است.');return}
 if(mode==='ask'){if(S.today&&S.today.date===today){console.log('already asked');return}
  if(!S.amir_tg){await owner('آقای شوندی هنوز ربات تلگرام را استارت نکرده؛ امروز پستی منتشر نمی‌شود.');S.today={date:today,item:it.id,skip:true};write('state.json',S);return}
  const sharp=require('sharp');const pic=path.join(fs.mkdtempSync('/tmp/a'),'q.jpg');await sharp(it.img).flatten({background:'#ffffff'}).resize(900,900,{fit:'inside'}).jpeg({quality:88}).toFile(pic);
  await tgPhoto(S.amir_tg,pic,'سلام آقای شوندی 🌹\nنام دقیق این قطعه چیه؟ لطفاً فقط نام کامل رو بنویسید تا ساعت ۱۸ توی کانال روبیکا بره.');
  S.today={date:today,item:it.id};write('state.json',S);return}
 if(!S.today||S.today.date!==today){await owner('امروز نام قطعه پرسیده نشده بود؛ پست منتشر نمی‌شود.');return}
 if(mode==='preview'){if(S.today.skip||S.today.published)return;
  const names=msgs.filter(m=>m.chat===S.amir_tg).map(m=>m.text).filter(x=>x.length>=4&&x.length<=70&&!/^(سلام|باشه|ممنون|شوندی)/.test(x));
  if(names.length)S.today.name=names[names.length-1];
  if(!S.today.name){S.today.skip=true;write('state.json',S);await owner('آقای شوندی نام قطعه‌ی امروز را نفرستاد؛ پست ساعت ۱۸ منتشر نمی‌شود.');return}
  await render(it,S.today.name,'today.jpg');await tgPhoto(S.owner_tg,'today.jpg','پیش‌نمایش پست ساعت ۱۸ — نام قطعه: '+S.today.name);await owner('کپشن:\n\n'+caption(it,S.today.name)+'\n\n———\nاگر نمی‌خواهی منتشر شود، تا ساعت ۱۸ بنویس: توقف');write('state.json',S);return}
 if(mode==='publish'){if(S.today.skip||S.today.published)return;
  const late=msgs.filter(m=>m.chat===S.amir_tg).map(m=>m.text).filter(x=>x.length>=4&&x.length<=70&&!/^(سلام|باشه|ممنون|شوندی)/.test(x));
  if(!S.today.name){await owner('نام قطعه ثبت نشده؛ پست منتشر نشد.');return}
  if(msgs.some(m=>m.chat===S.owner_tg&&/توقف/.test(m.text))){S.today.skip=true;write('state.json',S);await owner('پست امروز متوقف شد و منتشر نشد.');return}
  if(!RT)throw new Error('RUBIKA_TOKEN missing');
  await render(it,S.today.name,'today.jpg');await rubikaPost(cfg.group_chat_id,'today.jpg',caption(it,S.today.name));
  S.today.published=true;S.index++;write('state.json',S);await owner('✅ پست امروز در گروه روبیکا منتشر شد: '+S.today.name+(late.length?'\n(پیام بعد از پیش‌نمایش از آقای شوندی رسید و استفاده نشد: '+late[late.length-1]+')':''));return}
})().catch(async e=>{console.error('ERR',clean(e.stack||e));try{write('state.json',S);await owner('خطا در کار پست روزانه: '+clean(e.message))}catch(_){}process.exit(1)});
