const fs=require('fs'),path=require('path');
const T=process.env.RUBIKA_TOKEN||'';const clean=s=>T?String(s).split(T).join('***'):String(s);
const api=async(m,b)=>{const r=await fetch(`https://botapi.rubika.ir/v3/${T}/${m}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b),signal:AbortSignal.timeout(30000)});const x=await r.text();console.log('RUBIKA',m,r.status,clean(x).slice(0,500));return JSON.parse(x)};
(async()=>{
 fs.mkdirSync('public/posts',{recursive:true});
 for(const f of fs.readdirSync('posts'))fs.copyFileSync(path.join('posts',f),path.join('public/posts',f));
 fs.writeFileSync('public/index.html','ok');
 const q=JSON.parse(fs.readFileSync('rubika.json','utf8'));
 if(!T){console.log('RUBIKA no token');return}
 await api('getChat',{chat_id:q.chat_id});
 if(!q.send){console.log('RUBIKA send=false, nothing sent');return}
 const up=await api('requestSendFile',{type:'Image'});const url=up.data&&up.data.upload_url;if(!url)throw new Error('no upload url');
 const fd=new FormData();fd.append('file',new Blob([fs.readFileSync(q.image)],{type:'image/jpeg'}),path.basename(q.image));
 const u=await fetch(url,{method:'POST',body:fd,signal:AbortSignal.timeout(60000)});const ut=await u.text();console.log('RUBIKA upload',u.status,clean(ut).slice(0,300));
 const fid=JSON.parse(ut).data.file_id;
 const s=await api('sendFile',{chat_id:q.chat_id,file_id:fid,text:fs.readFileSync(q.caption,'utf8').trim()});
 if(s.status!=='OK')throw new Error('send failed');console.log('RUBIKA SENT');
})().catch(e=>{console.error('RUBIKA-ERR',clean(e.message));process.exit(1)});
