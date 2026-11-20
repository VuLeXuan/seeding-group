// Tiny DOM + fetch helpers shared by the pages. User text only ever goes in through textContent.
export function el(tag,props,...kids){
  const n=document.createElement(tag);
  for(const [k,v] of Object.entries(props||{})){
    if(v===null||v===undefined||v===false)continue;
    if(k==='class')n.className=v;
    else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);
    else if(k==='value'||k==='checked'||k==='disabled'||k==='hidden'||k==='selected')n[k]=v;
    else n.setAttribute(k,v===true?'':String(v));
  }
  const add=k=>{if(Array.isArray(k))k.forEach(add);else if(k!==null&&k!==undefined&&k!==false)n.append(k instanceof Node?k:document.createTextNode(String(k)));};
  kids.forEach(add);
  return n;
}

export async function api(path,{method='GET',body}={}){
  const init={method,headers:{}};
  if(method!=='GET'){init.headers['Content-Type']='application/json';init.body=JSON.stringify(body??{});}
  let res;
  try{res=await fetch('/api'+path,init);}catch{throw new Error('Không kết nối được máy chủ.');}
  const data=await res.json().catch(()=>null);
  if(!res.ok)throw new Error(data?.error?.message||'Có lỗi xảy ra, thử lại sau.');
  return data;
}

export async function uploadImage(file){
  let res;
  try{res=await fetch('/api/uploads',{method:'POST',headers:{'Content-Type':file.type},body:file});}catch{throw new Error('Không kết nối được máy chủ.');}
  const data=await res.json().catch(()=>null);
  if(!res.ok)throw new Error(data?.error?.message||'Không tải ảnh lên được.');
  return data.name;
}

let toastTimer;
export function toast(message,kind='error'){
  const t=document.getElementById('toast');if(!t)return;
  t.textContent=message;t.className='show '+kind;
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{t.className='';},kind==='error'?6000:3000);
}

export function confirmBox({title,text,ok='Xác nhận',cancel='Huỷ'}){
  return new Promise(resolve=>{
    const root=document.getElementById('modal-root');
    const done=v=>{root.replaceChildren();document.removeEventListener('keydown',onKey);resolve(v);};
    const onKey=e=>{if(e.key==='Escape')done(false);};
    const okBtn=el('button',{class:'btn btn-primary',type:'button',onclick:()=>done(true)},ok);
    root.replaceChildren(el('div',{class:'overlay',onclick:e=>{if(e.target===e.currentTarget)done(false);}},
      el('div',{class:'modal',role:'dialog','aria-modal':'true','aria-label':title},
        el('div',{class:'modal-header'},el('h2',null,title)),
        el('div',{class:'modal-body'},el('p',null,text)),
        el('div',{class:'modal-footer'},el('button',{class:'btn',type:'button',onclick:()=>done(false)},cancel),okBtn))));
    document.addEventListener('keydown',onKey);okBtn.focus();
  });
}

// Disables a button while an async action runs, shows errors in a toast.
export async function guard(btn,fn){
  btn.disabled=true;
  try{return await fn();}catch(e){toast(e.message);}finally{btn.disabled=false;}
}

// replaceChildren with arrays: replaceChildren(array) would insert the array as text.
export const fill=(node,...kids)=>node.replaceChildren(...kids.flat());
