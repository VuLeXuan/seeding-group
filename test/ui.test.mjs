import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {titleFor,relTime,loginText} from '../public/format.js';
import * as queuePage from '../public/queue-page.js';
import * as postPage from '../public/post-page.js';

const root=fileURLToPath(new URL('..',import.meta.url)),entry=join(root,'server','node.mjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise((res,rej)=>{const s=createServer();s.on('error',rej);s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>res(port));});});

test('titleFor',()=>{assert.equal(titleFor(0),'FB Auto Post');assert.equal(titleFor(3),'(3) FB Auto Post');});
test('relTime',()=>{
  const now=new Date('2026-11-18T12:00:00Z');
  assert.equal(relTime('2026-11-18T10:00:00Z',now),'2 giờ trước');
  assert.equal(relTime('2026-11-18T11:59:50Z',now),'vừa xong');
  assert.equal(relTime('2026-11-18T11:15:00Z',now),'45 phút trước');
  assert.equal(relTime('2026-11-16T12:00:00Z',now),'2 ngày trước');
  assert.equal(relTime('2026-11-18T13:00:00Z',now),'vừa xong');
  assert.equal(relTime(null,now),'');
  assert.equal(relTime('không phải ngày',now),'');
});
test('GET / trả index.html có #app',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'fb-ui-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const port=await freePort();
  const child=spawn(process.execPath,[entry],{cwd:root,env:{PATH:process.env.PATH,HOME:process.env.HOME,DATABASE_PATH:join(dir,'fb.sqlite'),DATA_DIR:dir,HOST:'127.0.0.1',PORT:String(port),WORKERS:'off'},stdio:['ignore','pipe','pipe']});
  let out='';child.stdout.on('data',c=>{out+=c;});child.stderr.on('data',c=>{out+=c;});
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
  const end=Date.now()+10000;while(!out.includes('FB Auto Post: http://')){if(Date.now()>end)throw new Error('server did not start: '+out);await sleep(20);}
  const res=await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/text\/html/);
  const CSP="default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'";
  assert.equal(res.headers.get('content-security-policy'),CSP,'M3: CSP trên trang');
  assert.equal((await fetch(`http://127.0.0.1:${port}/app.js`)).headers.get('content-security-policy'),CSP,'M3: CSP trên file tĩnh');
  assert.match(await res.text(),/id="app"/);
  for(const f of ['app.js','format.js','styles.css','queue-page.js','post-page.js','groups-page.js','kb-page.js','settings-page.js'])assert.equal((await fetch(`http://127.0.0.1:${port}/${f}`)).status,200,f);
  child.kill('SIGTERM');
});

// final fix wave: a few lines of fake DOM, enough for el(), the queue page and the post page (no browser in npm test)
class FakeNode{
  constructor(tag){this.tagName=tag.toUpperCase();this.attributes={};this.childNodes=[];this.listeners={};this.className='';this.disabled=false;this.hidden=false;this.value='';}
  setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k]??null;}removeAttribute(k){delete this.attributes[k];}
  addEventListener(k,f){(this.listeners[k]??=[]).push(f);}
  append(...k){this.childNodes.push(...k);}replaceChildren(...k){this.childNodes=k;}
  contains(n){return n===this||this.childNodes.some(c=>c.contains?.(n));}focus(){}
  get textContent(){return this.childNodes.map(c=>c.textContent).join('');}set textContent(v){this.childNodes=[{textContent:String(v)}];}
  all(pred){const out=[],walk=n=>{if(n.tagName&&pred(n))out.push(n);n.childNodes?.forEach(walk);};walk(this);return out;}
  click(){for(const f of this.listeners.click||[])f({currentTarget:this,target:this});}
}
function fakeDom(t){
  const saved={document:globalThis.document,Node:globalThis.Node,fetch:globalThis.fetch},modal=new FakeNode('div'),dom={log:[],routes:{},modal};
  globalThis.Node=FakeNode;
  globalThis.document={createElement:tag=>new FakeNode(tag),createTextNode:s=>({textContent:s}),getElementById:id=>id==='modal-root'?modal:null,addEventListener(){},removeEventListener(){},activeElement:null};
  globalThis.fetch=async(url,init={})=>{const method=init.method||'GET';dom.log.push({url,method,body:init.body?JSON.parse(init.body):undefined});const h=dom.routes[method+' '+url]??dom.routes[url];return {ok:true,status:200,json:async()=>typeof h==='function'?await h():h};};
  t.after(()=>Object.assign(globalThis,saved));
  return dom;
}
const tick=()=>new Promise(r=>setImmediate(r));
const row=o=>({id:'r1',draft:'Dạ có ạ',final_text:null,category:'spec',grounded:1,reason:'Giai đoạn 1: chờ duyệt',comment_text:'Có 4G không?',author_name:'An',group_name:'Nhóm 1',post_text:'Bài',created_at:'2026-11-18T11:00:00Z',commentUrl:null,...o});
async function queueCards(t,rows,routes={}){
  const dom=fakeDom(t);Object.assign(dom.routes,{'/api/queue?status=waiting':rows},routes);
  const root=new FakeNode('div');await queuePage.render(root,{state:{counts:{waiting:rows.length,failed:0}},refresh:async()=>{}});queuePage.destroy();
  return {dom,cards:root.all(n=>n.tagName==='ARTICLE')};
}
const buttons=n=>n.all(x=>x.tagName==='BUTTON');
test('M4: thẻ chờ duyệt có «Mở trên Facebook» khi có link https, không có thì thôi',async t=>{
  const {cards}=await queueCards(t,[row({commentUrl:'https://www.facebook.com/groups/1/posts/9/?comment_id=f1'}),row({id:'r2',commentUrl:'javascript:alert(1)'}),row({id:'r3'})]);
  const links=cards.map(c=>c.all(n=>n.tagName==='A'));
  assert.equal(links[0].length,1);assert.equal(links[0][0].textContent,'Mở trên Facebook');assert.equal(links[0][0].getAttribute('href'),'https://www.facebook.com/groups/1/posts/9/?comment_id=f1');
  assert.equal(links[0][0].getAttribute('rel'),'noopener');assert.equal(links[1].length,0);assert.equal(links[2].length,0);
});
test('C1: bấm một nút của thẻ thì khoá mọi nút của thẻ tới khi xong',async t=>{
  let release;const gate=new Promise(r=>{release=r;});
  const {dom,cards}=await queueCards(t,[row(),row({id:'r2'})],{'POST /api/replies/r1/redraft':async()=>{await gate;return {};}});
  const b=buttons(cards[0]);assert.deepEqual(b.map(x=>x.textContent),['Gửi','Soạn lại','Bỏ qua']);
  b[1].click();await tick();
  assert.deepEqual(b.map(x=>x.disabled),[true,true,true],'đang soạn lại thì không bấm Gửi được');
  assert.deepEqual(buttons(cards[1]).map(x=>x.disabled),[false,false,false],'thẻ khác không bị khoá');
  release();await tick();await tick();
  assert.deepEqual(b.map(x=>x.disabled),[false,false,false]);
  assert.ok(dom.log.some(c=>c.method==='POST'&&c.url==='/api/replies/r1/redraft'));
});
test('I6: nháp rỗng (Claude không soạn được) có ô gõ kèm gợi ý, gõ xong bấm Gửi được',async t=>{
  const {dom,cards}=await queueCards(t,[row({draft:'',category:null,grounded:null,reason:'Claude không soạn được (DRAFT_SCHEMA), anh tự viết'})],{'POST /api/replies/r1/send':{status:'approved'}});
  const ta=cards[0].all(n=>n.tagName==='TEXTAREA')[0];
  assert.equal(ta.value,'');assert.match(ta.getAttribute('placeholder')||'',/anh tự viết/);
  ta.value='Dạ shop tự viết ạ';ta.listeners.input.forEach(f=>f());
  buttons(cards[0])[0].click();await tick();await tick();
  assert.deepEqual(dom.log.find(c=>c.method==='POST'),{url:'/api/replies/r1/send',method:'POST',body:{text:'Dạ shop tự viết ạ'}});
});
test('I7: dải báo vàng: hết credit và Claude tạm ngừng (giờ Việt Nam), không có gì thì rỗng',async()=>{
  const {alertLines}=await import('../public/format.js');
  const s={config:{creditCapPerDay:500},creditsToday:503,alerts:{creditCap:true,drafting:{until:'2026-11-18T07:05:00Z',code:'CLAUDE_AUTH'}}};
  assert.deepEqual(alertLines(s),['Đã dùng hết 500 credit hôm nay, ngừng đọc comment tới 0 giờ.','Claude tạm ngừng soạn tới 14:05 (Claude chưa đăng nhập).']);
  assert.deepEqual(alertLines({...s,alerts:{creditCap:false,drafting:{until:'2026-11-18T07:05:00Z',code:'LẠ'}}}),['Claude tạm ngừng soạn tới 14:05 (LẠ).']);
  assert.deepEqual(alertLines({...s,alerts:{creditCap:false,drafting:null}}),[]);
  assert.deepEqual(alertLines({...s,alerts:undefined}),[]);
});
test('I8: trang Đăng bài: «Huỷ» chỉ ở bài đã hẹn giờ; xác nhận thì gọi /cancel',async t=>{
  const dom=fakeDom(t);
  dom.routes={'/api/groups':[],'/api/posts':[{id:'p1',text:'Bài',images:[],created_at:'2026-11-18T11:00:00Z',targets:[
    {id:'s1',status:'scheduled',scheduled_at:'2026-11-19T00:00:00Z',group_name:'Nhóm 1'},{id:'t1',status:'published',permalink:'https://www.facebook.com/groups/1/posts/9/',group_name:'Nhóm 2'}]}],'POST /api/targets/s1/cancel':{ok:true}};
  const root=new FakeNode('div');await postPage.render(root,{state:{config:{maxImages:10}}});
  const items=root.all(n=>n.tagName==='LI');
  assert.deepEqual(items.map(li=>buttons(li).map(b=>b.textContent)),[['Huỷ'],['Đọc ngay']]);
  buttons(items[0])[0].click();await tick();
  const ok=buttons(dom.modal).find(b=>b.textContent==='Huỷ đăng');assert.ok(ok,'có hộp xác nhận');ok.click();await tick();await tick();
  assert.ok(dom.log.some(c=>c.method==='POST'&&c.url==='/api/targets/s1/cancel'));
});

test('loginText: mọi trường hợp, giờ HH:MM theo giờ Việt Nam',()=>{
  const at='2026-11-20T08:05:00Z',hm='15:05'; // Vietnam time, UTC+7
  const base={loginRequested:false,loginWindowOpen:false,loginState:'unknown',loginCheckedAt:null,loginError:null};
  const t=o=>loginText({...base,...o});
  assert.deepEqual(t({loginRequested:true}),{dot:'wait',text:'Facebook: đã gửi yêu cầu mở cửa sổ…'});
  assert.deepEqual(t({loginState:'logged_in',loginCheckedAt:at,loginWindowOpen:true}),{dot:'ok',text:`Facebook: đã đăng nhập (kiểm lúc ${hm})`});
  assert.deepEqual(t({loginState:'checkpoint'}),{dot:'off',text:'Facebook bắt xác minh'});
  assert.deepEqual(t({loginState:'checkpoint',loginWindowOpen:true}),{dot:'off',text:'Facebook bắt xác minh — nhập trong cửa sổ Chrome'});
  for(const s of ['logged_out','unknown'])assert.deepEqual(t({loginState:s,loginWindowOpen:true}),{dot:'wait',text:'Facebook: đăng nhập trong cửa sổ Chrome…'});
  for(const s of ['logged_out','login_required'])assert.deepEqual(t({loginState:s}),{dot:'off',text:'Facebook: chưa đăng nhập'});
  assert.deepEqual(t({loginState:'error',loginError:'Không mở được Chrome: x'}),{dot:'off',text:'Facebook: Không mở được Chrome: x'});
  assert.deepEqual(t({}),{dot:'wait',text:'Facebook: chưa rõ trạng thái đăng nhập'});
});
