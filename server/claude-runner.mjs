import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AppError} from './util.mjs';
export const MODELS=['claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5'],DEFAULT_MODEL='claude-opus-5-5',MIN_VERSION='2.1.280';
const ENV_KEYS=['HOME','PATH','USER','LANG','TMPDIR'],live=new Set();
let closing=false; // set by killAllRunners() at shutdown: nothing spawns after it
const fail=(code,message,extra={})=>Object.assign(new Error(message),{code,...extra});
const aborted=()=>fail('CLAUDE_ABORTED','Đã huỷ lời gọi Claude Code.');
export function analysisModel(env=process.env){const m=env.ANALYSIS_MODEL||DEFAULT_MODEL;if(!MODELS.includes(m))throw new AppError('INVALID_MODEL',`ANALYSIS_MODEL "${String(m).slice(0,60)}" không hợp lệ; chỉ nhận ${MODELS.join(', ')}. Sửa .env rồi khởi động lại.`,500);return m;}
// flags from the Task 0 spike (docs/superpowers/notes/2026-11-18-claude-cli-spike.md §2): no tools, no MCP, no settings/hooks/CLAUDE.md, no session files
export const claudeArgs=({model,guide})=>['-p','--output-format','json','--model',model,'--tools','','--strict-mcp-config','--no-session-persistence','--setting-sources','','--disable-slash-commands','--system-prompt',guide];
const killGroup=child=>{try{process.kill(-child.pid,'SIGKILL');}catch{try{child.kill('SIGKILL');}catch{}}};
// argv array (no shell), env allowlist, fresh empty cwd, own process group so a kill takes the whole tree
async function spawnCli(bin,args,{input='',timeoutMs=600000,signal}={}){
  if(signal?.aborted||closing)throw aborted();
  const cwd=await mkdtemp(join(tmpdir(),'grouplens-claude-'));
  try{
    return await new Promise((resolve,reject)=>{
      if(signal?.aborted||closing)return reject(aborted()); // aborted while the temp dir was made: never spawn
      const env=Object.fromEntries(ENV_KEYS.filter(k=>process.env[k]!=null).map(k=>[k,process.env[k]]));
      const child=spawn(bin,args,{cwd,env,detached:true,stdio:['pipe','pipe','pipe']}),out=[],err=[];let why=null,settled=false;
      const errorFor=()=>why==='timeout'?fail('CLAUDE_TIMEOUT',`Claude Code chạy quá ${Math.round(timeoutMs/1000)} giây.`):aborted();
      const settle=(fn,v)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);live.delete(child);fn(v);};
      const stop=reason=>{why??=reason;killGroup(child);setTimeout(()=>settle(reject,errorFor()),5000).unref();};
      const onAbort=()=>stop('aborted'),timer=setTimeout(()=>stop('timeout'),timeoutMs);
      child.stopNow=onAbort;live.add(child);signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort(); // a listener added to an aborted signal never fires
      child.stdout.on('data',c=>out.push(c));child.stderr.on('data',c=>err.push(c));
      child.stdin.on('error',()=>{});child.stdin.end(input);
      child.on('error',e=>settle(reject,e.code==='ENOENT'?fail('CLAUDE_MISSING',`Không tìm thấy Claude Code CLI (${bin}).`):e));
      child.on('close',code=>why?settle(reject,errorFor()):settle(resolve,{code,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8')}));
    });
  }finally{await rm(cwd,{recursive:true,force:true});}
}
export function killAllRunners(){closing=true;for(const child of [...live])child.stopNow();}
export function allowRunners(){closing=false;} // tests only: undo killAllRunners()
// The usage-limit message was never observed (spike §6): only a clearly written time counts, else null and the job waits limitCooldownHours.
export function parseResetAt(text,now=new Date()){
  const s=String(text),ok=d=>Number.isFinite(d.getTime())&&d>now&&d-now<=8*864e5?d:null;
  let m=s.match(/\|(\d{10})\b/);if(m)return ok(new Date(Number(m[1])*1000));
  m=s.match(/resets?\b[^0-9\n]{0,20}(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))/i);if(m)return ok(new Date(m[1]));
  m=s.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([A-Za-z_]+(?:\/[A-Za-z_+-]+)+)\)/i);if(!m)return null;
  let parts;try{parts=new Intl.DateTimeFormat('en-GB',{timeZone:m[4],hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now);}catch{return null;}
  const get=t=>Number(parts.find(p=>p.type===t).value),target=(Number(m[1])%12+(m[3].toLowerCase()==='pm'?12:0))*3600+Number(m[2]||0)*60;
  let diff=target-(get('hour')*3600+get('minute')*60+get('second'));if(diff<=0)diff+=86400;
  return ok(new Date(now.getTime()+diff*1000));
}
// Order (ruling T0-4): login → usage limit → anything else. subtype is "success" even on errors, so is_error and the exit code decide.
export function parseClaudeOutput(stdout,{code=0,stderr='',now=new Date()}={}){
  let j=null;try{j=JSON.parse(stdout);}catch{}
  if(j&&typeof j==='object'&&code===0&&j.is_error!==true&&typeof j.result==='string')return {text:j.result,costUsd:j.total_cost_usd??null};
  const text=String((typeof j?.result==='string'&&j.result)||stderr||stdout||'').trim(),short=text.slice(0,300)||`Claude Code thoát với mã ${code}.`;
  if(j?.api_error_status===401||/not logged in|\/login\b|log ?in again|oauth token (?:has )?expired/i.test(text))throw fail('CLAUDE_AUTH',short);
  // Heuristic, never observed: HTTP 429 is the main sign; the text match is only a fallback and a bare "resets" never counts.
  if(j?.api_error_status===429||/limit reached|usage limit/i.test(text))throw fail('CLAUDE_LIMIT',short,{resetAt:parseResetAt(text,now),httpStatus:j?.api_error_status??null});
  throw fail('CLAUDE_ERROR',short);
}
export function claudeRunner({bin='claude',model=DEFAULT_MODEL,guide}){
  const args=claudeArgs({model,guide});
  return async(input,{timeoutMs=600000,signal}={})=>{const r=await spawnCli(bin,args,{input,timeoutMs,signal});return parseClaudeOutput(r.stdout,{code:r.code,stderr:r.stderr});};
}
export function versionAtLeast(v,min=MIN_VERSION){const a=String(v).split('.').map(Number),b=min.split('.').map(Number);for(let i=0;i<3;i++)if((a[i]||0)!==(b[i]||0))return (a[i]||0)>(b[i]||0);return true;}
export async function claudeStatus(bin='claude'){
  const v=await spawnCli(bin,['--version'],{timeoutMs:20000}).catch(()=>null);
  if(!v||v.code!==0)return {installed:false,loggedIn:false,version:null,versionOk:false};
  const version=v.stdout.match(/\d+\.\d+\.\d+/)?.[0]||null,a=await spawnCli(bin,['auth','status'],{timeoutMs:20000}).catch(()=>null);
  let s=null;try{s=JSON.parse(a?.stdout||'');}catch{}
  return {installed:true,loggedIn:s?.loggedIn===true&&s.authMethod==='claude.ai',version,versionOk:!!version&&versionAtLeast(version)};
}
