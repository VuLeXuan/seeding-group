// Task 0 trial (throwaway): drive the owner's logged-in Chrome profile by hand, one step per run.
// Nothing is sent to Facebook without --confirm. Every step saves a screenshot + HTML under .data/trial/.
import {chromium} from 'playwright-core';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';

const PROFILE=resolve(process.env.FB_PROFILE_DIR||'.data/chrome-profile'),OUT=resolve('.data/trial'),FB='https://www.facebook.com';
mkdirSync(OUT,{recursive:true});
const {positionals:[cmd],values:opt}=parseArgs({allowPositionals:true,options:{
  group:{type:'string'},url:{type:'string'},'text-file':{type:'string'},image:{type:'string',multiple:true},confirm:{type:'boolean',default:false},wait:{type:'string',default:'600'}}});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
const out=o=>console.log(JSON.stringify(o,null,2));
const rx=(...words)=>new RegExp(words.join('|'),'i');

async function open(){
  const ctx=await chromium.launchPersistentContext(PROFILE,{channel:'chrome',headless:false,viewport:null,locale:'vi-VN'});
  const page=ctx.pages()[0]||await ctx.newPage();
  return {ctx,page};
}
async function capture(page,label){
  const base=`${OUT}/${label}-${stamp()}`;
  try{await page.screenshot({path:base+'.png',fullPage:false});}catch{}
  try{writeFileSync(base+'.html',await page.content());}catch{}
  return base;
}
async function me(ctx){const c=(await ctx.cookies(FB)).find(c=>c.name==='c_user');return c?.value||null;}
// c_user is set before email-code / 2FA / checkpoint steps finish, so it alone never means "logged in"
const GATE=/\/(checkpoint|confirmemail\.php|two_step_verification|two_factor|login|recover|authentication|device-based)/i;
async function state(ctx,page){
  const url=page.url();
  if(GATE.test(url))return /\/login|recover/i.test(url)?'logged_out':'checkpoint';
  if(!await me(ctx))return 'logged_out';
  if(await page.locator('input[name="pass"]').count().catch(()=>0))return 'logged_out';
  return 'logged_in';
}
function text(){if(!opt['text-file'])throw new Error('--text-file is required');return readFileSync(opt['text-file'],'utf8').trim();}

async function login(){
  const {ctx,page}=await open();
  await page.goto(FB,{waitUntil:'domcontentloaded'});
  // wait until "logged_in" holds for 20 s in a row, so a page passing between steps never closes the window on the owner
  const end=Date.now()+Number(opt.wait)*1000;let okSince=0;
  while(Date.now()<end){
    const s=await state(ctx,page).catch(()=>'unknown');
    if(s==='logged_in'){okSince||=Date.now();if(Date.now()-okSince>=20000)break;}else okSince=0;
    await sleep(2000);
  }
  const s=await state(ctx,page);
  const shot=await capture(page,'login');
  out({state:s,ownProfileId:await me(ctx),screenshot:shot});
  await ctx.close();
}

async function whoami(){
  const {ctx,page}=await open();
  await page.goto(FB,{waitUntil:'domcontentloaded'});await sleep(3000);
  out({state:await state(ctx,page),ownProfileId:await me(ctx),url:page.url(),screenshot:await capture(page,'whoami')});
  await ctx.close();
}

async function inspect(){
  const {ctx,page}=await open();
  await page.goto(opt.url,{waitUntil:'domcontentloaded'});await sleep(5000);
  out({state:await state(ctx,page),url:page.url(),title:await page.title(),screenshot:await capture(page,'inspect')});
  await ctx.close();
}

async function post(){
  if(!opt.group)throw new Error('--group is required');
  const body=text(),{ctx,page}=await open(),log=[];
  try{
    await page.goto(opt.group,{waitUntil:'domcontentloaded'});await sleep(5000);
    log.push({step:'group',state:await state(ctx,page),url:page.url(),shot:await capture(page,'post-1-group')});
    if(await state(ctx,page)!=='logged_in')throw new Error('not logged in');
    const composer=page.getByRole('button',{name:rx('Bạn viết gì đi','Viết gì đó','Write something','What\'s on your mind')}).first();
    await composer.click({timeout:15000});await sleep(2500);
    const dialog=page.getByRole('dialog').filter({has:page.getByRole('textbox')}).last();
    log.push({step:'composer',dialogVisible:await dialog.isVisible().catch(()=>false),shot:await capture(page,'post-2-composer')});
    if(!opt.confirm){await page.keyboard.press('Escape');log.push({step:'dry-run: closed composer, nothing typed or posted'});return;}
    const box=dialog.getByRole('textbox').first();await box.click();await page.keyboard.type(body,{delay:15});await sleep(1000);
    if(opt.image?.length){
      const photo=dialog.getByRole('button',{name:rx('Ảnh/video','Photo/video')}).first();
      const chooser=page.waitForEvent('filechooser',{timeout:10000}).catch(()=>null);
      await photo.click({timeout:10000}).catch(()=>{});
      const fc=await chooser;
      if(fc)await fc.setFiles(opt.image);else await dialog.locator('input[type=file]').first().setInputFiles(opt.image);
      await sleep(5000);
    }
    log.push({step:'typed',shot:await capture(page,'post-3-typed')});
    await dialog.getByRole('button',{name:/^(Đăng|Post)$/i}).first().click({timeout:15000});
    const postedAt=new Date().toISOString();
    await sleep(8000);
    const bodyText=await page.locator('body').innerText().catch(()=>'');
    log.push({step:'posted',postedAt,pendingHint:/chờ.*(phê )?duyệt|pending|admin.*review/i.test(bodyText),shot:await capture(page,'post-4-after')});
    // look for our post in the group feed (newest first) and collect its links
    const head=body.slice(0,40);
    await page.goto(opt.group.replace(/\/?$/,'/')+'?sorting_setting=CHRONOLOGICAL',{waitUntil:'domcontentloaded'});await sleep(6000);
    const links=await page.evaluate(head=>{
      const arts=[...document.querySelectorAll('div[role=article],div[aria-posinset]')].filter(a=>a.innerText.includes(head));
      return arts.slice(0,2).map(a=>[...a.querySelectorAll('a[href]')].map(x=>x.href).filter(h=>/\/(posts|permalink)\/|story_fbid|multi_permalinks/.test(h)).slice(0,8));
    },head);
    log.push({step:'feed',matches:links,shot:await capture(page,'post-5-feed')});
    await page.goto(opt.group.replace(/\/?$/,'/')+'my_pending_content',{waitUntil:'domcontentloaded'}).catch(()=>{});await sleep(4000);
    log.push({step:'my_pending_content',url:page.url(),shot:await capture(page,'post-6-pending')});
  }catch(e){log.push({error:e.message,shot:await capture(page,'post-error')});}
  finally{out(log);await ctx.close();}
}

async function scrape(){
  const key=process.env.SCRAPECREATORS_API_KEY;if(!key)throw new Error('SCRAPECREATORS_API_KEY missing');
  const call=async(route,params)=>{
    const u=new URL(route,'https://api.scrapecreators.com');for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
    const t=Date.now(),r=await fetch(u,{headers:{'x-api-key':key,Accept:'application/json'},signal:AbortSignal.timeout(25000)});
    let j=null;try{j=await r.json();}catch{}
    writeFileSync(`${OUT}/scrape-${route.split('/').pop()}-${stamp()}.json`,JSON.stringify(j,null,2));
    return {status:r.status,ms:Date.now()-t,credits:j?.credits_charged??null,remaining:j?.credits_remaining??null,j};
  };
  const p=await call('/v1/facebook/post',{url:opt.url});
  const c=await call('/v1/facebook/post/comments',{url:opt.url,sort:'all'});
  const list=Array.isArray(c.j?.comments)?c.j.comments:[];
  out({post:{status:p.status,ms:p.ms,credits:p.credits,found:!!(p.j?.post||p.j?.id),keys:Object.keys(p.j?.post||p.j||{}).slice(0,25)},
    comments:{status:c.status,ms:c.ms,credits:c.credits,remaining:c.remaining,count:list.length,cursor:c.j?.cursor??null,
      sample:list.slice(0,3).map(x=>({keys:Object.keys(x),id:x.id,hasAuthorId:!!x.author?.id,authorKeys:Object.keys(x.author||{}),reply_count:x.reply_count,hasFeedbackId:!!x.feedback_id,hasExpansionToken:!!x.expansion_token,text:String(x.text||'').slice(0,60)}))}});
}

async function read(){
  const {ctx,page}=await open();
  try{
    await page.goto(opt.url,{waitUntil:'domcontentloaded'});await sleep(6000);
    for(let i=0;i<4;i++){await page.mouse.wheel(0,1500);await sleep(1500);}
    const items=await page.evaluate(()=>[...document.querySelectorAll('div[role=article]')].filter(a=>/^(Bình luận|Comment|Phản hồi|Reply)/i.test(a.getAttribute('aria-label')||'')).map(a=>({
      label:a.getAttribute('aria-label'),
      text:a.innerText.slice(0,160),
      authorLinks:[...a.querySelectorAll('a[href]')].map(x=>x.href).filter(h=>/facebook\.com\/(profile\.php\?id=|groups\/[^/]+\/user\/|[A-Za-z0-9.]+\?)/.test(h)).slice(0,3),
      commentLinks:[...a.querySelectorAll('a[href*="comment_id="]')].map(x=>x.href).slice(0,3)})));
    out({state:await state(ctx,page),url:page.url(),count:items.length,items:items.slice(0,10),screenshot:await capture(page,'read')});
  }finally{await ctx.close();}
}

async function reply(){
  const body=text(),{ctx,page}=await open(),log=[];
  try{
    await page.goto(opt.url,{waitUntil:'domcontentloaded'});await sleep(6000);
    const id=new URL(opt.url).searchParams.get('reply_comment_id')||new URL(opt.url).searchParams.get('comment_id');
    const art=page.locator('div[role=article]').filter({has:page.locator(`a[href*="comment_id=${id}"],a[href*="reply_comment_id=${id}"]`)}).first();
    log.push({step:'open',state:await state(ctx,page),found:await art.count(),shot:await capture(page,'reply-1-open')});
    const btn=art.getByRole('button',{name:/^(Trả lời|Phản hồi|Reply)$/i}).first();
    await btn.click({timeout:15000});await sleep(1500);
    log.push({step:'reply-box',shot:await capture(page,'reply-2-box')});
    if(!opt.confirm){log.push({step:'dry-run: opened reply box, nothing typed or sent'});return;}
    await page.keyboard.type(body,{delay:15});await sleep(800);await page.keyboard.press('Enter');await sleep(6000);
    const seen=await page.getByText(body.slice(0,30)).count();
    log.push({step:'sent',visible:seen>0,shot:await capture(page,'reply-3-sent')});
  }catch(e){log.push({error:e.message,shot:await capture(page,'reply-error')});}
  finally{out(log);await ctx.close();}
}

const cmds={login,whoami,inspect,post,scrape,read,reply};
if(!cmds[cmd]){console.error('usage: trial.mjs login|whoami|inspect --url|post --group --text-file [--image] [--confirm]|scrape --url|read --url|reply --url --text-file [--confirm]');process.exit(2);}
await cmds[cmd]().catch(e=>{console.error('trial:',e.message);process.exit(1);});
