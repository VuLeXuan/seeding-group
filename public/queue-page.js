import {el,api,toast,guard} from './dom.js';
import {relTime,categoryLabel,safeHref} from './format.js';

let host=null,ctxRef=null,tab='waiting',seen=null,edits=new Map(),busy=false;

export function destroy(){host=null;seen=null;}

export async function render(root,ctx){
  host=root;ctxRef=ctx;seen=sig(ctx.state);
  await paint();
}
export function onState(state){
  if(!host)return;ctxRef.state=state;const s=sig(state);
  if(s===seen||busy)return;
  // do not rebuild the cards while a draft is being typed; the next poll retries
  if(host.contains(document.activeElement)&&document.activeElement.tagName==='TEXTAREA')return;
  seen=s;paint();
}
const sig=s=>`${s.counts.waiting}/${s.counts.failed}`;

let paintSeq=0;
async function paint(){
  const h=host;if(!h)return;seen=sig(ctxRef.state);
  const my=++paintSeq;
  let rows;
  try{rows=await api('/queue?status='+tab);}catch(e){if(my===paintSeq)toast(e.message);return;}
  if(host!==h||my!==paintSeq)return;
  const {waiting,failed}=ctxRef.state.counts;
  const tabBtn=(k,label,n)=>el('button',{class:'tab',type:'button',role:'tab','aria-selected':tab===k?'true':'false',onclick:()=>{tab=k;paint();}},label,n?el('span',{class:'count'},String(n)):null);
  h.replaceChildren(
    el('div',{class:'page-header'},el('div',null,el('h1',null,'Hàng chờ'),el('p',null,'Câu trả lời Claude đã soạn, chờ bạn xem trước khi gửi.'))),
    el('div',{class:'tabs',role:'tablist'},tabBtn('waiting','Chờ duyệt',waiting),tabBtn('failed','Lỗi',failed)),
    rows.length?el('div',{class:'stack'},rows.map(r=>tab==='waiting'?waitingCard(r):failedCard(r))):el('div',{class:'panel pad empty'},tab==='waiting'?'Không có câu nào đang chờ. Khi có comment mới, câu nháp sẽ hiện ở đây.':'Không có câu nào bị lỗi.'));
}

function head(r){
  return el('div',{class:'card-top'},
    el('div',null,el('strong',null,r.group_name||'Nhóm'),el('div',{class:'muted-note clamp'},r.post_text||'')),
    el('span',{class:'muted-note nowrap'},relTime(r.created_at)));
}
function commentBlock(r){return el('blockquote',{class:'comment'},el('b',null,(r.author_name||'Người lạ')+': '),r.comment_text);}

function waitingCard(r){
  // an empty draft (Claude gave up) is written by the owner in the same box
  const ta=el('textarea',{rows:4,'aria-label':'Câu trả lời nháp',placeholder:r.draft?null:'Claude chưa soạn được, anh tự viết câu trả lời ở đây.',value:edits.has(r.id)?edits.get(r.id):(r.final_text??r.draft??''),oninput:()=>edits.set(r.id,ta.value)});
  // one action at a time per card: a Gửi during a Soạn lại (or the reverse) is never possible
  const act=async(btn,fn)=>{busy=true;const all=[send,redraft,skip];all.forEach(b=>{b.disabled=true;});try{await guard(btn,fn);}finally{busy=false;all.forEach(b=>{b.disabled=false;});}await ctxRef.refresh();await paint();};
  const send=el('button',{class:'btn btn-primary',type:'button',onclick:e=>{if(!ta.value.trim()){toast('Câu trả lời đang trống.');return;}act(e.currentTarget,async()=>{await api(`/replies/${encodeURIComponent(r.id)}/send`,{method:'POST',body:{text:ta.value}});edits.delete(r.id);toast('Đã chuyển vào hàng gửi.','ok');});}},'Gửi');
  const redraft=el('button',{class:'btn',type:'button',onclick:e=>act(e.currentTarget,async()=>{await api(`/replies/${encodeURIComponent(r.id)}/redraft`,{method:'POST',body:{}});edits.delete(r.id);toast('Đã soạn lại.','ok');})},'Soạn lại');
  const skip=el('button',{class:'btn btn-quiet',type:'button',onclick:e=>act(e.currentTarget,async()=>{await api(`/replies/${encodeURIComponent(r.id)}/skip`,{method:'POST',body:{}});edits.delete(r.id);})},'Bỏ qua');
  const link=safeHref(r.commentUrl);
  return el('article',{class:'panel card'},head(r),commentBlock(r),
    el('div',{class:'field'},el('label',null,'Câu trả lời nháp (sửa được)'),ta),
    el('div',{class:'badges'},
      el('span',{class:'badge blue'},categoryLabel(r.category)),
      r.grounded?el('span',{class:'badge green'},'Có trong bảng kiến thức'):el('span',{class:'badge amber'},'Chưa có trong bảng kiến thức'),
      r.reason?el('span',{class:'reason'},'Lý do giữ lại: '+r.reason):null),
    el('div',{class:'actions'},send,redraft,skip,link?el('a',{class:'btn btn-quiet',href:link,target:'_blank',rel:'noopener'},'Mở trên Facebook'):null));
}

function failedCard(r){
  const link=safeHref(r.commentUrl);
  return el('article',{class:'panel card'},head(r),commentBlock(r),
    r.final_text||r.draft?el('p',{class:'sent-text'},el('b',null,'Câu định gửi: '),r.final_text||r.draft):null,
    el('p',{class:'form-error'},r.error||'Không rõ lỗi.'),
    el('div',{class:'actions'},
      link?el('a',{class:'btn',href:link,target:'_blank',rel:'noopener'},'Mở comment trên Facebook'):null,
      el('button',{class:'btn btn-quiet',type:'button',onclick:async e=>{await guard(e.currentTarget,async()=>{await api(`/replies/${encodeURIComponent(r.id)}/skip`,{method:'POST',body:{}});});await ctxRef.refresh();await paint();}},'Bỏ qua')));
}
