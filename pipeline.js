// mode: ask | preview | publish | whoami
const fs=require('fs'),path=require('path');
const T=process.env.RUBIKA_TOKEN||'';if(!T&&process.argv[2]!=='render')throw new Error('RUBIKA_TOKEN missing');
const clean=s=>T?String(s).split(T).join('***'):String(s);
const api=async(m,b)=>{const r=await fetch(`https://botapi.rubika.ir/v3/${T}/${m}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b),signal:AbortSignal.timeout(30000)});const x=await r.text();console.log(m,r.status,clean(x).slice(0,400));return JSON.parse(x)};
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));const write=(f,o)=>fs.writeFileSync(f,JSON.stringify(o,null,1));
const cfg=read('config.json'),Q=read('queue.json'),S=read('state.json');
const today=new Date(Date.now()+3.5*3600e3).toISOString().slice(0,10);
const say=(c,t)=>c?api('sendMessage',{chat_id:c,text:t}):console.log('no chat',t);
async function sendImg(chat,file,text){const up=await api('requestSendFile',{type:'Image'});const fd=new FormData();fd.append('file',new Blob([fs.readFileSync(file)],{type:'image/jpeg'}),path.basename(file));const u=await fetch(up.data.upload_url,{method:'POST',body:fd,signal:AbortSignal.timeout(60000)});const j=JSON.parse(await u.text());const s=await api('sendFile',{chat_id:chat,file_id:j.data.file_id,text});if(s.status!=='OK')throw new Error('sendFile failed');return s}
async function updates(){let out=[];for(let n=0;n<20;n++){const b={limit:100};if(S.offset)b.offset_id=S.offset;const r=await api('getUpdates',b);const u=(r.data&&r.data.updates)||[];out=out.concat(u);if(r.data&&r.data.next_offset_id)S.offset=r.data.next_offset_id;if(u.length<100)break}return out}
const textsFrom=(us,chat)=>us.filter(u=>u.type==='NewMessage'&&u.chat_id===chat&&u.new_message&&u.new_message.text&&u.new_message.sender_type!=='Bot').map(u=>u.new_message.text.trim());
const caption=(p,name)=>`همکار عزیز، ${name} با دو سال ضمانت موجوده. قفسه‌ت رو پر کن. 👇\n\n${name} از برند ${p.brand}\n✅ موجود برای سفارش عمده\n✅ دو سال ضمانت\n✅ تأمین و ارسال سریع\n\nقطعه‌ای که ضمانتش معلومه، راحت‌تر فروش می‌ره و کمتر برگشت می‌خوره.\n\n📞 برای قیمت عمده و ثبت سفارش، همین الان تماس بگیر:\n09122525516\n\n📍 قم، خیابان کشاورز شمالی، نبش ۳۶\nفروش فقط به‌صورت عمده\n\n#پخش_عمده #لوازم_یدکی #قطعات_یدکی #${p.brand.replace(/[ .]/g,'_')} #قم`;
async function render(p,name,out){const {chromium}=require('playwright');const esc=s=>s.replace(/[<>&]/g,'');
 const post={id:'x',img:'../'+p.img,box:p.box?'carton.png':undefined,card:p.card,h:p.h,s:`${p.brand} با <em>دو سال ضمانت</em>`,c:p.c,name:esc(name)};
 fs.writeFileSync('template/posts.js','window.POSTS='+JSON.stringify([post]));
 const b=await chromium.launch();const pg=await b.newPage({viewport:{width:1080,height:1350}});await pg.goto('file://'+path.resolve('template/post.html'));await pg.evaluate(()=>document.fonts.ready);await pg.evaluate(()=>show(0));await pg.waitForFunction(()=>[...document.images].every(x=>x.complete));await pg.waitForTimeout(200);await pg.screenshot({path:out,type:'jpeg',quality:93});await b.close()}
(async()=>{const mode=process.argv[2];console.log('mode',mode,'date',today,'index',S.index);
 if(mode==='render'){const p=Q.find(q=>q.id===process.argv[3]);await render(p,process.argv[4],process.argv[5]);return}
 if(mode==='whoami'){const us=await updates();for(const u of us)console.log('UPD',u.type,u.chat_id,clean(JSON.stringify(u.new_message||u.event_data||{})).slice(0,200));write('state.json',S);return}
 const it=Q[S.index];
 if(!it){await say(cfg.owner_chat_id,'صف پست‌ها تمام شد؛ عکس قطعه‌های جدید لازم است.');return}
 if(mode==='ask'){if(S.today&&S.today.date===today){console.log('already asked');return}
  await updates();const pic=path.join(fs.mkdtempSync('/tmp/a'),'q.jpg');const sharp=require('sharp');await sharp(it.img).flatten({background:'#ffffff'}).resize(900,900,{fit:'inside'}).jpeg({quality:88}).toFile(pic);
  await sendImg(cfg.amir_chat_id,pic,'سلام آقای شوندی 🌹\nنام دقیق این قطعه چیه؟ لطفاً فقط نام کامل رو بنویسید تا ساعت ۱۸ توی کانال بره.');S.today={date:today,item:it.id};write('state.json',S);return}
 if(!S.today||S.today.date!==today){await say(cfg.owner_chat_id,'امروز پرسش نام قطعه انجام نشده بود؛ پست منتشر نمی‌شود.');return}
 const us=await updates();
 if(mode==='preview'){const names=textsFrom(us,cfg.amir_chat_id).filter(x=>x.length>=4&&x.length<=70&&!/سلام|باشه|ممنون/.test(x));if(!names.length){S.today.skip=true;write('state.json',S);await say(cfg.owner_chat_id,'آقای شوندی نام قطعه‌ی امروز را نفرستاد؛ پست ساعت ۱۸ منتشر نمی‌شود.');return}
  const name=names[names.length-1];S.today.name=name;await render(it,name,'today.jpg');await sendImg(cfg.owner_chat_id,'today.jpg','پیش‌نمایش پست ساعت ۱۸:\n\n'+caption(it,name)+'\n\n———\nاگر نمی‌خواهی منتشر شود تا ساعت ۱۸ بنویس: توقف');write('state.json',S);return}
 if(mode==='publish'){if(S.today.skip||S.today.published)return;if(!S.today.name){await say(cfg.owner_chat_id,'نام قطعه ثبت نشده؛ پست منتشر نشد.');return}
  if(textsFrom(us,cfg.owner_chat_id).some(x=>/توقف/.test(x))){S.today.skip=true;write('state.json',S);await say(cfg.owner_chat_id,'پست امروز متوقف شد و منتشر نشد.');return}
  await render(it,S.today.name,'today.jpg');const name=S.today.name;await sendImg(cfg.group_chat_id,'today.jpg',caption(it,name));S.today.published=true;S.index++;write('state.json',S);await say(cfg.owner_chat_id,'✅ پست امروز منتشر شد: '+name);return}
})().catch(async e=>{console.error('ERR',clean(e.stack||e));try{write('state.json',S);await say(cfg.owner_chat_id,'خطا در انتشار پست امروز: '+clean(e.message))}catch(_){}process.exit(1)});
