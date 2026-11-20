import {el,api,toast,guard,fill} from './dom.js';
import {relTime,categoryLabel} from './format.js';

const KINDS=[
  {kind:'knowledge',title:'Bảng kiến thức',hint:'Thông số, giá, chính sách. Claude chỉ được nêu con số có trong bảng này.'},
  {kind:'persona',title:'Giọng điệu (persona)',hint:'Cách xưng hô, độ dài, điều không được nói.'},
];

export async function render(root){
  const kb=await api('/kb');
  const panels=await Promise.all(KINDS.map(k=>kbPanel(k,kb[k.kind])));
  root.replaceChildren(
    el('div',{class:'page-header'},el('div',null,el('h1',null,'Kiến thức'),el('p',null,'Viết bằng markdown. Mỗi lần lưu tạo một phiên bản mới, bản cũ vẫn giữ.'))),
    el('div',{class:'two-col'},panels),tryPanel());
}

async function kbPanel({kind,title,hint},value){
  const ta=el('textarea',{rows:14,'aria-label':title,class:'mono',value});
  const hist=el('ul',{class:'history'});
  async function loadHist(){
    const v=await api('/kb/versions?kind='+kind+'&limit=20');
    fill(hist,v.map((r,i)=>el('li',null,
      el('span',null,`Phiên bản ${r.id}`+(i===0?' (đang dùng)':''),' · ',relTime(r.created_at)),
      i===0?null:el('button',{class:'btn btn-small btn-quiet',type:'button',onclick:()=>{ta.value=r.text;toast('Đã nạp bản cũ vào ô, bấm Lưu để dùng lại.','ok');}},'Nạp lại'))));
  }
  const save=el('button',{class:'btn btn-primary',type:'button',onclick:e=>guard(e.currentTarget,async()=>{await api('/kb',{method:'POST',body:{kind,text:ta.value}});toast('Đã lưu.','ok');await loadHist();})},'Lưu');
  await loadHist().catch(e=>toast(e.message));
  return el('section',{class:'panel pad'},el('h2',{class:'section-title'},title),el('p',{class:'muted-note'},hint),el('div',{class:'field'},ta),el('div',{class:'actions'},save),
    el('h3',{class:'mini-title'},'Lịch sử phiên bản'),hist);
}

function tryPanel(){
  const comment=el('textarea',{rows:3,'aria-label':'Comment thử',placeholder:'Một comment khách có thể viết, ví dụ: «xe này pin bao lâu vậy shop?»'});
  const post=el('textarea',{rows:2,'aria-label':'Đoạn bài gốc',placeholder:'Đoạn đầu bài đăng (không bắt buộc)'});
  const out=el('div',{class:'try-out','aria-live':'polite'});
  const go=el('button',{class:'btn btn-primary',type:'button',onclick:e=>guard(e.currentTarget,async()=>{
    if(!comment.value.trim()){toast('Nhập comment để thử.');return;}
    out.replaceChildren(el('p',{class:'muted-note'},'Claude đang soạn…'));
    try{
      const r=await api('/kb/try',{method:'POST',body:{commentText:comment.value,postText:post.value}});
      out.replaceChildren(el('blockquote',{class:'comment'},r.reply),
        el('div',{class:'badges'},el('span',{class:'badge blue'},categoryLabel(r.category)),
          r.grounded?el('span',{class:'badge green'},'Có trong bảng kiến thức'):el('span',{class:'badge amber'},'Chưa có trong bảng kiến thức'),
          r.check?.ok?el('span',{class:'badge green'},'Số liệu khớp bảng'):el('span',{class:'badge rose'},'Số không có trong bảng: '+(r.check?.missing||[]).join(', '))));
    }catch(err){out.replaceChildren();throw err;}
  })},'Thử');
  return el('section',{class:'panel pad try'},el('h2',{class:'section-title'},'Thử'),el('p',{class:'muted-note'},'Xem Claude sẽ trả lời thế nào với bảng kiến thức đã lưu. Không gửi gì lên Facebook.'),
    el('div',{class:'field'},el('label',null,'Comment thử'),comment),el('div',{class:'field'},el('label',null,'Đoạn bài gốc'),post),el('div',{class:'actions'},go),out);
}
