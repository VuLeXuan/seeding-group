import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,logEvent} from '../server/db.mjs';
import {DEFAULTS,getConfig,saveConfig,getRuntime,setRuntime} from '../server/settings.mjs';
import {getKb,saveKb,listKbVersions,TEMPLATES} from '../server/kb.mjs';

test('mở DB 2 lần không chạy lại migration',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'fbdesk-'));
  try{
    const file=join(dir,'t.db');
    const a=openDatabase(file);a.close();
    const b=openDatabase(file);
    assert.deepEqual((await b.all('SELECT tag FROM _local_migrations ORDER BY tag')).map(r=>r.tag),['0000_init','0001_comment_count']);
    assert.ok((await b.all('PRAGMA table_info(post_targets)')).some(c=>c.name==='comment_count'));
    b.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('getConfig trả mặc định',async()=>{
  const db=openDatabase(':memory:');
  const c=await getConfig(db);
  assert.equal(c.postsPerDay,5);assert.equal(c.postGapMinutes,30);assert.equal(c.repliesPerHour,20);assert.equal(c.creditCapPerDay,500);assert.equal(c.phase,1);
  assert.deepEqual(c.autoSend,{spec:false,price_known:false,no_reply:false});
  assert.deepEqual(c.scrapeCadence,[[60,5],[360,15],[1440,60],[4320,240]]);
  db.close();
});

test('saveConfig lưu và trộn với mặc định',async()=>{
  const db=openDatabase(':memory:');
  const c=await saveConfig(db,{postsPerDay:7,autoSend:{spec:true},signatureLine:'— Shop'});
  assert.equal(c.postsPerDay,7);assert.equal(c.repliesPerHour,20);
  assert.deepEqual(c.autoSend,{spec:true,price_known:false,no_reply:false});
  assert.equal((await getConfig(db)).signatureLine,'— Shop');
  db.close();
});

test('saveConfig từ chối giá trị sai',async()=>{
  const db=openDatabase(':memory:');
  await assert.rejects(saveConfig(db,{postsPerDay:0}),{code:'INVALID_SETTING'});
  await assert.rejects(saveConfig(db,{postsPerDay:1.5}),{code:'INVALID_SETTING'});
  await assert.rejects(saveConfig(db,{phase:3}),{code:'INVALID_SETTING'});
  await assert.rejects(saveConfig(db,{autoSend:{order:true}}),{code:'INVALID_SETTING'});
  await assert.rejects(saveConfig(db,{autoSend:{spec:'yes'}}),{code:'INVALID_SETTING'});
  await assert.rejects(saveConfig(db,{scrapeCadence:[]}),{code:'INVALID_SETTING'});
  await assert.rejects(saveConfig(db,{scrapeCadence:[[60,5],[30,15]]}),{code:'INVALID_SETTING'});
  await assert.rejects(saveConfig(db,{browserCadence:[[60,0]]}),{code:'INVALID_SETTING'});
  await assert.rejects(saveConfig(db,{unknownKey:1}),{code:'INVALID_SETTING'});
  assert.equal((await getConfig(db)).postsPerDay,DEFAULTS.postsPerDay);
  db.close();
});

test('runtime mặc định và setRuntime',async()=>{
  const db=openDatabase(':memory:');
  assert.deepEqual(await getRuntime(db),{paused:false,pauseReason:null,pauseScreenshot:null,ownAuthorId:null,loginState:'unknown',loginRequested:false,loginCheckedAt:null,loginWindowOpen:false,loginError:null});
  const r=await setRuntime(db,{paused:true,pauseReason:'x'});
  assert.equal(r.paused,true);assert.equal((await getRuntime(db)).pauseReason,'x');
  db.close();
});

test('getKb lần đầu có mẫu, saveKb tạo phiên bản mới',async()=>{
  const db=openDatabase(':memory:');
  const a=await getKb(db);
  assert.match(a.knowledge,/## Liên hệ được công khai/);
  assert.match(a.persona,/## Không bao giờ nói/);
  await saveKb(db,'knowledge','x');
  const b=await getKb(db);
  assert.equal(b.knowledge,'x');assert.ok(b.knowledgeVersion>a.knowledgeVersion);
  assert.equal(b.persona,TEMPLATES.persona);
  assert.equal((await listKbVersions(db,'knowledge')).length,2);
  await assert.rejects(saveKb(db,'other','x'),{code:'INVALID_SETTING'});
  db.close();
});

test('logEvent ghi sự kiện',async()=>{
  const db=openDatabase(':memory:');
  await logEvent(db,'test',{a:1});
  const row=await db.first('SELECT kind,detail FROM events');
  assert.equal(row.kind,'test');assert.equal(row.detail,'{"a":1}');
  db.close();
});
