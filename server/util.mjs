export const nowIso = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export function int(value,fallback,min=1,max=100000) { const n=Number(value); return Number.isInteger(n)&&n>=min&&n<=max?n:fallback; }
export function json(value,status=200,headers={}) { return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}}); }
export class AppError extends Error { constructor(code,message,status=400){super(message);this.code=code;this.status=status;} }
export function vnDay(date=new Date()) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(date); }
export function toDate(value){if(value===null||value===undefined||value==='')return null;const n=typeof value==='number'?value*(value<1e12?1000:1):value;const d=new Date(n);return Number.isFinite(d.getTime())?d.toISOString():null;}
export async function readJson(request,maxBytes=16384){const raw=await request.text();if(new TextEncoder().encode(raw).length>maxBytes)throw new AppError('BODY_TOO_LARGE','Yêu cầu quá lớn.',413);try{return JSON.parse(raw);}catch{throw new AppError('INVALID_JSON','Dữ liệu gửi lên không hợp lệ.');}}
// group links only: other Facebook links are rejected by the caller
export function facebookUrl(value){
  let u;try{u=new URL(String(value));}catch{throw new AppError('INVALID_SOURCE','Liên kết Facebook không hợp lệ.');}
  if(u.protocol!=='https:'||!/(^|\.)facebook\.com$/i.test(u.hostname)||u.username||u.password||u.port)throw new AppError('INVALID_SOURCE','Chỉ nhận liên kết HTTPS của Facebook.');
  u.hostname='www.facebook.com';u.hash='';
  const g=u.pathname.match(/^\/groups\/([^/]+)(?:\/(.*))?/);let kind;
  if(g&&(!g[2]||/^(about|discussion)\/?$/.test(g[2]))){u.pathname=`/groups/${g[1]}/`;u.search='';kind='group';}
  else if((g&&/^(posts|permalink)\/[^/]+/.test(g[2]||''))||/\/posts\/[^/]+|\/reel\/[^/]+|\/videos\/[^/]+|^\/(permalink|story)\.php/.test(u.pathname)){kind='post';for(const key of [...u.searchParams.keys()])if(!['story_fbid','id','comment_id','reply_comment_id'].includes(key))u.searchParams.delete(key);}
  else throw new AppError('INVALID_SOURCE','Nhập liên kết tới nhóm, bài viết hoặc reel cụ thể.');
  return {url:u.href,kind};
}
