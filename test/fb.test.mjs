import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {loginState,ownProfileId} from '../server/fb/actions.mjs';
import {openSession,sessionOpen,closeSession} from '../server/fb/browser.mjs';

// fake Facebook on 127.0.0.1: never the real site
const PAGES={
  '/':{cookie:true,html:'<h1>Trang chu</h1>'},
  '/checkpoint/':{cookie:true,html:'<h1>Xac minh</h1>'},
  '/login/':{html:'<h1>Dang nhap</h1>'},
  '/passpage':{cookie:true,html:'<form><input name="pass" type="password"></form>'},
  '/nocookie':{html:'<h1>Khach</h1>'},
};
async function fakeFb(t){
  const server=createServer((req,res)=>{
    const p=PAGES[req.url.split('?')[0]];
    if(!p){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...(p.cookie?{'Set-Cookie':'c_user=1000777; Path=/'}:{})});res.end(p.html);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  return `http://127.0.0.1:${server.address().port}`;
}
const tmp=t=>{const d=mkdtempSync(join(tmpdir(),'fb-chrome-'));t.after(async()=>{await closeSession();rmSync(d,{recursive:true,force:true});});return d;};

test('loginState và ownProfileId trên trang Facebook giả', async t=>{
  const base=await fakeFb(t),dir=tmp(t);
  const {ctx,page}=await openSession({profileDir:dir,headless:true,baseUrl:base});
  assert.equal(page.url(),base+'/');
  assert.equal(await loginState(ctx,page,base),'logged_in');
  assert.equal(await ownProfileId(ctx,base),'1000777');
  await page.goto(base+'/checkpoint/');assert.equal(await loginState(ctx,page,base),'checkpoint');
  await page.goto(base+'/login/');assert.equal(await loginState(ctx,page,base),'logged_out');
  await page.goto(base+'/passpage');assert.equal(await loginState(ctx,page,base),'logged_out');
  await ctx.clearCookies();
  await page.goto(base+'/nocookie');assert.equal(await loginState(ctx,page,base),'logged_out');
  assert.equal(await ownProfileId(ctx,base),null);
  await page.close();
  assert.equal(await loginState(ctx,page,base),'unknown');
});

test('openSession hai lần → cùng một phiên; closeSession nhả khoá profile', async t=>{
  const base=await fakeFb(t),dir=tmp(t);
  const [a,b]=await Promise.all([openSession({profileDir:dir,headless:true,baseUrl:base}),openSession({profileDir:dir,headless:true,baseUrl:base})]);
  assert.equal(a.page,b.page);assert.equal(a.ctx,b.ctx);
  assert.equal(sessionOpen(),true);
  const c=await openSession({profileDir:dir,headless:true,baseUrl:base});
  assert.equal(c.page,a.page);
  await closeSession();
  assert.equal(sessionOpen(),false);
  await closeSession(); // safe when none
  const again=await chromium.launchPersistentContext(dir,{channel:'chrome',headless:true});
  t.after(()=>again.close().catch(()=>{}));
  await again.close();
});

test('đóng hết trang → phiên coi như đã đóng và Chrome được đóng hẳn', async t=>{
  const base=await fakeFb(t),dir=tmp(t);
  const {page}=await openSession({profileDir:dir,headless:true,baseUrl:base});
  await page.close();
  for(let i=0;i<50&&sessionOpen();i++)await new Promise(r=>setTimeout(r,100));
  assert.equal(sessionOpen(),false);
  const again=await chromium.launchPersistentContext(dir,{channel:'chrome',headless:true});
  t.after(()=>again.close().catch(()=>{}));
  await again.close();
});

test('profile còn c_user nhưng Facebook không tải được → không bao giờ là logged_in', async t=>{
  const base=await fakeFb(t),dir=tmp(t);
  let s=await openSession({profileDir:dir,headless:true,baseUrl:base});
  assert.equal(await loginState(s.ctx,s.page,base),'logged_in');
  await closeSession();
  // same profile (cookie kept), but the site is down now: the page never loads
  const down=createServer();await new Promise(r=>down.listen(0,'127.0.0.1',r));
  const dead=`http://127.0.0.1:${down.address().port}`;await new Promise(r=>down.close(r));
  s=await openSession({profileDir:dir,headless:true,baseUrl:dead});
  assert.notEqual(await loginState(s.ctx,s.page,dead),'logged_in');
  assert.equal(await loginState(s.ctx,s.page,base),'unknown','trang không thuộc baseUrl');
});
