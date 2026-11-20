import {logEvent} from './db.mjs';
import {getRuntime,setRuntime} from './settings.mjs';
import * as browser from './fb/browser.mjs';
import * as actions from './fb/actions.mjs';
const MIN=60e3;
const LOCK=/ProcessSingleton|SingletonLock|profile.*(in use|already)|existing browser session/i;
const LOCK_MESSAGE='Profile Chrome của tool đang bị chương trình khác dùng. Đóng cửa sổ đó rồi bấm lại.';
// Login job: opens the tool's own Chrome profile on Facebook and reports the login state until the owner closes the window (or 10 min pass without a login).
// The tick holds the worker's busy guard for the whole job, so a second click is handled inside the loop and never starts a second Chrome.
export async function browserTick(db,env,deps={}){
  const start=await getRuntime(db);
  if(!start.loginRequested)return;
  const d={openSession:browser.openSession,sessionOpen:browser.sessionOpen,closeSession:browser.closeSession,loginState:actions.loginState,ownProfileId:actions.ownProfileId,
    now:()=>new Date(),sleep:ms=>new Promise(r=>setTimeout(r,ms)),pollMs:2000,maxWaitMs:10*MIN,baseUrl:'https://www.facebook.com',headless:false,...deps};
  const profileDir=deps.profileDir||env?.FB_PROFILE_DIR||'.data/chrome-profile';
  const open=()=>d.openSession({profileDir,headless:d.headless,baseUrl:d.baseUrl});
  // a leftover 'error' must not show while the fresh Chrome starts
  await setRuntime(db,{loginRequested:false,loginError:null,...(start.loginState==='error'?{loginState:'unknown'}:{})});
  const fail=async e=>{
    await setRuntime(db,{loginState:'error',loginError:LOCK.test(e.message)?LOCK_MESSAGE:`Không mở được Chrome: ${String(e.message).split('\n')[0]}`,loginWindowOpen:false});
    await logEvent(db,'fb_error',{code:e.code||e.name,message:e.message});
  };
  let session;
  try{session=await open();}catch(e){await fail(e);return;}
  try{
    await setRuntime(db,{loginWindowOpen:true});
    let last=null,greens=0,notGreenSince=d.now().getTime();
    while(d.sessionOpen()){
      const page=session.ctx.pages?.().find(p=>!p.isClosed())||session.page;
      const s=await d.loginState(session.ctx,page,d.baseUrl),at=d.now();
      if(!d.sessionOpen())break; // the owner closed the window during the check: its answer is meaningless
      greens=s==='logged_in'?greens+1:0;
      // green needs two checks in a row: c_user exists before an email-code or 2FA step is finished
      let shown=s==='logged_in'&&greens<2?null:s;
      if(shown==='unknown'&&last==='logged_in')shown=null; // one unreadable check never knocks down a confirmed green
      if(shown&&shown!==last){
        last=shown;
        await setRuntime(db,{loginState:shown,loginCheckedAt:at.toISOString()});
        await logEvent(db,'fb_login',{state:shown});
        if(shown==='logged_in'){
          const own=await d.ownProfileId(session.ctx,d.baseUrl);
          if(own)await setRuntime(db,{ownAuthorId:own});
        }
      }
      if(s==='logged_in'&&greens>=2)notGreenSince=null;
      else if(notGreenSince===null)notGreenSince=at.getTime();
      if((await getRuntime(db)).loginRequested){await setRuntime(db,{loginRequested:false});session=await open();}
      if(notGreenSince!==null&&at.getTime()-notGreenSince>=d.maxWaitMs){
        // after a timeout the bar may only say «bắt xác minh» or «chưa đăng nhập»
        await setRuntime(db,{loginCheckedAt:at.toISOString(),...(last===null||last==='unknown'?{loginState:'logged_out'}:{})});
        await d.closeSession();break;
      }
      await d.sleep(d.pollMs);
    }
  }catch(e){await fail(e);}
  finally{await setRuntime(db,{loginWindowOpen:false});}
}
