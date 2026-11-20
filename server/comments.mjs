import {nowIso,toDate} from './util.mjs';
import {getRuntime,getConfig} from './settings.mjs';
function commentId(id){
  const raw=String(id??'');
  try{const m=Buffer.from(raw,'base64').toString('utf8').match(/^comment:[^_]+_(.+)$/);if(m)return m[1];}catch{}
  return raw;
}
export function normalizeComment(raw,parentFbId=null){
  return {fb_comment_id:commentId(raw.id),parent_fb_id:parentFbId,author_id:raw.author?.id==null?null:String(raw.author.id),author_name:raw.author?.name??null,text:String(raw.text??''),
    created_at:toDate(raw.created_at),reply_count:Number(raw.reply_count)||0,feedback_id:raw.feedback_id??null,expansion_token:raw.expansion_token??null};
}
// whitespace runs (spaces, tabs, line breaks) count as one space on both sides of the comparison
const norm=t=>String(t??'').replace(/\s+/g,' ').trim();
export async function saveComments(db,targetId,list){
  const runtime=await getRuntime(db),{signatureLine}=await getConfig(db),sig=(signatureLine||'').trim();
  // the tool's own replies: anything it may have posted (approved, sending, sent, or failed with "maybe posted"), with or without the signature line
  const sent=new Set();
  for(const {final_text} of await db.all("SELECT r.final_text FROM replies r JOIN comments c ON c.id=r.comment_id WHERE c.target_id=? AND r.status IN ('approved','sending','sent','failed') AND r.final_text IS NOT NULL",[targetId])){
    sent.add(norm(final_text));if(sig)sent.add(norm(final_text+'\n'+sig));
  }
  const own=runtime.ownAuthorId,fresh=[],at=nowIso();
  for(const c of list){
    const id=targetId+':'+c.fb_comment_id;
    const isOwn=(own&&c.author_id&&c.author_id===own)||sent.has(norm(c.text))?1:0;
    const known=await db.first('SELECT 1 AS x FROM comments WHERE id=?',[id]);
    await db.run(`INSERT INTO comments(id,target_id,fb_comment_id,parent_fb_id,author_id,author_name,text,created_at,fetched_at,is_own,reply_count,feedback_id,expansion_token) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(target_id,fb_comment_id) DO UPDATE SET text=excluded.text,is_own=MAX(is_own,excluded.is_own),reply_count=excluded.reply_count,feedback_id=excluded.feedback_id,expansion_token=excluded.expansion_token`,
      [id,targetId,c.fb_comment_id,c.parent_fb_id,c.author_id,c.author_name,c.text,c.created_at,at,isOwn,c.reply_count,c.feedback_id,c.expansion_token]);
    if(!known)fresh.push(id);
  }
  return fresh;
}
