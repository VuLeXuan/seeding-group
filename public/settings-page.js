import {el,api,toast,guard,confirmBox,fill} from './dom.js';

const NUMS=[
  ['Đăng bài',[['postsPerDay','Số bài mỗi ngày (giờ VN, mỗi nhóm tính 1 lần)'],['postGapMinutes','Cách nhau tối thiểu (phút)']]],
  ['Trả lời',[['repliesPerHour','Số câu trả lời mỗi giờ'],['replyGapSeconds','Cách nhau tối thiểu (giây)'],['autoMaxAgeHours','Chỉ tự gửi comment mới hơn (giờ)']]],
  ['Chi phí',[['creditCapPerDay','Credit ScrapeCreators tối đa mỗi ngày'],['claudeCallsPerHour','Lượt gọi Claude tối đa mỗi giờ']]],
  ['Đọc comment',[['browserReadsPerHour','Lượt đọc bằng Chrome mỗi giờ'],['scrapeFallbackMinutes','Chuyển sang đọc bằng Chrome sau (phút)'],['pendingCheckMinutes','Bài chờ admin duyệt: kiểm tra lại mỗi (phút)'],['pendingMaxDays','Bài chờ admin duyệt: tối đa (ngày)']]],
  ['Ảnh',[['maxImages','Số ảnh tối đa mỗi bài']]],
];
const AUTO=[['spec','Tự gửi câu hỏi thông số'],['price_known','Tự gửi câu hỏi giá đã có trong bảng'],['no_reply','Tự bỏ qua câu không cần trả lời']];
const toLines=c=>c.map(p=>p.join(', ')).join('\n');
function parseCadence(s,what){
  const out=s.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>l.split(/[,\s]+/).map(Number));
  if(!out.length||out.some(p=>p.length!==2||!p.every(Number.isInteger)))throw new Error(`${what}: mỗi dòng gồm hai số nguyên, ví dụ «60, 5».`);
  return out;
}

export async function render(root,ctx){
  const cfg=await api('/config'),inputs={};
  const num=(k,label)=>{const i=el('input',{type:'number',min:1,step:1,value:cfg[k],id:'cfg-'+k});inputs[k]=i;return el('div',{class:'field'},el('label',{for:'cfg-'+k},label),i);};
  const scrape=el('textarea',{rows:5,id:'cfg-scrape',value:toLines(cfg.scrapeCadence),class:'mono'}),browser=el('textarea',{rows:5,id:'cfg-browser',value:toLines(cfg.browserCadence),class:'mono'});
  const sig=el('input',{type:'text',id:'cfg-sig',value:cfg.signatureLine,maxlength:200,placeholder:'Ví dụ: (trả lời tự động, cần gì cứ nhắn)'});
  const phase=el('select',{id:'cfg-phase'},[[1,'Giai đoạn 1: mọi câu chờ bạn duyệt'],[2,'Giai đoạn 2: cho phép tự gửi theo các công tắc dưới']].map(([v,t])=>el('option',{value:v,selected:cfg.phase===v},t)));
  const auto={};
  const autos=AUTO.map(([k,label])=>{const b=el('input',{type:'checkbox',checked:!!cfg.autoSend[k]});auto[k]=b;return el('label',{class:'check'},b,label);});
  const credit=el('p',{class:'credit'},'Credit đã dùng hôm nay: ',el('strong',null,`${ctx.state.creditsToday} / ${cfg.creditCapPerDay}`));
  const save=el('button',{class:'btn btn-primary',type:'button',onclick:e=>guard(e.currentTarget,async()=>{
    const body={phase:Number(phase.value),signatureLine:sig.value,autoSend:Object.fromEntries(Object.entries(auto).map(([k,b])=>[k,b.checked])),
      scrapeCadence:parseCadence(scrape.value,'Lịch đọc ScrapeCreators'),browserCadence:parseCadence(browser.value,'Lịch đọc bằng Chrome')};
    for(const k of Object.keys(inputs))body[k]=Number(inputs[k].value);
    if(body.phase===2&&cfg.phase!==2&&!await confirmBox({title:'Chuyển sang giai đoạn 2?',text:'Đã quyết dòng ghi chú cuối câu chưa? Khi sang giai đoạn 2, các loại bạn bật ở trên sẽ được tự gửi.',ok:'Chuyển sang giai đoạn 2'}))return;
    const saved=await api('/config',{method:'POST',body});
    Object.assign(cfg,saved);toast('Đã lưu cài đặt.','ok');await ctx.refresh();
  })},'Lưu cài đặt');
  const log=el('ul',{class:'auto-log'});
  async function loadLog(){
    const ev=await api('/events?limit=100');
    fill(log,ev.length?ev.map(r=>el('li',null,el('time',null,new Date(r.at).toLocaleString('vi-VN')),el('span',null,el('b',null,r.kind),r.detail?' · '+r.detail:''))):el('li',{class:'muted-note'},'Chưa có sự kiện nào.'));
  }
  root.replaceChildren(
    el('div',{class:'page-header'},el('div',null,el('h1',null,'Cài đặt'),el('p',null,'Mọi giới hạn nằm ở đây. Sửa xong bấm Lưu cài đặt.'))),
    el('section',{class:'panel pad'},credit,
      el('div',{class:'form-grid'},NUMS.map(([g,fs])=>el('fieldset',null,el('legend',null,g),fs.map(([k,l])=>num(k,l)))),
        el('fieldset',null,el('legend',null,'Lịch đọc ScrapeCreators'),el('div',{class:'field'},el('label',{for:'cfg-scrape'},'Mỗi dòng: đến phút thứ, đọc mỗi bao nhiêu phút'),scrape)),
        el('fieldset',null,el('legend',null,'Lịch đọc bằng Chrome'),el('div',{class:'field'},el('label',{for:'cfg-browser'},'Mỗi dòng: đến phút thứ, đọc mỗi bao nhiêu phút'),browser))),
      el('fieldset',null,el('legend',null,'Tự động trả lời'),
        el('div',{class:'field'},el('label',{for:'cfg-phase'},'Giai đoạn'),phase),
        el('div',{class:'checks'},autos),
        el('p',{class:'muted-note'},'Câu hỏi giá chưa có, đặt hàng, hỗ trợ, đối thủ và loại khác luôn chờ bạn duyệt.'),
        el('div',{class:'field'},el('label',{for:'cfg-sig'},'Dòng ghi chú cuối câu trả lời tự gửi'),sig)),
      el('div',{class:'actions'},save)),
    el('h2',{class:'section-title'},'Nhật ký 100 dòng gần nhất'),el('section',{class:'panel'},log),
  );
  await loadLog().catch(e=>toast(e.message));
}
