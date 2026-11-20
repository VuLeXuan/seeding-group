import {el,api,toast,guard} from './dom.js';
import {titleFor,safeHref,alertLines,loginText} from './format.js';
import * as queuePage from './queue-page.js';
import * as postPage from './post-page.js';
import * as groupsPage from './groups-page.js';
import * as kbPage from './kb-page.js';
import * as settingsPage from './settings-page.js';

const PAGES={queue:{label:'Hàng chờ',mod:queuePage},post:{label:'Đăng bài',mod:postPage},groups:{label:'Nhóm',mod:groupsPage},kb:{label:'Kiến thức',mod:kbPage},settings:{label:'Cài đặt',mod:settingsPage}};
const app=document.getElementById('app');
let state=null,current=null,pageEl=null,alive=null;
const route=()=>{const h=location.hash.replace('#','');return PAGES[h]?h:'queue';};

function buildShell(){
  const nav=el('nav',{class:'nav','aria-label':'Trang'},Object.entries(PAGES).map(([k,p])=>
    el('a',{href:'#'+k,'data-page':k},p.label,k==='queue'?el('span',{class:'nav-badge',id:'nav-badge',hidden:true}):null)));
  const stop=el('button',{class:'btn btn-danger',id:'stop-btn',type:'button',onclick:e=>guard(e.currentTarget,async()=>{await api('/pause',{method:'POST',body:{paused:true}});await refresh();toast('Đã dừng mọi việc tự động.','ok');})},'Dừng tất cả');
  const login=el('button',{class:'btn',type:'button',onclick:e=>guard(e.currentTarget,async()=>{await api('/browser/login',{method:'POST',body:{}});await refresh();toast('Đã gửi yêu cầu mở Facebook.','ok');})},'Mở Facebook để đăng nhập');
  app.replaceChildren(
    el('div',{id:'banner',class:'banner',role:'alert',hidden:true}),
    el('div',{id:'notice',class:'notice',role:'status',hidden:true}),
    el('header',{class:'topbar'},
      el('div',{class:'brand'},el('span',{class:'brand-mark','aria-hidden':'true'},'F'),'FB Auto Post'),
      nav,
      el('div',{class:'top-actions'},el('span',{class:'login-state',id:'login-state'}),login,stop)),
    el('main',{id:'main',class:'main',tabindex:'-1'}));
}

function paintChrome(){
  const rt=state.runtime,n=state.counts.waiting;
  document.title=titleFor(n);
  const badge=document.getElementById('nav-badge');badge.textContent=String(n);badge.hidden=n===0;
  document.querySelectorAll('.nav a').forEach(a=>{if(a.dataset.page===current)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  const lt=loginText(rt),ls=document.getElementById('login-state');
  ls.replaceChildren(el('span',{class:'dot '+lt.dot}),lt.text);
  const stop=document.getElementById('stop-btn');stop.disabled=rt.paused;stop.title=rt.paused?'Đã dừng rồi':'';
  const banner=document.getElementById('banner');banner.hidden=!rt.paused;
  if(rt.paused){
    const shot=rt.pauseScreenshot?`/api/files/${encodeURIComponent(rt.pauseScreenshot)}`:null;
    banner.replaceChildren(el('div',{class:'banner-in'},
      el('strong',null,'Đã dừng: '),el('span',null,rt.pauseReason||'Bạn đã bấm dừng tất cả.'),
      shot?el('a',{href:shot,target:'_blank',rel:'noopener'},'Xem ảnh chụp'):null,
      el('button',{class:'btn',type:'button',onclick:e=>guard(e.currentTarget,async()=>{await api('/pause',{method:'POST',body:{paused:false}});await refresh();})},'Chạy tiếp')));
  }
  // amber notices: credit cap and Claude back-off; repainted only when the text changes
  const lines=alertLines(state),notice=document.getElementById('notice'),text=lines.join('\n');
  notice.hidden=!lines.length;
  if(notice.dataset.text!==text){notice.dataset.text=text;notice.replaceChildren(...lines.map(l=>el('div',{class:'banner-in'},l)));}
}

let reqSeq=0,appliedSeq=0;
async function refresh(){
  const my=++reqSeq;
  let fresh;
  try{fresh=await api('/state');}catch(e){
    if(my<appliedSeq)return;
    if(!alive)toast(e.message);alive=false;document.getElementById('login-state')?.replaceChildren(el('span',{class:'dot off'}),'Mất kết nối máy chủ');return;
  }
  if(my<appliedSeq)return;appliedSeq=my;state=fresh;
  alive=true;paintChrome();
  if(pageEl)current&&PAGES[current].mod.onState?.(state);
}

let renderSeq=0;
async function show(){
  const key=route(),seq=++renderSeq;
  PAGES[current]?.mod.destroy?.();
  current=key;
  const main=document.getElementById('main');
  main.replaceChildren(el('p',{class:'muted-note'},'Đang tải…'));pageEl=null;
  if(state)paintChrome();
  const box=el('div',{class:'page'});
  try{await PAGES[key].mod.render(box,{state,refresh,api,toast});}catch(e){box.replaceChildren(el('div',{class:'panel pad'},el('p',{class:'form-error'},e.message)));}
  if(seq!==renderSeq)return;
  pageEl=box;main.replaceChildren(box);
}

buildShell();
window.addEventListener('hashchange',show);
await refresh();
await show();
(async function poll(){try{await refresh();}catch(e){console.error('poll:',e);}finally{setTimeout(poll,5000);}})();
