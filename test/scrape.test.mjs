import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/db.mjs';
import {setRuntime,saveConfig} from '../server/settings.mjs';
import {ScrapeCreators,scrapeTarget,resetKeyBlocks} from '../server/scrape.mjs';
import {normalizeComment,saveComments} from '../server/comments.mjs';

const fx=n=>JSON.parse(readFileSync(new URL('./fixtures/'+n,import.meta.url),'utf8'));
const MIN=60e3,posted=Date.parse('2026-11-18T10:00:00+07:00'),iso=ms=>new Date(ms).toISOString();
const b64=s=>Buffer.from(s).toString('base64');
const env={SCRAPECREATORS_API_KEY:'test-key'};
let n=0;
async function setup({status='published',reader='scrape',postedAt=posted}={}){
  resetKeyBlocks();
  const db=openDatabase(':memory:'),id='t'+ ++n;
  await db.run("INSERT INTO posts(id,text,created_at) VALUES('p','x','2026-11-18T00:00:00Z')");
  await db.run("INSERT INTO fb_groups(id,url,added_at) VALUES('g','https://fb.com/g','2026-11-18T00:00:00Z')");
  await db.run('INSERT INTO post_targets(id,post_id,group_id,scheduled_at,status,reader,permalink,posted_at) VALUES(?,?,?,?,?,?,?,?)',[id,'p','g','2026-11-18T00:00:00Z',status,reader,'https://www.facebook.com/groups/1/posts/2',iso(postedAt)]);
  return {db,id};
}
// handler(route,url,callNo) → {status,body}; records every call
function fake(handler){
  const calls=[];
  const fetchImpl=async(url)=>{
    const u=new URL(url);calls.push({route:u.pathname,params:Object.fromEntries(u.searchParams)});
    const {status=200,body}=handler(u.pathname,u,calls.length);
    return {ok:status<400,status,headers:{get:()=>null},json:async()=>body};
  };
  return {calls,client:new ScrapeCreators(env,fetchImpl)};
}
const POST='/v1/facebook/post',COMMENTS='/v1/facebook/post/comments';
const standard=route=>({body:route===POST?fx('sc-post.json'):route.endsWith('/replies')?fx('sc-replies.json'):fx('sc-comments.json')});
const target=(db,id)=>db.first('SELECT * FROM post_targets WHERE id=?',[id]);
const when=min=>posted+min*MIN;

test('lưu comment mới, lần sau không lưu trùng',async()=>{
  const {db,id}=await setup(),{client,calls}=fake(standard);
  const r=await scrapeTarget(db,env,id,{client,now:when(10)});
  const rows=await db.all('SELECT * FROM comments WHERE target_id=? ORDER BY fb_comment_id',[id]);
  assert.equal(rows.length,9); // 5 comment + 4 trả lời
  assert.equal(r.added,9);
  const top=rows.find(c=>c.fb_comment_id==='1167940162406976');
  assert.equal(top.id,id+':1167940162406976');assert.equal(top.text,'Mua bên loa ai bên mình để bàn siêu đẹp ạ');assert.equal(top.author_id,'900000000001');assert.equal(top.parent_fb_id,null);
  const reply=rows.find(c=>c.fb_comment_id==='1167940909073568');
  assert.ok(reply.parent_fb_id);assert.equal(rows.filter(c=>c.parent_fb_id).length,4);
  assert.deepEqual([calls[0].route,calls[0].params],[POST,{url:'https://www.facebook.com/groups/1/posts/2'}]);
  assert.deepEqual([calls[1].route,calls[1].params],[COMMENTS,{url:'https://www.facebook.com/groups/1/posts/2',sort:'all'}]);
  const t=await target(db,id);assert.equal(t.last_polled_at,iso(when(10)));assert.equal(t.next_poll_at,iso(when(15)));assert.equal(t.error,null);
  const before=calls.length;
  const again=await scrapeTarget(db,env,id,{client,now:when(15)});
  assert.equal(again.added,0);assert.equal(calls.length,before+1);assert.equal(calls.at(-1).route,POST); // comment_count không đổi → chỉ gọi /post
  assert.equal((await db.first('SELECT COUNT(*) AS c FROM comments')).c,9);
  db.close();
});

test('chỉ đọc trả lời khi reply_count tăng',async()=>{
  const {db,id}=await setup(),{client,calls}=fake(standard);
  await scrapeTarget(db,env,id,{client,now:when(10)});
  assert.equal(calls.filter(c=>c.route.endsWith('/replies')).length,4); // 4 comment có reply_count>0
  const bumped=fx('sc-comments.json');bumped.comments[4].reply_count=1;bumped.cursor=null;
  const f2=fake(route=>route.endsWith('/replies')?{body:fx('sc-replies.json')}:{body:bumped});
  await scrapeTarget(db,env,id,{client:f2.client,now:when(20)});
  assert.equal(f2.calls.filter(c=>c.route.endsWith('/replies')).length,1);
  assert.equal(f2.calls.find(c=>c.route.endsWith('/replies')).params.feedback_id,bumped.comments[4].feedback_id);
  db.close();
});

test('comment của chính nick (author_id) → is_own=1',async()=>{
  const {db,id}=await setup();
  await setRuntime(db,{ownAuthorId:'900000000002'});
  await saveComments(db,id,fx('sc-comments.json').comments.map(c=>normalizeComment(c)));
  const own=await db.all('SELECT author_id FROM comments WHERE is_own=1');
  assert.deepEqual(own.map(r=>r.author_id),['900000000002']);
  db.close();
});

test('không có author_id: nội dung trùng câu đã gửi kèm dòng ghi chú → is_own=1',async()=>{
  const {db,id}=await setup();
  await saveConfig(db,{signatureLine:'— Figo AI'});
  const [seed]=await saveComments(db,id,[normalizeComment({id:b64('comment:1_100'),text:'Hỏi giá ạ',author:{id:'9',name:'K'}})]);
  await db.run("INSERT INTO replies(id,comment_id,final_text,status,created_at) VALUES('r1',?,'Dạ giá 1tr2 ạ','sent','2026-11-18T00:00:00Z')",[seed]);
  const noAuthor=text=>normalizeComment({id:b64('comment:1_'+text.length),text,created_at:1763430000});
  const ids=await saveComments(db,id,[noAuthor('Dạ giá 1tr2 ạ\n— Figo AI \n'),noAuthor('  Dạ giá 1tr2 ạ '),noAuthor('Dạ giá 2tr ạ')]);
  const own=Object.fromEntries((await db.all('SELECT text,is_own FROM comments WHERE id IN (?,?,?)',ids)).map(r=>[r.text.trim(),r.is_own]));
  assert.equal(own['Dạ giá 1tr2 ạ\n— Figo AI'],1);assert.equal(own['Dạ giá 1tr2 ạ'],1);assert.equal(own['Dạ giá 2tr ạ'],0);
  assert.equal((await db.first("SELECT is_own FROM comments WHERE id=?",[seed])).is_own,0);
  db.close();
});

test('normalizeComment: giải base64, id lạ giữ nguyên',()=>{
  const c=normalizeComment(fx('sc-comments.json').comments[0],'P');
  assert.equal(c.fb_comment_id,'1167940162406976');assert.equal(c.parent_fb_id,'P');assert.equal(c.created_at,'2026-11-18T05:55:31.000Z');assert.equal(c.reply_count,4);
  assert.equal(normalizeComment({id:'plain-id',text:'x'}).fb_comment_id,'plain-id');
});

test('SOURCE_UNAVAILABLE → reader=browser, next_poll_at=now',async()=>{
  const {db,id}=await setup(),{client}=fake(()=>({status:404,body:{success:false,message:'not found'}}));
  const r=await scrapeTarget(db,env,id,{client,now:when(2)});
  const t=await target(db,id);assert.equal(t.reader,'browser');assert.equal(t.next_poll_at,iso(when(2)));assert.equal(r.added,0);
  db.close();
});

test('chưa thấy bài sau 30 phút → reader=browser; 29 phút → vẫn scrape',async()=>{
  const bad=()=>({status:400,body:{success:false,message:'bad'}});
  for(const [min,reader] of [[29,'scrape'],[30,'browser']]){
    const {db,id}=await setup(),{client}=fake(bad);
    await scrapeTarget(db,env,id,{client,now:when(min)});
    const t=await target(db,id);assert.equal(t.reader,reader);
    assert.equal(t.next_poll_at,reader==='browser'?iso(when(min)):iso(when(min+5)));
    db.close();
  }
});

test('lỗi tạm thời (500) → giữ scrape, ghi error, đọc lại theo lịch',async()=>{
  const {db,id}=await setup(),{client}=fake(()=>({status:500,body:{success:false}}));
  await scrapeTarget(db,env,id,{client,now:when(45)});
  const t=await target(db,id);assert.equal(t.reader,'scrape');assert.ok(t.error);assert.equal(t.next_poll_at,iso(when(50)));
  db.close();
});

test('hết credit của nhà cung cấp → ghi sự kiện, đọc lại sau 30 phút',async()=>{
  const {db,id}=await setup(),{client}=fake(()=>({status:402,body:{success:false,credits_remaining:0}}));
  await scrapeTarget(db,env,id,{client,now:when(45)});
  const t=await target(db,id);assert.equal(t.reader,'scrape');assert.ok(t.error);assert.equal(t.next_poll_at,iso(when(75)));
  assert.equal((await db.first("SELECT COUNT(*) AS c FROM events WHERE kind='scrape_error'")).c,1);
  db.close();
});

test('danh sách comment rỗng là 0 comment, không phải "chưa thấy bài"',async()=>{
  const {db,id}=await setup(),{client}=fake(()=>({body:{success:true,credits_charged:1,comments:[],cursor:null}}));
  const r=await scrapeTarget(db,env,id,{client,now:when(45)});
  const t=await target(db,id);assert.equal(t.reader,'scrape');assert.equal(t.error,null);assert.equal(r.added,0);assert.equal(t.last_polled_at,iso(when(45)));
  db.close();
});

test('chạm trần credit → không gọi fetch',async()=>{
  const {db,id}=await setup(),{client,calls}=fake(standard);
  await db.run("INSERT INTO api_calls(id,day,route,cost,created_at) VALUES('a','2026-11-18','/x',500,'2026-11-18T00:00:00Z')");
  const r=await scrapeTarget(db,env,id,{client,now:when(10)});
  assert.equal(calls.length,0);assert.deepEqual(r,{added:0,charge:0});
  assert.equal((await db.first("SELECT COUNT(*) AS c FROM events WHERE kind='credit_cap'")).c,1);
  assert.equal((await target(db,id)).next_poll_at,iso(when(15)));
  db.close();
});

test('chạm trần giữa chừng → dừng, trần kiểm trước mỗi lần gọi',async()=>{
  const {db,id}=await setup(),{client,calls}=fake(standard);
  await saveConfig(db,{creditCapPerDay:3});
  await scrapeTarget(db,env,id,{client,now:when(10)});
  assert.equal(calls.length,3);
  assert.equal((await db.first('SELECT SUM(cost) AS s FROM api_calls')).s,3);
  const rc=Object.fromEntries((await db.all('SELECT fb_comment_id,reply_count,parent_fb_id FROM comments WHERE target_id=?',[id])).map(r=>[r.fb_comment_id,r]));
  const tops=fx('sc-comments.json').comments.map(c=>normalizeComment(c));
  assert.equal((await db.all('SELECT 1 FROM comments WHERE parent_fb_id IS NULL')).length,5);
  assert.equal((await db.all('SELECT 1 FROM comments WHERE parent_fb_id IS NOT NULL')).length,4); // replies already fetched
  assert.deepEqual(calls.map(c=>c.route),[POST,COMMENTS,'/v1/facebook/post/comment/replies']);
  assert.equal(rc[tops[0].fb_comment_id].reply_count,4); // fully fetched
  for(const i of [1,2,3])assert.equal(rc[tops[i].fb_comment_id].reply_count,0); // cut off → old count
  assert.equal((await target(db,id)).comment_count,null,'bị cắt → chưa lưu comment_count');
  db.close();
});

test('lỗi tạm thời khi đọc trả lời → vẫn lưu comment gốc, giữ scrape',async()=>{
  const {db,id}=await setup(),{client}=fake(route=>route.endsWith('/replies')?{status:500,body:{success:false}}:{body:fx('sc-comments.json')});
  await scrapeTarget(db,env,id,{client,now:when(10)});
  const rows=await db.all('SELECT reply_count FROM comments WHERE target_id=?',[id]);
  assert.equal(rows.length,5);assert.ok(rows.every(r=>r.reply_count===0));
  const t=await target(db,id);assert.equal(t.reader,'scrape');assert.ok(t.error);assert.equal(t.next_poll_at,iso(when(15)));
  db.close();
});

test('cursor lặp → dừng, không gọi thêm',async()=>{
  const {db,id}=await setup(),{client,calls}=fake((route,u,k)=>({body:{success:true,credits_charged:1,cursor:'SAME',comments:[{id:b64('comment:1_'+k),text:'c'+k,created_at:'2026-11-18T05:55:31.000Z',reply_count:0,author:{id:'1',name:'A'}}]}}));
  const r=await scrapeTarget(db,env,id,{client,now:when(10)});
  assert.equal(calls.length,3);assert.equal(calls[0].route,POST);assert.equal(calls[2].params.cursor,'SAME');assert.equal(r.added,2);
  db.close();
});


test('mỗi lần gọi ghi 1 dòng api_calls với cost = credits_charged',async()=>{
  const {db,id}=await setup(),{client}=fake(route=>({body:{...standard(route).body,credits_charged:2}}));
  const r=await scrapeTarget(db,env,id,{client,now:when(10)});
  const rows=await db.all('SELECT * FROM api_calls');
  assert.equal(rows.length,7);assert.ok(rows.every(x=>x.cost===2&&x.day==='2026-11-18'));
  assert.equal(r.charge,14);assert.equal(rows.filter(x=>x.route===POST).length,1);
  assert.equal(rows.filter(x=>x.route==='/v1/facebook/post/comment/replies').length,4);
  db.close();
});

test('lỗi mạng cũng ghi 1 credit dự phòng',async()=>{
  resetKeyBlocks();
  const {db,id}=await setup();
  const client=new ScrapeCreators(env,async()=>{throw new Error('down');});
  await scrapeTarget(db,env,id,{client,now:when(10)});
  assert.equal((await db.first('SELECT COUNT(*) AS c, SUM(cost) AS s FROM api_calls')).s,1);
  assert.equal((await target(db,id)).reader,'scrape');
  db.close();
});

test('target không phải published/scrape → không làm gì',async()=>{
  const a=await setup({reader:'browser'}),b=await setup({status:'pending_approval'}),{client,calls}=fake(standard);
  for(const {db,id} of [a,b]){assert.deepEqual(await scrapeTarget(db,env,id,{client,now:when(10)}),{added:0,charge:0});db.close();}
  assert.equal(calls.length,0);
});

test('C2: cho phép ba route (thêm /v1/facebook/post), route khác bị chặn, URL gốc lấy từ SCRAPE_BASE_URL',async()=>{
  resetKeyBlocks();
  const seen=[];
  const c=new ScrapeCreators({...env,SCRAPE_BASE_URL:'http://127.0.0.1:9'},async u=>{seen.push(String(u));return {ok:true,status:200,headers:{get:()=>null},json:async()=>({success:true})};});
  await assert.rejects(c.get('/v1/facebook/profile',{url:'x'}),{code:'INVALID_ROUTE'});
  await c.get('/v1/facebook/post',{url:'x'});assert.ok(seen.shift().startsWith('http://127.0.0.1:9/v1/facebook/post?url=x'));
  await c.get('/v1/facebook/post/comments',{url:'x'});
  assert.ok(seen[0].startsWith('http://127.0.0.1:9/v1/facebook/post/comments?'));
  await assert.rejects(new ScrapeCreators({},async()=>{}).get('/v1/facebook/post/comments',{}),{code:'MISSING_API_KEY'});
});

// final fix wave
const comment=k=>({id:b64('comment:1_'+k),text:'c'+k,created_at:'2026-11-18T03:10:00Z',reply_count:0,author:{id:'a'+k,name:'A'}});
function paged(st){return fake((route,u)=>route===POST?{body:{success:true,credits_charged:1,post_id:'1',comment_count:st.count}}:{body:{success:true,credits_charged:1,...st.pages[u.searchParams.get('cursor')??'']}});}
test('C2a: trang 1 là 5 comment đã biết, comment mới #7 ở trang 2, comment_count tăng → #7 được lưu',async()=>{
  const {db,id}=await setup();
  const st={count:6,pages:{'':{comments:[1,2,3,4,5].map(comment),cursor:'P2'},P2:{comments:[6].map(comment),cursor:null}}},f=paged(st);
  await scrapeTarget(db,env,id,{client:f.client,now:when(10)});
  assert.equal((await target(db,id)).comment_count,6);
  st.count=7;st.pages.P2={comments:[6,7].map(comment),cursor:null};f.calls.length=0;
  const r=await scrapeTarget(db,env,id,{client:f.client,now:when(20)});
  assert.ok(await db.first("SELECT 1 AS x FROM comments WHERE fb_comment_id='7'"),'#7 được lưu');assert.equal(r.added,1);
  assert.deepEqual(f.calls.map(c=>[c.route,c.params.cursor??null]),[[POST,null],[COMMENTS,null],[COMMENTS,'P2']]);
  assert.equal((await target(db,id)).comment_count,7);
  db.close();
});
test('C2b: comment_count không đổi → đúng 1 lần gọi (/post), không đọc comment, vẫn dời lịch',async()=>{
  const {db,id}=await setup();await db.run('UPDATE post_targets SET comment_count=9,error=? WHERE id=?',['lỗi cũ',id]);
  const {client,calls}=fake(standard);
  const r=await scrapeTarget(db,env,id,{client,now:when(10)});
  assert.deepEqual(calls.map(c=>[c.route,c.params]),[[POST,{url:'https://www.facebook.com/groups/1/posts/2'}]]);
  assert.deepEqual(r,{added:0,charge:1});assert.equal((await db.first('SELECT SUM(cost) AS s FROM api_calls')).s,1);
  const t=await target(db,id);assert.equal(t.last_polled_at,iso(when(10)));assert.equal(t.next_poll_at,iso(when(15)));assert.equal(t.comment_count,9);assert.equal(t.error,null);
  db.close();
});
test('C2c: /post báo SOURCE_UNAVAILABLE → chuyển đọc bằng Chrome ngay, không đọc comment',async()=>{
  const {db,id}=await setup(),{client,calls}=fake(route=>route===POST?{status:404,body:{success:false,message:'not found'}}:standard(route));
  await scrapeTarget(db,env,id,{client,now:when(2)});
  const t=await target(db,id);assert.equal(t.reader,'browser');assert.equal(t.next_poll_at,iso(when(2)));assert.equal(t.comment_count,null);
  assert.deepEqual(calls.map(c=>c.route),[POST]);
  db.close();
});
test('C2: đọc tới 20 trang dù trang đầu không có gì mới; chạm mốc → scrape_partial, vẫn lưu comment_count (R2)',async()=>{
  const {db,id}=await setup(),{client,calls}=fake((route,u,k)=>route===POST?{body:{success:true,comment_count:500}}:{body:{success:true,credits_charged:1,cursor:'C'+k,comments:[comment(1)]}});
  await scrapeTarget(db,env,id,{client,now:when(10)});
  assert.equal(calls.filter(c=>c.route===COMMENTS).length,20);
  assert.equal((await db.first("SELECT COUNT(*) AS c FROM events WHERE kind='scrape_partial'")).c,1);
  const t=await target(db,id);assert.equal(t.comment_count,500);assert.equal(t.last_polled_at,iso(when(10)));
  db.close();
});
test('C2: lượt đọc bị cắt (trần credit hoặc lỗi) → chưa lưu comment_count, lần sau đọc lại',async()=>{
  for(const cut of ['cap','error']){
    const {db,id}=await setup();if(cut==='cap')await saveConfig(db,{creditCapPerDay:2});
    const {client}=fake((route,u)=>route===POST?{body:fx('sc-post.json')}:cut==='error'&&u.searchParams.get('cursor')==='P2'?{status:500,body:{success:false}}:{body:{success:true,credits_charged:1,comments:[comment(1)],cursor:u.searchParams.get('cursor')?null:'P2'}});
    await scrapeTarget(db,env,id,{client,now:when(10)});
    assert.equal((await target(db,id)).comment_count,null,cut);
    db.close();
  }
});
test('I1: target thiếu link hoặc giờ đăng → bỏ khỏi lịch, ghi lỗi, không gọi gì',async()=>{
  for(const col of ['permalink','posted_at']){
    const {db,id}=await setup();await db.run(`UPDATE post_targets SET ${col}=NULL,next_poll_at=? WHERE id=?`,[iso(when(0)),id]);
    const {client,calls}=fake(standard);
    assert.deepEqual(await scrapeTarget(db,env,id,{client,now:when(10)}),{added:0,charge:0});
    const t=await target(db,id);assert.equal(t.next_poll_at,null,col);assert.equal(t.error,'Thiếu link bài hoặc giờ đăng');assert.equal(calls.length,0);
    db.close();
  }
});
const seedReply=async(db,id,status,text)=>{const [c]=await saveComments(db,id,[normalizeComment({id:b64('comment:1_100'),text:'Hỏi ạ',created_at:'2026-11-18T02:00:00Z',author:{id:'9',name:'K'}})]);await db.run("INSERT INTO replies(id,comment_id,final_text,status,created_at) VALUES('r1',?,?,?,'2026-11-18T00:00:00Z')",[c,text,status]);};
const scraped=(k,text)=>normalizeComment({id:b64('comment:1_'+k),text,created_at:'2026-11-18T03:00:00Z',author:{id:'pfbid-other-format',name:'Shop'}},'100');
const ownOf=async(db,id,k)=>(await db.first('SELECT is_own FROM comments WHERE id=?',[id+':'+k])).is_own;
test('I2: câu của tool đọc về lúc còn "sending" (author id khác dạng) → is_own=1, không bị soạn trả lời',async()=>{
  const {db,id}=await setup();await seedReply(db,id,'sending','Dạ có 4G ạ');
  await saveComments(db,id,[scraped(99,'Dạ có 4G ạ')]);assert.equal(await ownOf(db,id,99),1);
  db.close();
});
test('I2: câu failed «không rõ đã gửi» thật ra đã lên, câu approved → is_own=1; skipped/waiting thì không',async()=>{
  for(const [st,own] of [['failed',1],['approved',1],['sent',1],['skipped',0],['waiting',0]]){
    const {db,id}=await setup();await seedReply(db,id,st,'Dạ có 4G ạ');
    await saveComments(db,id,[scraped(98,'Dạ có 4G ạ')]);assert.equal(await ownOf(db,id,98),own,st);
    db.close();
  }
});
test('I2: khác khoảng trắng, xuống dòng, có hoặc không dòng ghi chú vẫn khớp',async()=>{
  const {db,id}=await setup();await saveConfig(db,{signatureLine:'— Figo AI'});await seedReply(db,id,'sent','Dạ có 4G ạ.\nShop gửi anh ạ');
  await saveComments(db,id,[scraped(1,'Dạ  có 4G ạ. Shop gửi anh ạ\n— Figo AI'),scraped(2,'  Dạ có\t4G ạ.\n\nShop gửi anh ạ '),scraped(3,'Dạ có 4G ạ.\nShop gửi anh ạ —  Figo   AI'),scraped(4,'Dạ có 5G ạ.\nShop gửi anh ạ')]);
  assert.deepEqual([await ownOf(db,id,1),await ownOf(db,id,2),await ownOf(db,id,3),await ownOf(db,id,4)],[1,1,1,0]);
  db.close();
});
test('I2: comment đã lưu is_own=0, lần đọc sau khớp câu đã gửi → nâng lên 1 và không bao giờ hạ',async()=>{
  const {db,id}=await setup();
  await saveComments(db,id,[scraped(97,'Dạ có 4G ạ')]);assert.equal(await ownOf(db,id,97),0);
  await seedReply(db,id,'sent','Dạ có 4G ạ');
  await saveComments(db,id,[scraped(97,'Dạ có 4G ạ')]);assert.equal(await ownOf(db,id,97),1);
  await db.run('DELETE FROM replies');await saveComments(db,id,[scraped(97,'Dạ có 4G ạ')]);assert.equal(await ownOf(db,id,97),1);
  db.close();
});
test('I7: chạm trần credit ghi credit_cap tối đa 1 lần mỗi giờ, không phải mỗi bài mỗi lượt',async()=>{
  const {db,id}=await setup();
  await db.run("INSERT INTO post_targets(id,post_id,group_id,scheduled_at,status,reader,permalink,posted_at) VALUES('other','p','g','2026-11-18T00:00:00Z','published','scrape','https://www.facebook.com/groups/1/posts/3',?)",[iso(posted)]);
  await db.run("INSERT INTO api_calls(id,day,route,cost,created_at) VALUES('a','2026-11-18','/x',500,'2026-11-18T00:00:00Z')");
  const {client,calls}=fake(standard),n=async()=>(await db.first("SELECT COUNT(*) AS c FROM events WHERE kind='credit_cap'")).c;
  for(const [t,min] of [[id,10],['other',10],[id,20],['other',69]])await scrapeTarget(db,env,t,{client,now:when(min)});
  assert.equal(await n(),1);
  await scrapeTarget(db,env,id,{client,now:when(71)});assert.equal(await n(),2,'hơn 1 giờ sau thì ghi lại');
  assert.equal(calls.length,0);
  db.close();
});
test('R2: chạm mốc 20 trang vẫn lưu comment_count; lần sau đúng 1 lần gọi (/post)',async()=>{
  const {db,id}=await setup(),{client,calls}=fake((route,u,k)=>route===POST?{body:{success:true,comment_count:150}}:{body:{success:true,credits_charged:1,cursor:'C'+k,comments:[comment(1)]}});
  await scrapeTarget(db,env,id,{client,now:when(10)});
  assert.equal(calls.filter(c=>c.route===COMMENTS).length,20);
  assert.equal((await db.first("SELECT COUNT(*) AS c FROM events WHERE kind='scrape_partial'")).c,1);
  assert.equal((await target(db,id)).comment_count,150);
  const before=calls.length;
  await scrapeTarget(db,env,id,{client,now:when(20)});
  assert.deepEqual(calls.slice(before).map(c=>c.route),[POST]);
  db.close();
});
