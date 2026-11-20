import {AppError,int,nowIso,uid,vnDay} from './util.mjs';
import {getConfig} from './settings.mjs';
import {canSpendCredit,nextPollAt} from './limits.mjs';
import {logEvent} from './db.mjs';
import {normalizeComment,saveComments} from './comments.mjs';
const POST='/v1/facebook/post',COMMENTS='/v1/facebook/post/comments',REPLIES='/v1/facebook/post/comment/replies';
const routes=new Set([POST,COMMENTS,REPLIES]);
export class ProviderError extends AppError {constructor(code,message,{status=502,retryable=false,retryAfter=0,charge=1}={}){super(code,message,status);Object.assign(this,{retryable,retryAfter,charge});}}
// Keys: SCRAPECREATORS_API_KEY, then _2, _3… in number order. A value may hold several keys separated by commas.
export function apiKeys(env={}){
  const names=Object.keys(env).map(name=>[name,name.match(/^SCRAPECREATORS_API_KEY(?:_(\d+))?$/)]).filter(([,m])=>m).sort((a,b)=>Number(a[1][1]||1)-Number(b[1][1]||1));
  const keys=[];for(const [name] of names)for(const key of String(env[name]??'').split(/[\s,;]+/))if(key&&!keys.includes(key))keys.push(key);
  return keys;
}
// Keys that just answered "out of credit" or "invalid" are skipped for a while (in this process only).
const blocked=new Map(),BLOCK_MS=10*60000;
export function resetKeyBlocks(){blocked.clear();}
export class ScrapeCreators {
  constructor(env,fetchImpl=fetch){this.env=env;this.fetchImpl=fetchImpl;}
  async get(route,params){
    const keys=apiKeys(this.env);
    if(!keys.length)throw new AppError('MISSING_API_KEY','Chưa cấu hình SCRAPECREATORS_API_KEY.',503);
    if(!routes.has(route))throw new AppError('INVALID_ROUTE','Endpoint không được hỗ trợ.');
    const url=new URL(route,this.env.SCRAPE_BASE_URL||'https://api.scrapecreators.com');for(const [k,v] of Object.entries(params))if(v!==undefined&&v!==null&&v!=='')url.searchParams.set(k,String(v));
    let outOfCredit=false;
    for(const key of keys){
      if(blocked.get(key)>Date.now()){outOfCredit=true;continue;}
      try{return await this.request(url,key);}
      catch(error){if(error.code!=='PROVIDER_CREDITS'&&error.code!=='PROVIDER_AUTH')throw error;blocked.set(key,Date.now()+BLOCK_MS);if(error.code==='PROVIDER_CREDITS')outOfCredit=true;}
    }
    const n=keys.length;
    if(outOfCredit)throw new ProviderError('PROVIDER_CREDITS',`${n>1?`Cả ${n} API key`:'API key'} ScrapeCreators đã hết credit hoặc không dùng được.`,{charge:0});
    throw new ProviderError('PROVIDER_AUTH',`${n>1?`Cả ${n} API key`:'API key'} ScrapeCreators không hợp lệ.`,{charge:0});
  }
  async request(url,key){
    let response;try{response=await this.fetchImpl(url,{headers:{'x-api-key':key,'Accept':'application/json'},signal:AbortSignal.timeout(int(this.env.SCRAPE_TIMEOUT_MS,20000,100,25000)),redirect:'error'});}catch{throw new ProviderError('PROVIDER_NETWORK','Không nhận được phản hồi từ ScrapeCreators; lượt này được tính dự phòng 1 credit.',{retryable:true});}
    let data;try{data=await response.json();}catch{throw new ProviderError('PROVIDER_JSON','ScrapeCreators trả dữ liệu không đọc được.',{retryable:response.status>=500});}
    const charge=Math.max(1,Number(data.credits_charged)||1);
    if(!response.ok||data.success===false){
      const status=response.status,credits=Number(data.credits_remaining),message=String(data.message||data.error||'').toLowerCase();
      if(status===401||status===403&&!/private|public|access/.test(message))throw new ProviderError('PROVIDER_AUTH','API key không hợp lệ hoặc không có quyền truy cập.',{charge});
      if(status===402||credits===0||/insufficient.*credit|not enough.*credit/.test(message))throw new ProviderError('PROVIDER_CREDITS','Tài khoản ScrapeCreators không còn đủ credit.',{charge});
      if(status===404||status===403)throw new ProviderError('SOURCE_UNAVAILABLE','Nguồn không tồn tại, không công khai hoặc nhà cung cấp chưa truy cập được.',{charge});
      throw new ProviderError('PROVIDER_ERROR','Nhà cung cấp chưa xử lý được yêu cầu.',{retryable:status===429||status>=500,retryAfter:Math.min(300,Number(response.headers?.get?.('retry-after'))||0),charge});
    }
    return {data,charge};
  }
}

// sort=all is relevance order, so new comments can sit on any page: a poll first asks /v1/facebook/post for comment_count (1 credit)
// and reads every comment page (up to MAX_PAGES) only when the count changed; the count is stored after a full pass or a pass stopped by the page cap (never after a credit cap or provider error, which throw)
const MAX_PAGES=20,REPLY_PAGES=5,CAP=Symbol('credit_cap'),HOUR=3600e3;
export async function scrapeTarget(db,env,targetId,{client=new ScrapeCreators(env),now=new Date()}={}){
  const target=await db.first('SELECT * FROM post_targets WHERE id=?',[targetId]);
  if(!target||target.status!=='published'||target.reader!=='scrape')return {added:0,charge:0};
  // never readable: off the schedule for good, with a reason the owner can see
  if(!target.permalink||!target.posted_at){await db.run('UPDATE post_targets SET next_poll_at=NULL,error=? WHERE id=?',['Thiếu link bài hoặc giờ đăng',targetId]);return {added:0,charge:0};}
  const nowD=new Date(now),at=nowD.toISOString(),config=await getConfig(db);
  let added=0,charge=0;
  const call=async(route,params)=>{
    if(!await canSpendCredit(db,config,nowD)){
      // one event an hour, not one per target per poll
      if(!await db.first("SELECT 1 AS x FROM events WHERE kind='credit_cap' AND at>?",[new Date(nowD.getTime()-HOUR).toISOString()]))await logEvent(db,'credit_cap',{target:targetId},at);
      throw CAP;
    }
    let spent=0;
    try{const r=await client.get(route,params);spent=r.charge;return r.data;}
    catch(e){spent=e instanceof ProviderError?e.charge:0;throw e;}
    finally{if(spent){charge+=spent;await db.run('INSERT INTO api_calls(id,day,route,cost,created_at) VALUES(?,?,?,?,?)',[uid(),vnDay(nowD),route,spent,nowIso()]);}}
  };
  const pageOf=(data,key)=>{if(!Array.isArray(data[key]))throw new ProviderError('PROVIDER_SCHEMA','Không nhận được danh sách bình luận hợp lệ.',{charge:0});return data[key];};
  const cadence=()=>nextPollAt(target.posted_at,nowD,config.scrapeCadence);
  const finish=(fields)=>db.run(`UPDATE post_targets SET ${Object.keys(fields).map(k=>k+'=?').join(',')} WHERE id=?`,[...Object.values(fields),targetId]);
  try{
    const post=await call(POST,{url:target.permalink});
    const count=Number.isInteger(post?.comment_count)&&post.comment_count>=0?post.comment_count:null; // missing → read the pages
    if(count!==null&&count===target.comment_count){await finish({last_polled_at:at,error:null,next_poll_at:cadence()});return {added,charge};}
    const stored=new Map((await db.all('SELECT fb_comment_id,reply_count FROM comments WHERE target_id=?',[targetId])).map(r=>[r.fb_comment_id,r.reply_count]));
    const cursors=new Set();let cursor,complete=false;
    for(let page=0;page<MAX_PAGES;page++){
      const data=await call(COMMENTS,{url:target.permalink,sort:'all',cursor});
      const list=pageOf(data,'comments').map(r=>normalizeComment(r));
      const grew=list.filter(c=>!stored.has(c.fb_comment_id)||c.reply_count>stored.get(c.fb_comment_id));
      const replies=[],done=new Set();
      try{
        for(const c of grew.filter(c=>c.reply_count>(stored.get(c.fb_comment_id)||0)&&c.feedback_id&&c.expansion_token)){
          const seen=new Set();let rc;
          for(let p=0;p<REPLY_PAGES;p++){
            const rd=await call(REPLIES,{feedback_id:c.feedback_id,expansion_token:c.expansion_token,cursor:rc});
            for(const r of pageOf(rd,'replies'))replies.push(normalizeComment(r,c.fb_comment_id));
            rc=rd.cursor||null;if(!rc||seen.has(rc))break;seen.add(rc);
          }
          done.add(c.fb_comment_id);
        }
      }finally{ // keep what was paid for; comments with unfetched replies keep the old count so the next poll retries them
        const top=list.map(c=>c.reply_count>(stored.get(c.fb_comment_id)||0)&&c.feedback_id&&c.expansion_token&&!done.has(c.fb_comment_id)?{...c,reply_count:stored.get(c.fb_comment_id)||0}:c);
        added+=(await saveComments(db,targetId,[...top,...replies])).length;
      }
      for(const c of list)stored.set(c.fb_comment_id,c.reply_count);
      const next=data.cursor||null;
      if(!next||cursors.has(next)){complete=true;break;}
      cursors.add(next);cursor=next;
    }
    if(!complete)await logEvent(db,'scrape_partial',{target:targetId,pages:MAX_PAGES},at);
    await finish({last_polled_at:at,error:null,next_poll_at:cadence(),...(count!==null?{comment_count:count}:{})});
  }catch(e){
    if(e===CAP)await finish({next_poll_at:cadence()});
    else if(!(e instanceof AppError))throw e;
    else if(['PROVIDER_CREDITS','PROVIDER_AUTH','MISSING_API_KEY'].includes(e.code)){
      await logEvent(db,'scrape_error',{target:targetId,code:e.code,message:e.message});
      await finish({error:e.message,next_poll_at:new Date(nowD.getTime()+30*60e3).toISOString()});
    }else{
      const age=(nowD-new Date(target.posted_at))/60e3,toBrowser=e.code==='SOURCE_UNAVAILABLE'||!e.retryable&&e.code!=='PROVIDER_NETWORK'&&e.code?.startsWith('PROVIDER_')&&age>=config.scrapeFallbackMinutes;
      if(toBrowser)await finish({reader:'browser',next_poll_at:at,error:e.message});
      else if(e.code?.startsWith('PROVIDER_')||e.code==='SOURCE_UNAVAILABLE')await finish({error:e.message,next_poll_at:cadence()});
      else throw e;
    }
  }
  return {added,charge};
}
