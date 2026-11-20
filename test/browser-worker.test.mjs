import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/db.mjs';
import {getRuntime,setRuntime} from '../server/settings.mjs';
import {browserTick} from '../server/browser-worker.mjs';
import {normalizeComment,saveComments} from '../server/comments.mjs';
import {draftTick,newState} from '../server/worker.mjs';

const MIN=60e3;
// fake deps: no browser. states = what loginState returns on each check (the last one repeats); the window closes after `closeAfter` polls.
function rig({states=['logged_in','logged_in'],closeAfter=null,launchError=null,owner='1000123'}={}){
  const r={calls:{open:0,close:0,front:0,state:0},t:Date.parse('2026-11-20T10:00:00Z'),open:false,polls:0};
  const session={ctx:{},page:{}};
  r.deps={
    pollMs:1000,maxWaitMs:10*MIN,profileDir:'/nonexistent/profile',baseUrl:'http://127.0.0.1:1',
    now:()=>new Date(r.t),
    sleep:async ms=>{r.t+=ms;r.polls++;if(closeAfter!==null&&r.polls>=closeAfter)r.open=false;},
    openSession:async()=>{r.calls.open++;if(launchError)throw launchError;if(r.open){r.calls.front++;}else r.open=true;return session;},
    sessionOpen:()=>r.open,
    closeSession:async()=>{r.calls.close++;r.open=false;},
    loginState:async()=>{const s=states[Math.min(r.calls.state++,states.length-1)];return s;},
    ownProfileId:async()=>owner,
  };
  return r;
}
const events=db=>db.all('SELECT kind,detail FROM events ORDER BY id');

test('không có cờ loginRequested → không mở Chrome', async()=>{
  const db=openDatabase(':memory:'),r=rig();
  await browserTick(db,{},r.deps);
  assert.equal(r.calls.open,0);
  db.close();
});

test('logged_in 2 lần liên tiếp → lưu ownAuthorId, loginState, loginCheckedAt; cửa sổ vẫn mở tới khi anh đóng', async()=>{
  const db=openDatabase(':memory:'),r=rig({states:['logged_in'],closeAfter:6});
  await setRuntime(db,{loginRequested:true});
  let seen=null;
  const orig=r.deps.sleep;r.deps.sleep=async ms=>{if(r.polls===3)seen=await getRuntime(db);await orig(ms);};
  await browserTick(db,{},r.deps);
  assert.equal(r.calls.open,1);assert.equal(r.calls.close,0,'không tự đóng cửa sổ khi đã đăng nhập');
  assert.deepEqual([seen.loginState,seen.ownAuthorId,seen.loginWindowOpen,seen.loginRequested],['logged_in','1000123',true,false]);
  assert.equal(seen.loginCheckedAt,'2026-11-20T10:00:01.000Z'); // second check, one poll (1 s) after the start
  const rt=await getRuntime(db);
  assert.equal(rt.loginWindowOpen,false,'anh đóng cửa sổ → loginWindowOpen=false');
  assert.equal(rt.loginState,'logged_in');
  assert.ok((await events(db)).some(e=>e.kind==='fb_login'&&JSON.parse(e.detail).state==='logged_in'));
  db.close();
});

test('logged_in một lần rồi checkpoint → không bao giờ báo đã đăng nhập', async()=>{
  const db=openDatabase(':memory:'),r=rig({states:['logged_in','checkpoint'],closeAfter:5});
  await setRuntime(db,{loginRequested:true});
  const seen=new Set();const orig=r.deps.sleep;r.deps.sleep=async ms=>{seen.add((await getRuntime(db)).loginState);await orig(ms);};
  await browserTick(db,{},r.deps);
  assert.ok(!seen.has('logged_in'));
  const rt=await getRuntime(db);
  assert.equal(rt.loginState,'checkpoint');assert.equal(rt.ownAuthorId,null);
  db.close();
});

test('checkpoint tới hết maxWaitMs → đóng cửa sổ, giữ trạng thái checkpoint, loginWindowOpen=false', async()=>{
  const db=openDatabase(':memory:'),r=rig({states:['checkpoint']});
  await setRuntime(db,{loginRequested:true});
  await browserTick(db,{},r.deps);
  assert.equal(r.calls.close,1);
  const rt=await getRuntime(db);
  assert.deepEqual([rt.loginState,rt.loginWindowOpen],['checkpoint',false]);
  assert.ok(r.t-Date.parse('2026-11-20T10:00:00Z')>=10*MIN);
  assert.equal(rt.loginCheckedAt,new Date(r.t).toISOString());
  db.close();
});

test('logged_out tới hết maxWaitMs → đóng cửa sổ, trạng thái logged_out', async()=>{
  const db=openDatabase(':memory:'),r=rig({states:['logged_out']});
  await setRuntime(db,{loginRequested:true});
  await browserTick(db,{},r.deps);
  assert.equal(r.calls.close,1);assert.equal((await getRuntime(db)).loginState,'logged_out');
  db.close();
});

test('bấm lại lúc cửa sổ đang mở → dùng lại phiên (đưa lên trước), không mở Chrome thứ hai, cờ được xoá', async()=>{
  const db=openDatabase(':memory:'),r=rig({states:['logged_out'],closeAfter:4});
  await setRuntime(db,{loginRequested:true});
  const orig=r.deps.sleep;r.deps.sleep=async ms=>{if(r.polls===1)await setRuntime(db,{loginRequested:true});await orig(ms);};
  await browserTick(db,{},r.deps);
  assert.equal(r.calls.front,1,'đưa cửa sổ cũ lên trước');
  assert.equal((await getRuntime(db)).loginRequested,false);
  // the first tick launched once; the second openSession call found the session open (real openSession returns the same one)
  db.close();
});

test('lỗi khoá profile → loginState=error + thông báo khoá, fb_error, tick sau không làm gì', async()=>{
  const db=openDatabase(':memory:'),r=rig({launchError:new Error('ProcessSingleton: the profile is already in use')});
  await setRuntime(db,{loginRequested:true});
  await browserTick(db,{},r.deps);
  const rt=await getRuntime(db);
  assert.deepEqual([rt.loginState,rt.loginError,rt.loginWindowOpen,rt.loginRequested],['error','Profile Chrome của tool đang bị chương trình khác dùng. Đóng cửa sổ đó rồi bấm lại.',false,false]);
  assert.ok((await events(db)).some(e=>e.kind==='fb_error'));
  await browserTick(db,{},r.deps);
  assert.equal(r.calls.open,1,'không thử lại');
  db.close();
});

test('lỗi mở Chrome khác → «Không mở được Chrome: …»', async()=>{
  const db=openDatabase(':memory:'),r=rig({launchError:new Error('Executable doesn\'t exist')});
  await setRuntime(db,{loginRequested:true});
  await browserTick(db,{},r.deps);
  const rt=await getRuntime(db);
  assert.equal(rt.loginState,'error');assert.equal(rt.loginError,"Không mở được Chrome: Executable doesn't exist");
  db.close();
});

test('anh tự đóng cửa sổ → loginWindowOpen=false', async()=>{
  const db=openDatabase(':memory:'),r=rig({states:['logged_out'],closeAfter:2});
  await setRuntime(db,{loginRequested:true});
  await browserTick(db,{},r.deps);
  assert.equal((await getRuntime(db)).loginWindowOpen,false);assert.equal(r.calls.close,0);
  db.close();
});

test('tiêu chí 3: ownAuthorId do job lưu → comment cùng id người viết là is_own=1, draftTick không gọi Claude', async()=>{
  const db=openDatabase(':memory:'),r=rig({states:['logged_in'],closeAfter:4,owner:'900000000002'});
  await setRuntime(db,{loginRequested:true});
  await browserTick(db,{},r.deps);
  await db.run("INSERT INTO posts(id,text,created_at) VALUES('p','x','2026-11-20T00:00:00Z')");
  await db.run("INSERT INTO fb_groups(id,url,added_at) VALUES('g','https://fb.com/g','2026-11-20T00:00:00Z')");
  await db.run("INSERT INTO post_targets(id,post_id,group_id,scheduled_at,status) VALUES('t1','p','g','2026-11-20T00:00:00Z','published')");
  const fx=JSON.parse(readFileSync(new URL('./fixtures/sc-comments.json',import.meta.url),'utf8'));
  const raw=fx.comments.map(c=>({...c,author:{...c.author,id:'900000000002'}})).slice(0,1);
  await saveComments(db,'t1',raw.map(c=>normalizeComment(c)));
  const row=await db.first('SELECT is_own FROM comments');
  assert.equal(row.is_own,1);
  let called=0;
  await draftTick(db,{},{makeRunner:()=>async()=>{called++;return {text:'{}',costUsd:null};},now:()=>new Date()},newState());
  assert.equal(called,0);
  db.close();
});

test('một lần unknown không làm mất trạng thái đã đăng nhập; checkpoint thật thì thay', async()=>{
  const db=openDatabase(':memory:'),r=rig({states:['logged_in','logged_in','unknown','logged_in','checkpoint'],closeAfter:8});
  await setRuntime(db,{loginRequested:true});
  const seen=[];const orig=r.deps.sleep;r.deps.sleep=async ms=>{seen.push((await getRuntime(db)).loginState);await orig(ms);};
  await browserTick(db,{},r.deps);
  assert.deepEqual(seen.slice(1,4),['logged_in','logged_in','logged_in']);
  assert.equal((await getRuntime(db)).loginState,'checkpoint');
  db.close();
});

test('anh đóng cửa sổ ngay trong lúc kiểm → kết quả unknown không được ghi', async()=>{
  const db=openDatabase(':memory:'),r=rig();
  await setRuntime(db,{loginRequested:true});
  r.deps.loginState=async()=>{r.open=false;return 'unknown';};
  await browserTick(db,{},r.deps);
  const rt=await getRuntime(db);
  assert.equal(rt.loginState,'unknown');assert.equal(rt.loginCheckedAt,null);assert.equal(rt.loginWindowOpen,false);
  assert.ok(!(await events(db)).some(e=>e.kind==='fb_login'));
  db.close();
});

test('lỗi trong vòng kiểm → loginState=error, fb_error, loginWindowOpen=false', async()=>{
  const db=openDatabase(':memory:'),r=rig({states:['logged_in']});
  await setRuntime(db,{loginRequested:true});
  r.deps.ownProfileId=async()=>{throw new Error('Context closed\nCall log:\n  - lots of detail');};
  await browserTick(db,{},r.deps);
  const rt=await getRuntime(db);
  assert.deepEqual([rt.loginState,rt.loginError,rt.loginWindowOpen],['error','Không mở được Chrome: Context closed',false]);
  const ev=(await events(db)).find(e=>e.kind==='fb_error');
  assert.match(JSON.parse(ev.detail).message,/Call log/,'sự kiện giữ nguyên văn');
  db.close();
});

test('lỗi khi mở: loginError chỉ lấy dòng đầu, fb_error giữ đủ', async()=>{
  const db=openDatabase(':memory:'),r=rig({launchError:new Error('boom\nCall log:\n  - x')});
  await setRuntime(db,{loginRequested:true});
  await browserTick(db,{},r.deps);
  assert.equal((await getRuntime(db)).loginError,'Không mở được Chrome: boom');
  assert.match(JSON.parse((await events(db)).find(e=>e.kind==='fb_error').detail).message,/Call log/);
  db.close();
});

test('bấm lại sau một lỗi → loginState về unknown ngay khi bắt đầu', async()=>{
  const db=openDatabase(':memory:'),r=rig({states:['logged_out'],closeAfter:1});
  await setRuntime(db,{loginRequested:true,loginState:'error',loginError:'cũ'});
  let during=null;const open=r.deps.openSession;r.deps.openSession=async o=>{during=await getRuntime(db);return open(o);};
  await browserTick(db,{},r.deps);
  assert.deepEqual([during.loginState,during.loginError],['unknown',null]);
  db.close();
});

test('hết giờ mà trạng thái cuối là unknown → ghi logged_out', async()=>{
  const db=openDatabase(':memory:'),r=rig({states:['unknown']});
  await setRuntime(db,{loginRequested:true});
  await browserTick(db,{},r.deps);
  assert.equal(r.calls.close,1);assert.equal((await getRuntime(db)).loginState,'logged_out');
  db.close();
});
