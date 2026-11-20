import {el,api,toast,guard} from './dom.js';
import {safeHref} from './format.js';

const VIS={public:'Công khai',private:'Kín',unknown:'Chưa rõ'};

export async function render(root){
  const body=el('tbody');
  const wrap=el('div',{class:'panel table-wrap'});
  async function load(){
    const groups=await api('/groups');
    wrap.replaceChildren(groups.length?el('table',{class:'table'},
      el('thead',null,el('tr',null,['Nhóm','Loại','Ghi chú luật nhóm','Cho đăng bán','Bật'].map(h=>el('th',{scope:'col'},h)))),
      el('tbody',null,groups.map(row))):el('p',{class:'empty pad'},'Chưa có nhóm nào. Dán liên kết nhóm ở trên để thêm.'));
  }
  const url=el('input',{type:'url',placeholder:'https://www.facebook.com/groups/…','aria-label':'Liên kết nhóm Facebook',required:true});
  const form=el('form',{class:'row',onsubmit:e=>{e.preventDefault();guard(form.querySelector('button'),async()=>{await api('/groups',{method:'POST',body:{url:url.value}});url.value='';toast('Đã thêm nhóm. Tên nhóm sẽ hiện sau khi tool đọc được.','ok');await load();});}},
    url,el('button',{class:'btn btn-primary',type:'submit'},'Thêm nhóm'));
  function patch(id,data){return api('/groups/'+encodeURIComponent(id),{method:'PATCH',body:data});}
  function row(g){
    const note=el('textarea',{rows:2,maxlength:2000,'aria-label':'Ghi chú luật nhóm',value:g.rules_note||'',placeholder:'Ví dụ: cấm đăng bán thứ 2 và thứ 3'});
    const save=el('button',{class:'btn btn-small',type:'button',onclick:e=>guard(e.currentTarget,async()=>{await patch(g.id,{rules_note:note.value});toast('Đã lưu ghi chú.','ok');})},'Lưu');
    const sw=(key,label)=>{const box=el('input',{type:'checkbox',role:'switch','aria-label':label,checked:!!g[key],onchange:async()=>{box.disabled=true;try{await patch(g.id,{[key]:box.checked});}catch(e){box.checked=!box.checked;toast(e.message);}finally{box.disabled=false;}}});return el('label',{class:'switch'},box,el('span',{class:'slider'}));};
    const link=safeHref(g.url);
    return el('tr',null,
      el('td',{'data-label':'Nhóm'},link?el('a',{href:link,target:'_blank',rel:'noopener'},g.name||g.url):(g.name||g.url)),
      el('td',{'data-label':'Loại'},el('span',{class:'badge '+(g.visibility==='public'?'green':g.visibility==='private'?'amber':'')},VIS[g.visibility]||g.visibility)),
      el('td',{'data-label':'Ghi chú luật nhóm',class:'note-cell'},note,save),
      el('td',{'data-label':'Cho đăng bán'},sw('allow_selling','Cho đăng bán')),
      el('td',{'data-label':'Bật'},sw('enabled','Bật nhóm')));
  }
  root.replaceChildren(
    el('div',{class:'page-header'},el('div',null,el('h1',null,'Nhóm'),el('p',null,'Chỉ nhóm bật «Cho đăng bán» mới chọn được ở trang Đăng bài.'))),
    el('section',{class:'panel pad'},el('div',{class:'field'},el('label',null,'Thêm nhóm bằng liên kết'),form)),wrap);
  await load();
}
