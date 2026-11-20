export const CATEGORIES=['spec','price_known','price_unknown','order','support','competitor','no_reply','other'];
export const ALWAYS_HUMAN=['price_unknown','order','support','competitor','other'];
const TRIM=/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
// fail closed: anything that looks like a price, a link or a handle must be in the knowledge, or the reply waits for a human
const UNIT_WORDS=new Set(['triệu','tr','nghìn','ngàn','k','tỷ','tỉ','củ','đ','đồng','vnđ','vnd','usd','$','%']);
const MONEY_WORDS=new Set(['triệu','nghìn','ngàn','tỷ','tỉ','củ','chục','trăm']);
const words=text=>String(text??'').toLowerCase().split(/\s+/).filter(Boolean);
const bare=w=>w.replace(TRIM,'')||(/^[^\p{L}\p{N}]*([$%])[^\p{L}\p{N}]*$/u.exec(w)?.[1]??'');
// "1.290.000đ," → "1290000đ"; "50%" keeps its %; "$5" → "5$"
function numberOf(raw){
  const t=raw.replace(/(\d)[.,](?=\d{3}(?!\d))/g,'$1');
  const unit=/\d([%$])[^\p{L}\p{N}]*$/u.exec(t)?.[1]||(/^[^\p{L}\p{N}]*\$\d/u.test(t)?'$':'');
  return t.replace(TRIM,'')+unit;
}
export function numberTokens(text){
  const w=words(text),out=new Set();
  for(let i=0;i<w.length;i++){
    if(!/\d/.test(w[i]))continue;
    let t=numberOf(w[i]);
    // a unit word after a number, range or fraction belongs to it: "1 triệu" = "1triệu", "2-3 triệu" = "2-3triệu", "500 K" = "500k"
    if(/\d$/.test(t)&&i+1<w.length&&UNIT_WORDS.has(bare(w[i+1])))t+=bare(w[++i]);
    if(t)out.add(t);
  }
  return out;
}
// a money word with no digit before it ("một triệu", "vài trăm") needs its two-word phrase in the knowledge
function moneyPhrases(text){
  const w=words(text),out=new Set();
  for(let i=0;i<w.length;i++){
    const m=bare(w[i]);
    if(MONEY_WORDS.has(m)&&!(i>0&&/\d/.test(w[i-1])))out.add([i>0?bare(w[i-1]):'',m].filter(Boolean).join(' '));
  }
  return out;
}
const END=/[^\p{L}\p{N}/]+$/u;
function links(text){
  const out=new Set();
  const rest=String(text??'').toLowerCase().replace(/https?:\/\/[^\s<>"']+/gu,u=>{out.add(u.replace(END,''));return ' ';});
  for(const re of [/[\p{L}\p{N}._%+-]+@[a-z0-9.-]+\.[a-z]{2,6}(?![\p{L}\p{N}])/gu,/(?<![\p{L}\p{N}.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,6}(?![\p{L}\p{N}-])(?:\/[^\s<>"']*)?/gu,/(?<![\p{L}\p{N}])@[\p{L}\p{N}_.]*[\p{L}\p{N}_]/gu])
    for(const m of rest.matchAll(re))out.add(m[0].replace(END,''));
  return out;
}
export function checkNumbers(reply,knowledge){
  const known=numberTokens(knowledge),text=` ${words(knowledge).map(bare).filter(Boolean).join(' ')} `,lower=String(knowledge??'').toLowerCase();
  const missing=new Set([...[...numberTokens(reply)].filter(t=>!known.has(t)),...[...moneyPhrases(reply)].filter(p=>!text.includes(` ${p} `)),...[...links(reply)].filter(l=>!lower.includes(l))]);
  return {ok:!missing.size,missing:[...missing]};
}
const queue=reason=>({action:'queue',reason});
export function decide({draft,comment,config,knowledge,now,autoRepliedToAuthorInThread}){
  if(config.phase!==2)return queue('Giai đoạn 1: chờ duyệt');
  const {category}=draft;
  if(!CATEGORIES.includes(category)||ALWAYS_HUMAN.includes(category))return queue('Loại câu luôn chờ người');
  if(category==='no_reply')return config.autoSend?.no_reply?{action:'auto_skip',reason:'Không cần trả lời'}:queue('Công tắc tự gửi đang tắt');
  const why=[];
  if(!config.autoSend?.[category])why.push('Công tắc tự gửi đang tắt');
  if(draft.grounded!==true)why.push('Claude không chắc có trong bảng kiến thức');
  const n=checkNumbers(draft.reply,knowledge);
  if(!n.ok)why.push(`Có con số không có trong bảng kiến thức: ${n.missing.join(', ')}`);
  const age=now-new Date(comment?.created_at);
  if(age<-5*60e3)why.push('Giờ comment ở tương lai');
  else if(!(age<=config.autoMaxAgeHours*3600e3))why.push(`Comment đã quá ${config.autoMaxAgeHours} giờ`);
  // one auto reply per author per thread: an unknown author cannot be checked, so a human decides
  if(!comment?.author_id)why.push('Không rõ người viết');
  else if(autoRepliedToAuthorInThread)why.push('Đã tự trả lời người này trong thread');
  return why.length?queue(why.join('; ')):{action:'auto_send',reason:null};
}
