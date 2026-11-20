import {chromium} from 'playwright-core';
// one Chrome session per process: the profile dir can only be held by one Chrome at a time
let session=null,launching=null,closing=null;
const livePage=s=>s.ctx.pages().find(p=>!p.isClosed())||s.page;
function track(ctx){
  const gone=()=>{if(session?.ctx===ctx)session=null;};
  ctx.on('close',gone);
  // macOS keeps Chrome running after its last window closes: close the context ourselves so the profile lock is released
  const watch=p=>p.on('close',()=>{if(!ctx.pages().length){gone();closing=ctx.close().catch(()=>{});}});
  ctx.on('page',watch);ctx.pages().forEach(watch);
}
export async function openSession({profileDir,headless=false,baseUrl='https://www.facebook.com'}){
  if(closing)await closing;
  if(launching)await launching;
  if(session){await livePage(session).bringToFront().catch(()=>{});return session;}
  launching=(async()=>{
    // the server's shutdown() owns SIGINT/SIGTERM/SIGHUP; Playwright's exit hook still kills Chrome
    const ctx=await chromium.launchPersistentContext(profileDir,{channel:'chrome',headless,viewport:null,locale:'vi-VN',handleSIGINT:false,handleSIGTERM:false,handleSIGHUP:false});
    try{
      const page=ctx.pages()[0]||await ctx.newPage();
      session={ctx,page};track(ctx);
      await page.goto(baseUrl,{waitUntil:'domcontentloaded'}).catch(()=>{});
      return session;
    }catch(e){session=null;await ctx.close().catch(()=>{});throw e;}
  })();
  try{return await launching;}finally{launching=null;}
}
export const sessionOpen=()=>session!==null;
export async function closeSession(){
  if(launching)await launching.catch(()=>{});
  const s=session;session=null;
  if(s)await s.ctx.close().catch(()=>{});
  if(closing)await closing;
}
