import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {AppError,json,readJson,uid,int,toDate,facebookUrl} from './util.mjs';
import {getConfig,saveConfig,getRuntime,setRuntime} from './settings.mjs';
import {getKb,saveKb,listKbVersions} from './kb.mjs';
import {draftReply,draftPost,tryReply} from './drafter.mjs';
import {creditsToday} from './limits.mjs';
import {saveUpload,findFile,imageType,dataDir,safeName} from './uploads.mjs';
import {commentUrl} from './links.mjs';

// long knowledge and post texts: these routes take bodies up to 256 KB, every other JSON route 16 KB (node.mjs applies the same cap)
export const BIG_BODY=256*1024,BIG_ROUTES=['/api/kb','/api/kb/try','/api/posts','/api/posts/draft'];

const bad=(code,message,status=400)=>new AppError(code,message,status);
const str=(v,max,what)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw bad('INVALID_INPUT',`${what} không được để trống và tối đa ${max} ký tự.`);return v.trim();};
const bool=(v,what)=>{if(typeof v!=='boolean')throw bad('INVALID_INPUT',`${what} phải là bật hoặc tắt.`);return v?1:0;};
const readObj=async(req,max)=>{const b=await readJson(req,max);if(!b||typeof b!=='object'||Array.isArray(b))throw bad('INVALID_JSON','Dữ liệu gửi lên không hợp lệ.');return b;};
const exists=async f=>{try{return (await stat(f)).isFile();}catch{return false;}};

async function queue(db,status){
  if(!['waiting','failed'].includes(status))throw bad('INVALID_INPUT','status chỉ nhận waiting hoặc failed.');
  const rows=await db.all(`SELECT r.*,c.text AS comment_text,c.author_name,c.fb_comment_id,c.parent_fb_id,t.permalink,g.name AS group_name,substr(p.text,1,200) AS post_text
    FROM replies r JOIN comments c ON c.id=r.comment_id JOIN post_targets t ON t.id=c.target_id JOIN fb_groups g ON g.id=t.group_id JOIN posts p ON p.id=t.post_id WHERE r.status=? ORDER BY r.created_at,r.id`,[status]);
  return rows.map(r=>({...r,commentUrl:commentUrl(r.permalink,r.fb_comment_id,r.parent_fb_id)}));
}
async function createPost(db,env,body){
  const config=await getConfig(db),text=str(body.text,20000,'Nội dung bài');
  const images=body.images??[];
  if(!Array.isArray(images)||images.some(n=>!safeName(n)))throw bad('INVALID_IMAGE','Danh sách ảnh không hợp lệ.');
  if(images.length>config.maxImages)throw bad('TOO_MANY_IMAGES',`Tối đa ${config.maxImages} ảnh mỗi bài.`);
  for(const n of images)if(!await exists(join(dataDir(env),'uploads',n)))throw bad('INVALID_IMAGE','Ảnh chưa được tải lên.');
  const ids=body.groupIds;
  if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)throw bad('INVALID_INPUT','Chọn ít nhất một nhóm, mỗi nhóm một lần.');
  for(const id of ids){const g=await db.first('SELECT enabled,allow_selling FROM fb_groups WHERE id=?',[String(id)]);if(!g||!g.enabled||!g.allow_selling)throw bad('GROUP_NOT_ALLOWED','Có nhóm chưa bật hoặc chưa cho phép đăng bán.');}
  const now=env.now(),when=toDate(body.scheduledAt),at=when&&new Date(when)>now?when:now.toISOString(),postId=uid();
  await db.batch([['INSERT INTO posts(id,text,images,created_at) VALUES(?,?,?,?)',[postId,text,JSON.stringify(images),now.toISOString()]],
    ...ids.map(g=>["INSERT INTO post_targets(id,post_id,group_id,scheduled_at,status) VALUES(?,?,?,?,'scheduled')",[uid(),postId,g,at]])]);
  return {id:postId};
}
async function listPosts(db){
  const posts=await db.all('SELECT * FROM posts ORDER BY created_at DESC,id LIMIT 100'),targets=await db.all('SELECT t.*,g.name AS group_name,g.url AS group_url FROM post_targets t JOIN fb_groups g ON g.id=t.group_id ORDER BY t.scheduled_at,t.id');
  return posts.map(p=>({...p,images:JSON.parse(p.images),targets:targets.filter(t=>t.post_id===p.id)}));
}
async function addGroup(db,body,now){
  let g;try{g=facebookUrl(body.url);}catch{throw bad('INVALID_GROUP_URL','Nhập liên kết nhóm Facebook, dạng facebook.com/groups/...');}
  if(g.kind!=='group')throw bad('INVALID_GROUP_URL','Nhập liên kết nhóm Facebook, dạng facebook.com/groups/...');
  if(await db.first('SELECT 1 AS x FROM fb_groups WHERE url=?',[g.url]))throw bad('GROUP_EXISTS','Nhóm này đã có trong danh sách.',409);
  const id=uid();await db.run("INSERT INTO fb_groups(id,url,name,visibility,allow_selling,enabled,added_at) VALUES(?,?,NULL,'unknown',0,1,?)",[id,g.url,now.toISOString()]);
  return db.first('SELECT * FROM fb_groups WHERE id=?',[id]);
}
async function patchGroup(db,id,body){
  if(!body||typeof body!=='object'||Array.isArray(body))throw bad('INVALID_INPUT','Dữ liệu không hợp lệ.');
  const set={};
  for(const [k,v] of Object.entries(body)){
    if(k==='rules_note'){if(typeof v!=='string'||v.length>2000)throw bad('INVALID_INPUT','Ghi chú luật nhóm tối đa 2000 ký tự.');set[k]=v;}
    else if(k==='allow_selling'||k==='enabled')set[k]=bool(v,k);
    else throw bad('INVALID_INPUT',`Không sửa được «${k}».`);
  }
  const keys=Object.keys(set);if(!keys.length)throw bad('INVALID_INPUT','Không có gì để sửa.');
  if(!await db.run(`UPDATE fb_groups SET ${keys.map(k=>k+'=?').join(',')} WHERE id=?`,[...keys.map(k=>set[k]),id]))throw bad('NOT_FOUND','Không tìm thấy nhóm.',404);
  return db.first('SELECT * FROM fb_groups WHERE id=?',[id]);
}
async function reply(db,id,action,body,deps){
  const r=await db.first('SELECT * FROM replies WHERE id=?',[id]);
  if(!r)throw bad('NOT_FOUND','Không tìm thấy câu trả lời.',404);
  if(['sending','sent'].includes(r.status))throw bad('REPLY_LOCKED','Câu trả lời đã gửi hoặc đang gửi.',409);
  if(action==='redraft')return draftReply(db,r.comment_id,{makeRunner:deps.makeRunner,now:deps.now(),env:deps.env,forceQueue:true});
  if(action==='skip')await db.run("UPDATE replies SET status='skipped',mode='manual' WHERE id=?",[id]);
  else{const text=body.text===undefined?(r.draft??''):str(body.text,2000,'Câu trả lời');if(!text.trim())throw bad('INVALID_INPUT','Câu trả lời trống.');
    await db.run("UPDATE replies SET status='approved',mode='manual',final_text=?,error=NULL WHERE id=?",[text.trim(),id]);}
  return db.first('SELECT * FROM replies WHERE id=?',[id]);
}
async function state(db,now){
  const n=async sql=>(await db.first(sql)).n;
  const config=await getConfig(db),runtime=await getRuntime(db),credits=await creditsToday(db,now);
  // amber notices, never a pause: reading stopped by the credit cap, drafting held back by the worker's Claude back-off
  const until=runtime.draftBlockedUntil&&new Date(runtime.draftBlockedUntil)>now?runtime.draftBlockedUntil:null;
  return {config,runtime,creditsToday:credits,alerts:{creditCap:credits>=config.creditCapPerDay,drafting:until?{until,code:runtime.draftBlockedCode??null}:null},counts:{
    waiting:await n("SELECT COUNT(*) AS n FROM replies WHERE status='waiting'"),failed:await n("SELECT COUNT(*) AS n FROM replies WHERE status='failed'"),pendingApproval:await n("SELECT COUNT(*) AS n FROM post_targets WHERE status='pending_approval'")}};
}

export async function handleApi(request,env,deps={}){
  const db=env.DB,d={makeRunner:deps.makeRunner,now:deps.now||(()=>new Date())},url=new URL(request.url),path=url.pathname,m=request.method;
  const run={makeRunner:d.makeRunner,now:d.now(),env};
  const E={...env,now:d.now};
  const route=(method,re)=>m===method&&path.match(re);
  const big=m==='POST'&&BIG_ROUTES.includes(path)?BIG_BODY:undefined;
  try{
    const origin=request.headers.get('origin');
    if(origin!==null){let o;try{o=new URL(origin).host;}catch{o=null;}if(o!==request.headers.get('host')&&o!==url.host)throw bad('BAD_ORIGIN','Yêu cầu từ trang web khác bị từ chối.',403);}
    if(m!=='GET'&&m!=='HEAD'&&path!=='/api/uploads'&&(request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()!=='application/json')throw bad('UNSUPPORTED_MEDIA_TYPE','Chỉ nhận dữ liệu JSON.',415);
    let x;
    if(route('GET',/^\/api\/state$/))return json(await state(db,d.now()));
    if(route('GET',/^\/api\/config$/))return json(await getConfig(db));
    if(route('POST',/^\/api\/config$/))return json(await saveConfig(db,await readObj(request)));
    if(route('GET',/^\/api\/kb$/))return json(await getKb(db));
    if(route('POST',/^\/api\/kb$/)){const b=await readObj(request,big);return json({versionId:await saveKb(db,b.kind,b.text)});}
    if(route('GET',/^\/api\/kb\/versions$/))return json(await listKbVersions(db,url.searchParams.get('kind'),int(url.searchParams.get('limit'),20,1,100)));
    if(route('POST',/^\/api\/kb\/try$/)){const b=await readObj(request,big);return json(await tryReply(db,{commentText:str(b.commentText,2000,'Comment'),postText:typeof b.postText==='string'?b.postText:''},run));}
    if(route('GET',/^\/api\/groups$/))return json(await db.all('SELECT * FROM fb_groups ORDER BY added_at,id'));
    if(route('POST',/^\/api\/groups$/))return json(await addGroup(db,await readObj(request),d.now()),201);
    if(x=route('PATCH',/^\/api\/groups\/([^/]+)$/))return json(await patchGroup(db,x[1],await readObj(request)));
    if(route('POST',/^\/api\/uploads$/))return json(await saveUpload(env,request),201);
    if(x=route('GET',/^\/api\/files\/([^/]+)$/)){
      const file=await findFile(env,decodeURIComponent(x[1]));if(!file)throw bad('NOT_FOUND','Không tìm thấy file.',404);
      return new Response(await readFile(file),{headers:{'Content-Type':imageType(file),'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});
    }
    if(route('POST',/^\/api\/posts$/))return json(await createPost(db,E,await readObj(request,big)),201);
    if(route('POST',/^\/api\/posts\/draft$/)){const b=await readObj(request,big);return json({text:await draftPost(db,str(b.brief,4000,'Ý chính của bài'),run)});}
    if(route('GET',/^\/api\/posts$/))return json(await listPosts(db));
    if(route('GET',/^\/api\/queue$/))return json(await queue(db,url.searchParams.get('status')||'waiting'));
    if(x=route('POST',/^\/api\/replies\/([^/]+)\/(send|skip|redraft)$/))return json(await reply(db,x[1],x[2]==='send'?'send':x[2],x[2]==='send'?await readObj(request):{},{...d,env}));
    if(x=route('POST',/^\/api\/targets\/([^/]+)\/poll-now$/)){
      if(!await db.run("UPDATE post_targets SET next_poll_at=? WHERE id=? AND status='published'",[d.now().toISOString(),x[1]]))throw bad('NOT_FOUND','Không có bài đã đăng này.',404);
      return json({ok:true});
    }
    if(x=route('POST',/^\/api\/targets\/([^/]+)\/cancel$/)){
      if(await db.run("UPDATE post_targets SET status='failed',error='Đã huỷ' WHERE id=? AND status='scheduled'",[x[1]]))return json({ok:true});
      if(!await db.first('SELECT 1 AS x FROM post_targets WHERE id=?',[x[1]]))throw bad('NOT_FOUND','Không tìm thấy bài này.',404);
      throw bad('TARGET_NOT_SCHEDULED','Chỉ huỷ được bài đang chờ đăng.',409);
    }
    if(route('POST',/^\/api\/pause$/)){const b=await readObj(request);if(typeof b.paused!=='boolean')throw bad('INVALID_INPUT','paused phải là true hoặc false.');
      return json(await setRuntime(db,b.paused?{paused:true}:{paused:false,pauseReason:null,pauseScreenshot:null}));}
    if(route('POST',/^\/api\/browser\/login$/))return json(await setRuntime(db,{loginRequested:true}));
    if(route('GET',/^\/api\/events$/))return json(await db.all('SELECT * FROM events ORDER BY id DESC LIMIT ?',[int(url.searchParams.get('limit'),100,1,500)]));
    throw bad('NOT_FOUND','Không tìm thấy đường dẫn.',404);
  }catch(e){
    if(e instanceof AppError)return json({error:{code:e.code,message:e.message}},e.status);
    console.error('API:',m,path,e);
    return json({error:{code:'INTERNAL',message:'Lỗi máy chủ.'}},500);
  }
}
