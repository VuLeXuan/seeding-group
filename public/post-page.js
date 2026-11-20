import {el,api,toast,guard,uploadImage,fill,confirmBox} from './dom.js';
import {relTime,targetStatusLabel,safeHref} from './format.js';

const TYPES=['image/jpeg','image/png','image/webp'],MAX_BYTES=8*1024*1024;

export async function render(root,ctx){
  const [groups,config]=[await api('/groups'),ctx.state.config];
  const ok=groups.filter(g=>g.enabled&&g.allow_selling);
  let images=[];
  const text=el('textarea',{rows:8,placeholder:'Nội dung bài đăng…','aria-label':'Nội dung bài'});
  const brief=el('input',{type:'text',placeholder:'Ý chính của bài (ví dụ: bán xe điều khiển giá 500k, giao toàn quốc)','aria-label':'Ý chính của bài'});
  const draftBtn=el('button',{class:'btn',type:'button',onclick:e=>guard(e.currentTarget,async()=>{
    if(!brief.value.trim()){toast('Nhập ý chính của bài trước.');return;}
    e.currentTarget.textContent='Claude đang viết…';
    try{const r=await api('/posts/draft',{method:'POST',body:{brief:brief.value}});text.value=r.text;}finally{e.currentTarget.textContent='Claude viết nháp';}
  })},'Claude viết nháp');
  const thumbs=el('div',{class:'thumbs'});
  const paintThumbs=()=>fill(thumbs,images.map(n=>el('div',{class:'thumb'},el('img',{src:'/api/files/'+encodeURIComponent(n),alt:'Ảnh đã chọn'}),
    el('button',{class:'thumb-x',type:'button','aria-label':'Bỏ ảnh',onclick:()=>{images=images.filter(x=>x!==n);paintThumbs();}},'×'))));
  const file=el('input',{type:'file',accept:TYPES.join(','),multiple:true,'aria-label':'Chọn ảnh',onchange:async()=>{
    for(const f of [...file.files]){
      if(images.length>=config.maxImages){toast(`Tối đa ${config.maxImages} ảnh mỗi bài.`);break;}
      if(!TYPES.includes(f.type)){toast(`«${f.name}» không phải ảnh JPEG, PNG hoặc WebP.`);continue;}
      if(f.size>MAX_BYTES){toast(`«${f.name}» lớn hơn 8 MB.`);continue;}
      try{images.push(await uploadImage(f));paintThumbs();}catch(e){toast(e.message);}
    }
    file.value='';
  }});
  const picked=new Set();
  const groupBox=ok.length?el('div',{class:'checks'},ok.map(g=>el('label',{class:'check'},el('input',{type:'checkbox',onchange:e=>{e.target.checked?picked.add(g.id):picked.delete(g.id);}}),g.name||g.url))):
    el('p',{class:'muted-note'},'Chưa có nhóm nào cho đăng bán. Vào trang ',el('a',{href:'#groups'},'Nhóm'),' để thêm và bật.');
  const when=el('input',{type:'datetime-local','aria-label':'Giờ hẹn'});
  const list=el('div',{class:'stack'});
  const submit=el('button',{class:'btn btn-primary',type:'button',onclick:e=>guard(e.currentTarget,async()=>{
    if(!text.value.trim()){toast('Nội dung bài đang trống.');return;}
    if(!picked.size){toast('Chọn ít nhất một nhóm.');return;}
    const body={text:text.value,images,groupIds:[...picked]};
    if(when.value)body.scheduledAt=new Date(when.value).toISOString();
    await api('/posts',{method:'POST',body});
    text.value='';brief.value='';images=[];paintThumbs();when.value='';toast('Đã lên lịch đăng.','ok');
    await loadList(list);
  })},'Đăng bài');

  root.replaceChildren(
    el('div',{class:'page-header'},el('div',null,el('h1',null,'Đăng bài'),el('p',null,'Viết một bài, chọn nhóm, tool đăng lần lượt theo giới hạn mỗi ngày.'))),
    el('section',{class:'panel pad'},
      el('div',{class:'field'},el('label',null,'Nội dung bài'),text),
      el('div',{class:'field'},el('label',null,'Nhờ Claude viết nháp'),el('div',{class:'row'},brief,draftBtn)),
      el('div',{class:'field'},el('label',null,`Ảnh (tối đa ${config.maxImages}, JPEG/PNG/WebP, mỗi ảnh ≤ 8 MB)`),file,thumbs),
      el('div',{class:'field'},el('label',null,'Nhóm đăng (chỉ nhóm cho đăng bán)'),groupBox),
      el('div',{class:'field'},el('label',null,'Giờ hẹn (bỏ trống để đăng sớm nhất)'),when),
      el('div',{class:'actions'},submit)),
    el('h2',{class:'section-title'},'Bài đã tạo'),list);
  await loadList(list);
}

async function loadList(list){
  let posts;try{posts=await api('/posts');}catch(e){toast(e.message);return;}
  fill(list,posts.length?posts.map(p=>postCard(p,list)):el('div',{class:'panel pad empty'},'Chưa có bài nào.'));
}

function postCard(p,list){
  return el('article',{class:'panel card'},
    el('div',{class:'card-top'},el('span',{class:'muted-note'},relTime(p.created_at)),el('span',{class:'muted-note'},p.images.length?`${p.images.length} ảnh`:'')),
    el('p',{class:'post-text'},p.text),
    p.images.length?el('div',{class:'thumbs small'},p.images.map(n=>el('div',{class:'thumb'},el('img',{src:'/api/files/'+encodeURIComponent(n),alt:'Ảnh của bài',loading:'lazy'})))):null,
    el('ul',{class:'targets'},p.targets.map(t=>{
      const link=safeHref(t.permalink);
      return el('li',null,
        el('strong',null,t.group_name||'Nhóm'),
        el('span',{class:'badge '+(t.status==='published'?'green':['failed','declined','untrackable'].includes(t.status)?'rose':'blue')},targetStatusLabel(t.status)),
        t.status==='scheduled'?el('span',{class:'muted-note'},'dự kiến '+new Date(t.scheduled_at).toLocaleString('vi-VN')):null,
        link?el('a',{href:link,target:'_blank',rel:'noopener'},'Mở bài'):null,
        t.error?el('span',{class:'form-error inline'},t.error):null,
        t.status==='scheduled'?el('button',{class:'btn btn-small',type:'button',onclick:e=>guard(e.currentTarget,async()=>{
          if(!await confirmBox({title:'Huỷ đăng vào nhóm này?',text:`Bài sẽ không được đăng vào «${t.group_name||'nhóm'}». Các nhóm khác không đổi.`,ok:'Huỷ đăng',cancel:'Không'}))return;
          await api(`/targets/${encodeURIComponent(t.id)}/cancel`,{method:'POST',body:{}});toast('Đã huỷ.','ok');await loadList(list);})},'Huỷ'):null,
        t.status==='published'?el('button',{class:'btn btn-small',type:'button',onclick:e=>guard(e.currentTarget,async()=>{await api(`/targets/${encodeURIComponent(t.id)}/poll-now`,{method:'POST',body:{}});toast('Sẽ đọc comment ở lượt gần nhất.','ok');})},'Đọc ngay'):null);
    })));
}
