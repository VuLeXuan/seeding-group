import {logEvent} from './db.mjs';
import {draftReply} from './drafter.mjs';
import {scrapeTarget,ScrapeCreators} from './scrape.mjs';
import {getRuntime,setRuntime} from './settings.mjs';
import {uid} from './util.mjs';
const MIN=60e3,GIVE_UP=3;
// state lives in a state object so tests can run ticks against fresh back-offs; shown:true clears a back-off left by an earlier process
export const newState=()=>({comments:new Map(),globalUntil:0,shown:true});
const off=(state,now)=>state.globalUntil>now.getTime();
export async function scrapeTick(db,env,deps={},state=newState()){
  const now=(deps.now||(()=>new Date()))();
  // a target with no link or post time can never be read: it must not hold the head of the line
  const t=await db.first("SELECT id FROM post_targets WHERE status='published' AND reader='scrape' AND permalink IS NOT NULL AND posted_at IS NOT NULL AND next_poll_at IS NOT NULL AND next_poll_at<=? ORDER BY next_poll_at LIMIT 1",[now.toISOString()]);
  if(!t)return null;
  try{await scrapeTarget(db,env,t.id,{client:deps.scrapeClient||new ScrapeCreators(env),now});}
  catch(e){await logEvent(db,'scrape_error',{target:t.id,code:e.code||e.name,message:e.message});
    await db.run('UPDATE post_targets SET next_poll_at=? WHERE id=?',[new Date(now.getTime()+10*MIN).toISOString(),t.id]);}
  return t.id;
}
// the global back-off is also written to runtime so the page can say why nothing is being drafted
async function holdDrafting(db,state,until,code){state.globalUntil=until;state.shown=true;await setRuntime(db,{draftBlockedUntil:new Date(until).toISOString(),draftBlockedCode:code});}
export async function draftTick(db,env,deps={},state=newState()){
  const now=(deps.now||(()=>new Date()))();
  if(off(state,now))return null;
  if(state.shown){state.shown=false;if((await getRuntime(db)).draftBlockedUntil)await setRuntime(db,{draftBlockedUntil:null,draftBlockedCode:null});}
  const rows=await db.all('SELECT c.id FROM comments c WHERE c.is_own=0 AND NOT EXISTS(SELECT 1 FROM replies r WHERE r.comment_id=c.id) ORDER BY c.fetched_at,c.id');
  const c=rows.find(r=>(state.comments.get(r.id)||0)<=now.getTime());
  if(!c)return null;
  try{await draftReply(db,c.id,{makeRunner:deps.makeRunner,now,env});}
  catch(e){
    const code=e.code||e.name;
    await logEvent(db,'draft_error',{comment:c.id,code,message:e.message});
    if(e.code==='CLAUDE_AUTH'||e.code==='CLAUDE_MISSING')await holdDrafting(db,state,now.getTime()+10*MIN,code);
    else if(e.code==='CLAUDE_LIMIT'){const r=e.resetAt?new Date(e.resetAt).getTime():NaN;await holdDrafting(db,state,Number.isFinite(r)&&r>now.getTime()?r:now.getTime()+30*MIN,code);}
    else if(e.code==='CLAUDE_HOURLY_LIMIT')await holdDrafting(db,state,now.getTime()+5*MIN,code);
    else{
      state.comments.set(c.id,now.getTime()+10*MIN);
      // failed calls leave drafts rows with no text (they survive a restart): after 3, the owner writes this one
      const {n}=await db.first('SELECT COUNT(*) AS n FROM drafts WHERE comment_id=? AND text IS NULL',[c.id]);
      if(n>=GIVE_UP)await db.run("INSERT INTO replies(id,comment_id,draft,status,reason,created_at) VALUES(?,?,'','waiting',?,?) ON CONFLICT(comment_id) DO NOTHING",[uid(),c.id,`Claude không soạn được (${code}), anh tự viết`,now.toISOString()]);
    }
  }
  return c.id;
}
// extraTicks: [{every:ms, run:async()=>void}] is the hook for Task 9 (browserTick)
export function startLoops(env,deps={},{extraTicks=[]}={}){
  const state=newState(),timers=[],busy=new Set();
  const loop=(name,every,fn)=>{timers.push(setInterval(async()=>{if(busy.has(name))return;busy.add(name);try{await fn();}catch(e){console.error('Worker',name,e.code||e.name);}finally{busy.delete(name);}},every).unref());};
  loop('scrape',30000,()=>scrapeTick(env.DB,env,deps,state));
  loop('draft',10000,()=>draftTick(env.DB,env,deps,state));
  extraTicks.forEach((t,i)=>loop('extra'+i,t.every,t.run));
  return ()=>timers.forEach(clearInterval);
}
