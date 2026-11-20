import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/db.mjs';
import {DEFAULTS} from '../server/settings.mjs';
import {nextPollAt,canPost,canReply,creditsToday,canSpendCredit,browserReadsLastHour} from '../server/limits.mjs';

const t0=Date.parse('2026-11-18T10:00:00+07:00');
const iso=ms=>new Date(ms).toISOString();
const MIN=60e3;

test('bài 0 phút, lịch scrape → +5 phút',()=>assert.equal(nextPollAt(t0,t0,DEFAULTS.scrapeCadence),iso(t0+5*MIN)));
test('bài 70 phút → +15 phút',()=>assert.equal(nextPollAt(iso(t0),iso(t0+70*MIN),DEFAULTS.scrapeCadence),iso(t0+85*MIN)));
test('bài 7 giờ → +60 phút',()=>assert.equal(nextPollAt(t0,t0+420*MIN,DEFAULTS.scrapeCadence),iso(t0+480*MIN)));
test('bài 2 ngày → +240 phút',()=>assert.equal(nextPollAt(t0,t0+2880*MIN,DEFAULTS.scrapeCadence),iso(t0+3120*MIN)));
test('bài quá 3 ngày → null',()=>{
  assert.equal(nextPollAt(t0,t0+4321*MIN,DEFAULTS.scrapeCadence),null);
  assert.equal(nextPollAt(t0,t0+4320*MIN,DEFAULTS.scrapeCadence),null);
});

async function setup(){
  const db=openDatabase(':memory:');
  await db.run("INSERT INTO posts(id,text,created_at) VALUES('p','x','2026-11-18T00:00:00Z')");
  await db.run("INSERT INTO fb_groups(id,url,added_at) VALUES('g','https://fb.com/g','2026-11-18T00:00:00Z')");
  return db;
}
let n=0;
async function target(db,status,postedMs){await db.run('INSERT INTO post_targets(id,post_id,group_id,scheduled_at,status,posted_at) VALUES(?,?,?,?,?,?)',[`t${++n}`,'p','g','2026-11-18T00:00:00Z',status,postedMs==null?null:iso(postedMs)]);}

test('lần đăng thứ 6 trong ngày VN bị chặn',async()=>{
  const db=await setup();
  const now=t0+6*3600e3; // 16:00 VN
  const early=Date.parse('2026-11-18T00:10:00+07:00');
  await target(db,'published',early);await target(db,'pending_approval',early+60*MIN);await target(db,'declined',early+120*MIN);
  await target(db,'published',early+180*MIN);
  assert.equal((await canPost(db,DEFAULTS,now)).ok,true);
  await target(db,'published',early+240*MIN);
  await target(db,'failed',now-MIN); // không tính
  const r=await canPost(db,DEFAULTS,now);
  assert.equal(r.ok,false);assert.equal(r.reason,'Đã đăng đủ 5 bài hôm nay');
  assert.equal(r.waitUntil,iso(Date.parse('2026-11-19T00:00:00+07:00')));
  db.close();
});
test('bài của ngày hôm trước không tính vào hạn mức',async()=>{
  const db=await setup();
  for(let i=0;i<5;i++)await target(db,'published',Date.parse('2026-11-17T20:00:00+07:00')+i*MIN);
  assert.equal((await canPost(db,DEFAULTS,t0)).ok,true);
  db.close();
});
test('đăng cách lần trước 29 phút bị chặn, 30 phút được',async()=>{
  const db=await setup();
  await target(db,'published',t0-29*MIN);
  const r=await canPost(db,DEFAULTS,t0);
  assert.equal(r.ok,false);assert.equal(r.reason,'Chưa đủ 30 phút từ bài trước');assert.equal(r.waitUntil,iso(t0+MIN));
  assert.equal((await canPost(db,DEFAULTS,t0+MIN)).ok,true);
  db.close();
});

test('khoảng cách giữa hai bài vẫn tính qua nửa đêm VN',async()=>{
  const db=await setup();
  await target(db,'published',Date.parse('2026-11-17T23:50:00+07:00'));
  const r=await canPost(db,DEFAULTS,Date.parse('2026-11-18T00:10:00+07:00'));
  assert.equal(r.ok,false);assert.equal(r.reason,'Chưa đủ 30 phút từ bài trước');assert.equal(r.waitUntil,iso(Date.parse('2026-11-18T00:20:00+07:00')));
  assert.equal((await canPost(db,DEFAULTS,Date.parse('2026-11-18T00:21:00+07:00'))).ok,true);
  db.close();
});

async function reply(db,sentMs){
  const k=++n;
  await db.run('INSERT INTO post_targets(id,post_id,group_id,scheduled_at,status) VALUES(?,?,?,?,?)',[`rt${k}`,'p','g','2026-11-18T00:00:00Z','published']);
  await db.run('INSERT INTO comments(id,target_id,fb_comment_id,text,fetched_at) VALUES(?,?,?,?,?)',[`c${k}`,`rt${k}`,`f${k}`,'hi','2026-11-18T00:00:00Z']);
  await db.run("INSERT INTO replies(id,comment_id,status,created_at,sent_at) VALUES(?,?,'sent','2026-11-18T00:00:00Z',?)",[`r${k}`,`c${k}`,iso(sentMs)]);
}
test('câu trả lời thứ 21 trong 1 giờ bị chặn',async()=>{
  const db=await setup();
  for(let i=0;i<20;i++)await reply(db,t0-(59-i*2)*MIN); // 59,57,...,21 phút trước
  const r=await canReply(db,DEFAULTS,t0);
  assert.equal(r.ok,false);assert.equal(r.reason,'Đã gửi đủ 20 câu trong 1 giờ');
  assert.equal(r.waitUntil,iso(t0-59*MIN+60*MIN));
  db.close();
});
test('câu trả lời cách câu trước dưới 60 giây bị chặn',async()=>{
  const db=await setup();
  await reply(db,t0-30e3);
  const r=await canReply(db,DEFAULTS,t0);
  assert.equal(r.ok,false);assert.equal(r.reason,'Chưa đủ 60 giây từ câu trước');assert.equal(r.waitUntil,iso(t0+30e3));
  assert.equal((await canReply(db,DEFAULTS,t0+30e3)).ok,true);
  db.close();
});

test('trần 500 credit: 499 được, 500 bị chặn',async()=>{
  const db=await setup();
  assert.equal(await creditsToday(db,t0),0);
  await db.run("INSERT INTO api_calls(id,day,route,cost,created_at) VALUES('a','2026-11-18','x',300,'z'),('b','2026-11-18','x',199,'z'),('c','2026-11-17','x',900,'z')");
  assert.equal(await creditsToday(db,t0),499);
  assert.equal(await canSpendCredit(db,DEFAULTS,t0),true);
  await db.run("INSERT INTO api_calls(id,day,route,cost,created_at) VALUES('d','2026-11-18','x',1,'z')");
  assert.equal(await creditsToday(db,t0),500);
  assert.equal(await canSpendCredit(db,DEFAULTS,t0),false);
  db.close();
});

test('đếm lần đọc bằng trình duyệt trong 1 giờ qua',async()=>{
  const db=await setup();
  for(const [k,ms] of [['fb_read',t0-10*MIN],['fb_read',t0-61*MIN],['other',t0-MIN]])await db.run('INSERT INTO events(at,kind) VALUES(?,?)',[iso(ms),k]);
  assert.equal(await browserReadsLastHour(db,t0),1);
  db.close();
});
