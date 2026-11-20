import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../server/db.mjs';
import {setRuntime} from '../server/settings.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),entry=join(root,'server','node.mjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=10000){const end=Date.now()+ms;while(!fn()){if(Date.now()>end)throw new Error('timed out waiting');await sleep(20);}}
const freePort=()=>new Promise((res,rej)=>{const s=createServer();s.on('error',rej);s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>res(port));});});
test('khởi động: replies sending và post_targets posting → failed, không bao giờ gửi lại; API 16 KB và 8 MB',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'fb-boot-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'fb.sqlite'),now=new Date().toISOString();
  const db=openDatabase(file);
  await db.run("INSERT INTO fb_groups(id,url,added_at) VALUES('g','https://www.facebook.com/groups/1/',?)",[now]);
  await db.run("INSERT INTO posts(id,text,created_at) VALUES('p','x',?)",[now]);
  await db.run("INSERT INTO post_targets(id,post_id,group_id,scheduled_at,status) VALUES('t1','p','g',?,'posting'),('t2','p','g',?,'scheduled')",[now,now]);
  await db.run("INSERT INTO comments(id,target_id,fb_comment_id,text,fetched_at) VALUES('c','t1','f','x',?)",[now]);
  await db.run("INSERT INTO replies(id,comment_id,status,created_at) VALUES('r','c','sending',?)",[now]);
  db.close();
  const port=await freePort();
  const child=spawn(process.execPath,[entry],{cwd:root,env:{PATH:process.env.PATH,HOME:process.env.HOME,DATABASE_PATH:file,DATA_DIR:dir,HOST:'127.0.0.1',PORT:String(port),WORKERS:'off'},stdio:['ignore','pipe','pipe']});
  let out='';child.stdout.on('data',c=>{out+=c;});child.stderr.on('data',c=>{out+=c;});
  const exited=new Promise(r=>child.on('exit',(code,signal)=>r({code,signal})));
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
  await until(()=>out.includes('FB Auto Post: http://'));
  const check=openDatabase(file);
  const r=await check.first("SELECT status,error FROM replies WHERE id='r'"),t1=await check.first("SELECT status,error FROM post_targets WHERE id='t1'"),t2=await check.first("SELECT status FROM post_targets WHERE id='t2'");
  check.close();
  assert.deepEqual({...r},{status:'failed',error:'Không rõ đã gửi chưa, kiểm tra trên Facebook'});
  assert.equal(t1.status,'failed');assert.equal(t2.status,'scheduled');
  const base=`http://127.0.0.1:${port}`;
  assert.equal((await fetch(base+'/api/state')).status,200);
  assert.equal((await fetch(base+'/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signatureLine:'x'.repeat(20000)})})).status,413);
  // M2: knowledge and post routes take up to 256 KB
  const kb='## Sản phẩm\n'+'- Robot X bền đẹp, pin trâu\n'.repeat(3500);assert.ok(Buffer.byteLength(kb)>=100*1024);
  assert.equal((await fetch(base+'/api/kb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'knowledge',text:kb})})).status,200,'M2: 100 KB knowledge saves');
  assert.equal((await fetch(base+'/api/kb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'knowledge',text:'x'.repeat(300*1024)})}).catch(e=>({status:'reset:'+e.cause?.code}))).status,413);
  assert.equal((await fetch(base+'/api/uploads',{method:'POST',headers:{'Content-Type':'text/plain'},body:'hello'})).status,415);
  const big=Buffer.concat([Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),Buffer.alloc(8*1024*1024+1-8)]);
  const over=await fetch(base+'/api/uploads',{method:'POST',headers:{'Content-Type':'image/png'},body:big}).catch(e=>({status:'reset:'+e.cause?.code}));
  assert.equal(over.status,413);
  assert.equal((await fetch(base+'/api/state')).status,200,'server still up after the oversized upload');
  assert.equal((await fetch(base+'/api/files/..%2f.env')).status,404);
  assert.equal((await fetch(base+'/khong-co-file.js')).status,404,'file không có trong public/');
  child.kill('SIGTERM');assert.deepEqual(await exited,{code:0,signal:null});
});

test('khởi động: loginWindowOpen và loginRequested còn lại từ lần trước → đều false, không tự mở cửa sổ',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'fb-boot-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'fb.sqlite'),db=openDatabase(file);
  await setRuntime(db,{loginWindowOpen:true,loginRequested:true,loginState:'checkpoint'});db.close();
  const port=await freePort();
  const child=spawn(process.execPath,[entry],{cwd:root,env:{PATH:process.env.PATH,HOME:process.env.HOME,DATABASE_PATH:file,DATA_DIR:dir,HOST:'127.0.0.1',PORT:String(port),WORKERS:'off'},stdio:['ignore','pipe','pipe']});
  let out='';child.stdout.on('data',c=>{out+=c;});child.stderr.on('data',c=>{out+=c;});
  const exited=new Promise(r=>child.on('exit',(code,signal)=>r({code,signal})));
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
  await until(()=>out.includes('FB Auto Post: http://'));
  const rt=await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  assert.deepEqual([rt.runtime.loginWindowOpen,rt.runtime.loginRequested,rt.runtime.loginState],[false,false,'checkpoint']);
  child.kill('SIGTERM');assert.deepEqual(await exited,{code:0,signal:null});
});
