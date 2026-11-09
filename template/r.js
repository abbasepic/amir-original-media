const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1350}});p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('file://'+process.cwd()+'/post.html');await p.evaluate(()=>document.fonts.ready);
const n=await p.evaluate(()=>POSTS.length);const fs=require('fs');fs.mkdirSync('out',{recursive:true});
for(let i=0;i<n;i++){await p.evaluate(i=>show(i),i);await p.waitForFunction(()=>[...document.images].every(x=>x.complete||x.style.display=='none'));await p.waitForTimeout(120);
 const m=await p.evaluate(()=>{const q=s=>document.querySelector(s).getBoundingClientRect();const w=q('#wrap');return{id:POSTS.find((_,k)=>0)?0:0,sb:Math.round(w.bottom),chOv:[...document.querySelectorAll('.ch div')].map(d=>d.scrollHeight>d.clientHeight+1)}});
 const id=await p.evaluate(i=>POSTS[i].id,i);console.log(id,JSON.stringify(m));await p.screenshot({path:`out/${id}.jpg`,type:'jpeg',quality:93});}
await b.close()})();
