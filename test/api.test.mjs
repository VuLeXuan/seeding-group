import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../server/db.mjs';
import {handleApi} from '../server/api.mjs';
import {scrapeTick,draftTick,newState} from '../server/worker.mjs';
import {getRuntime,setRuntime,saveConfig} from '../server/settings.mjs';

const NOW=new Date('2026-11-18T12:00:00Z');
const iso=ms=>new Date(ms).toISOString();
const J=o=>JSON.stringify({reply:'Dạ shop cảm ơn ạ',category:'other',grounded:false,quotes:[],...o});
const runner=texts=>{const calls=[];return {calls,makeRunner:()=>async input=>{calls.push(input);return {text:Array.isArray(texts)?texts.shift():texts,costUsd:null};}};};
async function setup(t){
  const db=openDatabase(':memory:'),dir=mkdtempSync(join(tmpdir(),'fb-api-'));
  t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  const env={DB:db,DATA_DIR:dir},fresh=iso(NOW-3600e3),r=runner(J());
  const deps={makeRunner:r.makeRunner,now:()=>NOW};
  const call=async(method,path,body,headers={})=>{
    const raw=body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body);
    const res=await handleApi(new Request('http://x'+path,{method,headers:{...(Buffer.isBuffer(body)?{}:{'Content-Type':'application/json'}),...headers},body:raw}),env,deps);
    const ct=res.headers.get('content-type')||'';return {status:res.status,body:ct.includes('json')?await res.json():null,res};
  };
  await db.run("INSERT INTO fb_groups(id,url,name,allow_selling,enabled,added_at) VALUES('g1','https://www.facebook.com/groups/1/','Nhóm 1',1,1,?),('g2','https://www.facebook.com/groups/2/','Nhóm 2',0,1,?),('g3','https://www.facebook.com/groups/3/','Nhóm 3',1,0,?)",[fresh,fresh,fresh]);
  await db.run("INSERT INTO posts(id,text,images,created_at) VALUES('p1',?,'[]',?)",['B'.repeat(300),fresh]);
  await db.run("INSERT INTO post_targets(id,post_id,group_id,scheduled_at,status,permalink,posted_at,next_poll_at) VALUES('t1','p1','g1',?,'published','https://www.facebook.com/groups/1/posts/9/?foo=1',?,?)",[fresh,fresh,fresh]);
  const c=(id,fb,parent,own=0)=>db.run('INSERT INTO comments(id,target_id,fb_comment_id,parent_fb_id,author_id,author_name,text,created_at,fetched_at,is_own) VALUES(?,?,?,?,?,?,?,?,?,?)',[id,'t1',fb,parent,'u'+id,'An','Giá sao shop?',fresh,fresh,own]);
  await c('c1','f1',null);await c('c2','f2','f1');
  return {db,env,dir,call,r,deps,fresh};
}
const reply=(db,id,comment,status='waiting')=>db.run("INSERT INTO replies(id,comment_id,draft,category,quotes,status,created_at) VALUES(?,?,'Nháp','other','[]',?,?)",[id,comment,status,iso(NOW)]);
const PNG=Buffer.concat([Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),Buffer.alloc(20)]);

test('POST /api/posts từ chối nhóm chưa bật "cho đăng bán" hoặc đang tắt',async t=>{
  const {call}=await setup(t);
  for(const g of ['g2','g3','nope']){const r=await call('POST','/api/posts',{text:'x',images:[],groupIds:['g1',g]});assert.equal(r.status,400);assert.equal(r.body.error.code,'GROUP_NOT_ALLOWED');}
});
test('POST /api/posts từ chối 11 ảnh, chữ rỗng, ảnh chưa tải lên',async t=>{
  const {call}=await setup(t);
  const eleven=Array.from({length:11},(_,i)=>`a${i}.png`);
  assert.equal((await call('POST','/api/posts',{text:'x',images:eleven,groupIds:['g1']})).status,400);
  assert.equal((await call('POST','/api/posts',{text:'  ',images:[],groupIds:['g1']})).status,400);
  assert.equal((await call('POST','/api/posts',{text:'x',images:['chua.png'],groupIds:['g1']})).body.error.code,'INVALID_IMAGE');
});
test('POST /api/posts tạo bài và target; lịch quá khứ = đăng ngay, lịch tương lai giữ nguyên',async t=>{
  const {call,db,dir}=await setup(t);
  mkdirSync(join(dir,'uploads'));writeFileSync(join(dir,'uploads','a.png'),PNG);
  const past=await call('POST','/api/posts',{text:' Bán robot ',images:['a.png'],groupIds:['g1'],scheduledAt:'2020-01-01T00:00:00Z'});
  assert.equal(past.status,201);
  const future=await call('POST','/api/posts',{text:'Sau',images:[],groupIds:['g1'],scheduledAt:'2026-11-19T00:00:00Z'});
  const rows=await db.all("SELECT t.scheduled_at,t.status,p.text,p.images FROM post_targets t JOIN posts p ON p.id=t.post_id WHERE t.id<>'t1' ORDER BY p.created_at,p.text");
  const byText=Object.fromEntries(rows.map(r=>[r.text,r]));
  assert.equal(byText['Bán robot'].scheduled_at,NOW.toISOString());assert.equal(byText['Bán robot'].status,'scheduled');assert.equal(byText['Bán robot'].images,'["a.png"]');
  assert.equal(byText['Sau'].scheduled_at,'2026-11-19T00:00:00.000Z');assert.ok(future.body.id);
});
test('POST /api/replies/:id/send → approved, mode manual, final_text = text sửa',async t=>{
  const {call,db}=await setup(t);await reply(db,'r1','c1');
  const r=await call('POST','/api/replies/r1/send',{text:'  Sửa lại ạ '});
  assert.equal(r.status,200);const row=await db.first('SELECT * FROM replies WHERE id=?',['r1']);
  assert.deepEqual([row.status,row.mode,row.final_text,row.error],['approved','manual','Sửa lại ạ',null]);
  await db.run("UPDATE replies SET status='failed',error='x' WHERE id='r1'");
  await call('POST','/api/replies/r1/send',{});
  const again=await db.first('SELECT * FROM replies WHERE id=?',['r1']);assert.deepEqual([again.status,again.final_text,again.error],['approved','Nháp',null]);
});
test('send/skip/redraft bị khoá khi sending hoặc sent; text rỗng bị từ chối',async t=>{
  const {call,db}=await setup(t);await reply(db,'r1','c1','sending');await reply(db,'r2','c2');
  for(const a of ['send','skip','redraft'])assert.equal((await call('POST',`/api/replies/r1/${a}`,{})).body.error.code,'REPLY_LOCKED');
  assert.equal((await call('POST','/api/replies/r1/send',{})).status,409);
  assert.equal((await call('POST','/api/replies/r2/send',{text:'  '})).status,400);
  assert.equal((await call('POST','/api/replies/r2/send',{text:'x'.repeat(2001)})).status,400);
});
test('skip → skipped/manual; redraft soạn lại bằng runner giả',async t=>{
  const {call,db,r}=await setup(t);await reply(db,'r1','c1');await reply(db,'r2','c2');
  await call('POST','/api/replies/r1/skip');
  const s=await db.first("SELECT status,mode FROM replies WHERE id='r1'");assert.deepEqual([s.status,s.mode],['skipped','manual']);
  const d=await call('POST','/api/replies/r2/redraft');
  assert.equal(d.status,200);assert.equal(d.body.draft,'Dạ shop cảm ơn ạ');assert.equal(r.calls.length,1);
});
test('GET /api/queue: commentUrl cho comment gốc và trả lời, nhóm, bài cắt 200 ký tự',async t=>{
  const {call,db}=await setup(t);await reply(db,'r1','c1');await reply(db,'r2','c2');await reply(db,'r3','c1','sent').catch(()=>{});
  const q=(await call('GET','/api/queue?status=waiting')).body,by=Object.fromEntries(q.map(r=>[r.id,r]));
  assert.equal(q.length,2);
  assert.equal(by.r1.commentUrl,'https://www.facebook.com/groups/1/posts/9/?foo=1&comment_id=f1');
  assert.equal(by.r2.commentUrl,'https://www.facebook.com/groups/1/posts/9/?foo=1&comment_id=f1&reply_comment_id=f2');
  assert.equal(by.r1.group_name,'Nhóm 1');assert.equal(by.r1.post_text.length,200);
  assert.equal((await call('GET','/api/queue?status=sent')).status,400);
});
test('POST /api/pause true rồi false xoá lý do; /api/state đếm hàng chờ',async t=>{
  const {call,db}=await setup(t);await reply(db,'r1','c1');
  await setRuntime(db,{pauseReason:'Checkpoint',pauseScreenshot:'s.png'});
  await call('POST','/api/pause',{paused:true});assert.equal((await getRuntime(db)).paused,true);
  assert.equal((await call('GET','/api/state')).body.runtime.paused,true);
  await call('POST','/api/pause',{paused:false});
  const rt=await getRuntime(db);assert.deepEqual([rt.paused,rt.pauseReason,rt.pauseScreenshot],[false,null,null]);
  assert.equal((await call('POST','/api/pause',{paused:'x'})).status,400);
  const s=(await call('GET','/api/state')).body;assert.deepEqual(s.counts,{waiting:1,failed:0,pendingApproval:0});assert.equal(s.creditsToday,0);assert.ok(s.config.maxImages);
  await call('POST','/api/browser/login');assert.equal((await getRuntime(db)).loginRequested,true);
});
test('GET /api/files: chặn ..  và tên lạ, phục vụ file trong uploads và screenshots',async t=>{
  const {call,dir}=await setup(t);
  writeFileSync(join(dir,'.env'),'SECRET');mkdirSync(join(dir,'uploads'));mkdirSync(join(dir,'screenshots'));
  writeFileSync(join(dir,'uploads','a.png'),PNG);writeFileSync(join(dir,'screenshots','s.png'),PNG);
  for(const p of ['/api/files/../.env','/api/files/..%2F.env','/api/files/%2e%2e%2f.env','/api/files/a..png','/api/files/nope.png','/api/files/.env'])assert.equal((await call('GET',p)).status,404,p);
  const ok=await call('GET','/api/files/a.png');assert.equal(ok.status,200);assert.equal(ok.res.headers.get('content-type'),'image/png');
  assert.equal((await call('GET','/api/files/s.png')).status,200);
});
test('POST /api/uploads: nhận png thật, từ chối text/plain, magic sai, file > 8 MB',async t=>{
  const {call,dir}=await setup(t);
  const ok=await call('POST','/api/uploads',PNG,{'Content-Type':'image/png'});
  assert.equal(ok.status,201);assert.match(ok.body.name,/^[0-9a-f-]+\.png$/);
  assert.equal((await call('GET','/api/files/'+ok.body.name)).status,200);
  assert.equal((await call('POST','/api/uploads',Buffer.from('hello'),{'Content-Type':'text/plain'})).status,415);
  assert.equal((await call('POST','/api/uploads',Buffer.from('hello world!'),{'Content-Type':'image/png'})).status,415);
  assert.equal((await call('POST','/api/uploads',Buffer.concat([Buffer.from([0xFF,0xD8,0xFF]),Buffer.alloc(8*1024*1024)]),{'Content-Type':'image/jpeg'})).status,413);
  const webp=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WEBP'),Buffer.alloc(8)]);
  assert.equal((await call('POST','/api/uploads',webp,{'Content-Type':'image/webp'})).status,201);
});
test('groups: chuẩn hoá URL, trùng 409, link không phải nhóm 400, PATCH chỉ 3 trường',async t=>{
  const {call}=await setup(t);
  const a=await call('POST','/api/groups',{url:'https://facebook.com/groups/77/?ref=x'});
  assert.equal(a.status,201);assert.equal(a.body.url,'https://www.facebook.com/groups/77/');assert.deepEqual([a.body.name,a.body.visibility,a.body.allow_selling,a.body.enabled],[null,'unknown',0,1]);
  assert.equal((await call('POST','/api/groups',{url:'https://www.facebook.com/groups/77/about'})).body.error.code,'GROUP_EXISTS');
  assert.equal((await call('POST','/api/groups',{url:'https://www.facebook.com/groups/77/posts/5'})).body.error.code,'INVALID_GROUP_URL');
  assert.equal((await call('POST','/api/groups',{url:'nope'})).body.error.code,'INVALID_GROUP_URL');
  const p=await call('PATCH','/api/groups/'+a.body.id,{rules_note:'Cấm link',allow_selling:true,enabled:false});
  assert.deepEqual([p.body.rules_note,p.body.allow_selling,p.body.enabled],['Cấm link',1,0]);
  assert.equal((await call('PATCH','/api/groups/'+a.body.id,{url:'x'})).status,400);
  assert.equal((await call('PATCH','/api/groups/'+a.body.id,{allow_selling:1})).status,400);
  assert.equal((await call('PATCH','/api/groups/zzz',{enabled:true})).status,404);
});
test('lỗi lạ → 500 INTERNAL không lộ nội dung; không có đường → 404',async t=>{
  const {call,env}=await setup(t);
  assert.equal((await call('GET','/api/nope')).body.error.code,'NOT_FOUND');
  const log=console.error;console.error=()=>{};t.after(()=>{console.error=log;});
  const bad=await handleApi(new Request('http://x/api/state'),{DB:{first(){throw new Error('SECRET path');},setting(){throw new Error('SECRET path');}}},{now:()=>NOW});
  assert.equal(bad.status,500);assert.deepEqual(await bad.json(),{error:{code:'INTERNAL',message:'Lỗi máy chủ.'}});
});
test('poll-now đặt next_poll_at = bây giờ; kb, config, events chạy',async t=>{
  const {call,db}=await setup(t);
  await db.run("UPDATE post_targets SET next_poll_at='2030-01-01T00:00:00.000Z' WHERE id='t1'");
  await call('POST','/api/targets/t1/poll-now');assert.equal((await db.first("SELECT next_poll_at AS n FROM post_targets WHERE id='t1'")).n,NOW.toISOString());
  assert.equal((await call('POST','/api/targets/zz/poll-now')).status,404);
  const k=await call('POST','/api/kb',{kind:'persona',text:'## Xưng hô\n- shop'});assert.ok(k.body.versionId);
  assert.equal((await call('GET','/api/kb/versions?kind=persona')).body.length,1);
  assert.equal((await call('POST','/api/config',{maxImages:3})).body.maxImages,3);
  assert.equal((await call('POST','/api/config',{maxImages:-1})).body.error.code,'INVALID_SETTING');
  assert.ok(Array.isArray((await call('GET','/api/events?limit=5')).body));
});
test('/api/posts/draft và /api/kb/try dùng runner giả',async t=>{
  const {call,r}=await setup(t);
  r.calls.length=0;
  const d=await call('POST','/api/posts/draft',{brief:'Bán robot'});assert.equal(d.status,200);assert.equal(d.body.text,J());
  const k=await call('POST','/api/kb/try',{commentText:'Giá?',postText:'Bài'});assert.equal(k.body.reply,'Dạ shop cảm ơn ạ');
});

// worker ticks, fake client and runner only
test('draftTick: soạn từng comment không phải của mình; lỗi thì nghỉ 10 phút riêng comment đó',async t=>{
  const {db,env,deps}=await setup(t);
  await db.run("INSERT INTO comments(id,target_id,fb_comment_id,author_id,text,fetched_at,is_own) VALUES('c3','t1','f3','me','của tool',?,1)",[iso(NOW)]);
  const state=newState();let n=0;
  const d={now:deps.now,makeRunner:()=>async()=>{n++;if(n===1)throw Object.assign(new Error('boom'),{code:'CLAUDE_FAIL'});return {text:J(),costUsd:null};}};
  const first=await draftTick(db,env,d,state);assert.equal(first,'c1');
  assert.equal(await draftTick(db,env,d,state),'c2','c1 đang nghỉ nên làm c2');
  assert.equal(await draftTick(db,env,d,state),null,'c1 còn nghỉ, c3 là của mình');
  assert.equal((await db.all('SELECT * FROM events WHERE kind=?',['draft_error'])).length,1);
  assert.equal(await draftTick(db,env,{...d,now:()=>new Date(NOW.getTime()+11*60e3)},state),'c1');
  assert.equal((await db.all('SELECT comment_id FROM replies ORDER BY comment_id')).map(r=>r.comment_id).join(),'c1,c2');
});
test('draftTick: CLAUDE_AUTH nghỉ chung 10 phút; CLAUDE_HOURLY_LIMIT nghỉ chung 5 phút; paused không chặn',async t=>{
  const {db,env,deps}=await setup(t);
  await setRuntime(db,{paused:true});
  const state=newState(),fail=code=>({now:deps.now,makeRunner:()=>async()=>{throw Object.assign(new Error('x'),{code});}});
  await draftTick(db,env,fail('CLAUDE_HOURLY_LIMIT'),state);
  assert.equal(await draftTick(db,env,deps,state),null);
  assert.equal(await draftTick(db,env,{...deps,now:()=>new Date(NOW.getTime()+6*60e3)},state),'c1','hết 5 phút, paused vẫn soạn');
  const s2=newState();await draftTick(db,env,fail('CLAUDE_AUTH'),s2);
  assert.equal(await draftTick(db,env,{...deps,now:()=>new Date(NOW.getTime()+6*60e3)},s2),null);
  assert.equal(await draftTick(db,env,{...deps,now:()=>new Date(NOW.getTime()+11*60e3)},s2),'c2');
});
test('scrapeTick: chỉ target published/scrape đến hạn; lỗi thì nghỉ 10 phút',async t=>{
  const {db,env,deps}=await setup(t);
  const client={calls:0,async get(){this.calls++;return {data:{comments:[],cursor:null},charge:1};}};
  assert.equal(await scrapeTick(db,env,{...deps,scrapeClient:client}),'t1');assert.equal(client.calls,2,'/post rồi 1 trang comment');
  assert.equal(await scrapeTick(db,env,{...deps,scrapeClient:client}),null,'next_poll_at đã dời ra sau');
  await db.run("UPDATE post_targets SET next_poll_at=? WHERE id='t1'",[iso(NOW-1000)]);
  const boom={async get(){throw new Error('mạng');}};
  assert.equal(await scrapeTick(db,env,{...deps,scrapeClient:boom}),'t1');
  assert.equal((await db.first("SELECT next_poll_at AS n FROM post_targets WHERE id='t1'")).n,iso(NOW.getTime()+10*60e3));
  assert.equal((await db.all("SELECT * FROM events WHERE kind='scrape_error'")).length,1);
  await db.run("UPDATE post_targets SET reader='browser',next_poll_at=? WHERE id='t1'",[iso(NOW-1000)]);
  assert.equal(await scrapeTick(db,env,{...deps,scrapeClient:client}),null);
});

test('CSRF: JSON bắt buộc (415), Origin lạ bị chặn (403), Origin trùng Host được qua, body không phải object → 400',async t=>{
  const {call,db,env,deps}=await setup(t);
  const raw=(path,body,headers)=>handleApi(new Request('http://x'+path,{method:'POST',headers,body}),env,deps);
  const r=await raw('/api/pause','{"paused":true}',{'Content-Type':'text/plain'});
  assert.equal(r.status,415);assert.equal((await r.json()).error.code,'UNSUPPORTED_MEDIA_TYPE');assert.equal((await getRuntime(db)).paused,false);
  assert.equal((await raw('/api/pause','{"paused":true}',{})).status,415);
  assert.equal((await raw('/api/pause','{"paused":true}',{'Content-Type':'application/json; charset=utf-8'})).status,200);
  const evil=await raw('/api/pause','{"paused":false}',{'Content-Type':'application/json',Origin:'http://evil.example'});
  assert.equal(evil.status,403);assert.equal((await evil.json()).error.code,'BAD_ORIGIN');assert.equal((await getRuntime(db)).paused,true);
  assert.equal((await handleApi(new Request('http://x/api/state',{headers:{Origin:'http://evil.example'}}),env,deps)).status,403);
  assert.equal((await raw('/api/pause','{"paused":false}',{'Content-Type':'application/json',Origin:'http://x',Host:'x'})).status,200);
  assert.equal((await handleApi(new Request('http://192.168.1.5:4180/api/state',{headers:{Origin:'http://192.168.1.5:4180'}}),env,deps)).status,200);
  for(const b of ['null','5','"x"','[]']){const x=await raw('/api/posts',b,{'Content-Type':'application/json'});assert.equal(x.status,400,b);assert.equal((await x.json()).error.code,'INVALID_JSON');}
});
test('draftTick: CLAUDE_LIMIT nghỉ chung tới resetAt, không có thì 30 phút',async t=>{
  const {db,env,deps}=await setup(t);
  const at=min=>({now:()=>new Date(NOW.getTime()+min*60e3)}),fail=resetAt=>({...deps,makeRunner:()=>async()=>{throw Object.assign(new Error('limit'),{code:'CLAUDE_LIMIT',resetAt});}});
  const s1=newState();await draftTick(db,env,fail(new Date(NOW.getTime()+90*60e3).toISOString()),s1);
  assert.equal(await draftTick(db,env,{...deps,...at(89)},s1),null);
  assert.notEqual(await draftTick(db,env,{...deps,...at(91)},s1),null);
  const s2=newState();await draftTick(db,env,fail(null),s2);
  assert.equal(await draftTick(db,env,{...deps,...at(29)},s2),null);
  assert.notEqual(await draftTick(db,env,{...deps,...at(31)},s2),null);
});

// final fix wave
const tick=()=>new Promise(r=>setImmediate(r));
const at=min=>new Date(NOW.getTime()+min*60e3);
test('C1: Soạn lại đang chạy, chủ shop bấm Gửi rồi câu được gửi → bản soạn lại không ghi đè, 409 REPLY_CHANGED',async t=>{
  const {db,env}=await setup(t);await reply(db,'r1','c1');
  let release;const gate=new Promise(r=>{release=r;});
  const slow={makeRunner:()=>async()=>{await gate;return {text:J({reply:'Bản soạn lại'}),costUsd:null};},now:()=>NOW};
  const post=(path,body)=>handleApi(new Request('http://x/api'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env,slow);
  const redraft=post('/replies/r1/redraft',{});
  await tick();
  assert.equal((await post('/replies/r1/send',{text:'Câu chủ shop sửa'})).status,200);
  await db.run("UPDATE replies SET status='sent',sent_at=? WHERE id='r1'",[iso(NOW)]);
  release();const res=await redraft;
  assert.equal(res.status,409);assert.equal((await res.json()).error.code,'REPLY_CHANGED');
  assert.deepEqual({...await db.first("SELECT status,final_text,draft,mode,sent_at FROM replies WHERE id='r1'")},{status:'sent',final_text:'Câu chủ shop sửa',draft:'Nháp',mode:'manual',sent_at:iso(NOW)});
});
test('I1: target thiếu link hoặc giờ đăng không chặn target khác: target tốt được đọc ngay lượt đầu',async t=>{
  const {db,env,deps,fresh}=await setup(t),old=iso(NOW-7200e3);
  await db.run("INSERT INTO post_targets(id,post_id,group_id,scheduled_at,status,permalink,posted_at,next_poll_at) VALUES('bad1','p1','g1',?,'published',NULL,?,?),('bad2','p1','g1',?,'published','https://www.facebook.com/groups/1/posts/8/',NULL,?)",[fresh,fresh,old,fresh,old]);
  const client={calls:0,async get(route){this.calls++;return {data:route.endsWith('/post')?{comment_count:0}:{comments:[],cursor:null},charge:1};}};
  assert.equal(await scrapeTick(db,env,{...deps,scrapeClient:client}),'t1');
  assert.ok((await db.first("SELECT last_polled_at FROM post_targets WHERE id='t1'")).last_polled_at);
});
test('I5: Soạn lại câu failed «không rõ đã gửi» ở giai đoạn 2 → waiting/manual, không tự gửi',async t=>{
  const {db,env}=await setup(t);await saveConfig(db,{phase:2,autoSend:{spec:true}});
  await db.run("INSERT INTO replies(id,comment_id,draft,final_text,category,grounded,status,mode,created_at,error) VALUES('r','c1','Dạ có ạ','Dạ có ạ','spec',1,'failed','auto',?,'Không rõ đã gửi chưa, kiểm tra trên Facebook')",[iso(NOW)]);
  const res=await handleApi(new Request('http://x/api/replies/r/redraft',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),env,{makeRunner:()=>async()=>({text:J({reply:'Dạ có ạ',category:'spec',grounded:true}),costUsd:null}),now:()=>NOW});
  assert.equal(res.status,200);
  assert.deepEqual({...await db.first("SELECT status,mode,reason,final_text,error FROM replies WHERE id='r'")},{status:'waiting',mode:'manual',reason:'Soạn lại theo yêu cầu',final_text:null,error:null});
});
test('I6: Claude hỏng 3 lần với một comment (kể cả qua khởi động lại) → hiện cho chủ shop với nháp rỗng, lần 4 không gọi Claude',async t=>{
  const {db,env,call}=await setup(t);await db.run("UPDATE comments SET is_own=1 WHERE id='c2'");
  let calls=0;const bad={makeRunner:()=>async()=>{calls++;return {text:'không phải JSON',costUsd:null};}};
  for(const min of [0,11,22])assert.equal(await draftTick(db,env,{...bad,now:()=>at(min)},newState()),'c1');
  assert.equal(calls,3);
  const r=await db.first("SELECT * FROM replies WHERE comment_id='c1'");
  assert.deepEqual([r.status,r.draft,r.mode,r.reason],['waiting','',null,'Claude không soạn được (DRAFT_SCHEMA), anh tự viết']);
  assert.equal(await draftTick(db,env,{...bad,now:()=>at(40)},newState()),null);assert.equal(calls,3);
  assert.equal((await call('GET','/api/queue')).body[0].draft,'');
  assert.equal((await call('POST',`/api/replies/${r.id}/send`,{text:'Dạ anh tự viết ạ'})).body.status,'approved');
});
test('I6: hai lần hỏng thì vẫn thử lại, chưa hiện',async t=>{
  const {db,env}=await setup(t);await db.run("UPDATE comments SET is_own=1 WHERE id='c2'");
  const bad={makeRunner:()=>async()=>({text:'x',costUsd:null})};
  for(const min of [0,11])await draftTick(db,env,{...bad,now:()=>at(min)},newState());
  assert.equal(await db.first("SELECT 1 AS x FROM replies WHERE comment_id='c1'"),null);
});
test('I7: /api/state báo hết credit và Claude tạm ngừng (không dừng tool); hết hạn thì tắt',async t=>{
  const {db,env,deps,call}=await setup(t);
  assert.deepEqual((await call('GET','/api/state')).body.alerts,{creditCap:false,drafting:null});
  await db.run("INSERT INTO api_calls(id,day,route,cost,created_at) VALUES('a','2026-11-18','/x',500,?)",[iso(NOW)]);
  assert.equal((await call('GET','/api/state')).body.alerts.creditCap,true);
  const state=newState();
  await draftTick(db,env,{now:deps.now,makeRunner:()=>async()=>{throw Object.assign(new Error('x'),{code:'CLAUDE_AUTH'});}},state);
  const s=(await call('GET','/api/state')).body;
  assert.deepEqual(s.alerts.drafting,{until:iso(NOW.getTime()+10*60e3),code:'CLAUDE_AUTH'});assert.equal(s.runtime.paused,false);
  await draftTick(db,env,{...deps,now:()=>at(11)},state);
  assert.equal((await getRuntime(db)).draftBlockedUntil??null,null);
  assert.equal((await (await handleApi(new Request('http://x/api/state'),env,{...deps,now:()=>at(11)})).json()).alerts.drafting,null);
});
test('I8: huỷ bài đã hẹn giờ → failed «Đã huỷ»; trạng thái khác → 409 TARGET_NOT_SCHEDULED',async t=>{
  const {call,db,fresh}=await setup(t);
  await db.run("INSERT INTO post_targets(id,post_id,group_id,scheduled_at,status) VALUES('s1','p1','g1',?,'scheduled')",[fresh]);
  const ok=await call('POST','/api/targets/s1/cancel',{});assert.equal(ok.status,200);
  assert.deepEqual({...await db.first("SELECT status,error FROM post_targets WHERE id='s1'")},{status:'failed',error:'Đã huỷ'});
  for(const id of ['s1','t1']){const r=await call('POST',`/api/targets/${id}/cancel`,{});assert.equal(r.status,409,id);assert.equal(r.body.error.code,'TARGET_NOT_SCHEDULED');}
  assert.equal((await call('POST','/api/targets/zz/cancel',{})).status,404);
});
test('I9: permalink hỏng → /api/queue vẫn 200, commentUrl null',async t=>{
  const {call,db}=await setup(t);await reply(db,'r1','c1');
  await db.run("UPDATE post_targets SET permalink='abc' WHERE id='t1'");
  const q=await call('GET','/api/queue?status=waiting');assert.equal(q.status,200);assert.equal(q.body[0].commentUrl,null);
});
test('I9: links.mjs commentUrl dùng chung',async()=>{
  const {commentUrl}=await import('../server/links.mjs');
  assert.equal(commentUrl('https://www.facebook.com/groups/1/posts/9/','f1',null),'https://www.facebook.com/groups/1/posts/9/?comment_id=f1');
  assert.equal(commentUrl('https://www.facebook.com/groups/1/posts/9/','f2','f1'),'https://www.facebook.com/groups/1/posts/9/?comment_id=f1&reply_comment_id=f2');
  for(const p of ['abc','',null,undefined])assert.equal(commentUrl(p,'f1',null),null,String(p));
});
test('M2: kiến thức 100 KB lưu được; /api/config vẫn 16 KB; quá 256 KB thì 413',async t=>{
  const {call,db}=await setup(t);
  const text='## Sản phẩm\n'+'- Robot X bền đẹp, pin trâu\n'.repeat(3500);
  assert.ok(Buffer.byteLength(text)>=100*1024);
  const r=await call('POST','/api/kb',{kind:'knowledge',text});assert.equal(r.status,200);
  assert.equal((await db.first("SELECT text FROM kb_versions WHERE kind='knowledge' ORDER BY id DESC")).text,text);
  assert.equal((await call('POST','/api/posts/draft',{brief:'x'.repeat(5000)})).body.error.code,'INVALID_INPUT','vượt 16 KB thì giờ chỉ còn kiểm độ dài');
  assert.equal((await call('POST','/api/config',{signatureLine:'x'.repeat(20000)})).status,413);
  assert.equal((await call('POST','/api/kb',{kind:'knowledge',text:'x'.repeat(300*1024)})).status,413);
});
