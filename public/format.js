// Pure helpers: no DOM access, so node can import this file in tests.
export function titleFor(waiting){return waiting>0?`(${waiting}) FB Auto Post`:'FB Auto Post';}

export function relTime(iso,now=new Date()){
  if(!iso)return '';
  const t=new Date(iso).getTime();
  if(!Number.isFinite(t))return '';
  const s=Math.floor((now.getTime()-t)/1000);
  if(s<45)return 'vừa xong';
  const m=Math.floor(s/60);
  if(m<60)return `${Math.max(m,1)} phút trước`;
  const h=Math.floor(m/60);
  if(h<24)return `${h} giờ trước`;
  return `${Math.floor(h/24)} ngày trước`;
}

export const CATEGORY_LABELS={spec:'Thông số',price_known:'Giá đã có',price_unknown:'Hỏi giá (chưa có)',order:'Đặt hàng',support:'Hỗ trợ',competitor:'Đối thủ',no_reply:'Không cần trả lời',other:'Khác'};
export const categoryLabel=c=>CATEGORY_LABELS[c]||c||'Chưa phân loại';

export const TARGET_STATUS_LABELS={scheduled:'Đã hẹn giờ',posting:'Đang đăng',pending_approval:'Chờ admin duyệt',published:'Đã đăng',declined:'Bị từ chối',failed:'Lỗi',untrackable:'Không theo dõi được nữa'};
export const targetStatusLabel=s=>TARGET_STATUS_LABELS[s]||s;

// Only absolute https links are put into href; anything else stays plain text.
export const safeHref=u=>typeof u==='string'&&/^https:\/\//i.test(u)?u:null;

// Amber notices under the red banner (I7): they explain a stop, they never pause anything. Times are Vietnam time.
const DRAFT_STOP={CLAUDE_AUTH:'Claude chưa đăng nhập',CLAUDE_MISSING:'không tìm thấy Claude Code',CLAUDE_LIMIT:'Claude hết lượt dùng',CLAUDE_HOURLY_LIMIT:'đã gọi Claude đủ số lần trong 1 giờ'};
const hhmm=iso=>new Intl.DateTimeFormat('vi-VN',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Ho_Chi_Minh'}).format(new Date(iso));
export function alertLines(state){
  const a=state?.alerts||{},out=[];
  if(a.creditCap)out.push(`Đã dùng hết ${state.config?.creditCapPerDay??state.creditsToday} credit hôm nay, ngừng đọc comment tới 0 giờ.`);
  if(a.drafting?.until)out.push(`Claude tạm ngừng soạn tới ${hhmm(a.drafting.until)} (${DRAFT_STOP[a.drafting.code]||a.drafting.code||'không rõ lý do'}).`);
  return out;
}

// Top-bar Facebook login line. It only claims what the tool has seen: a window is "open" only when the worker says so.
export function loginText(rt){
  if(rt.loginRequested&&!rt.loginWindowOpen)return {dot:'wait',text:'Facebook: đã gửi yêu cầu mở cửa sổ…'};
  if(rt.loginState==='logged_in')return {dot:'ok',text:`Facebook: đã đăng nhập${rt.loginCheckedAt?` (kiểm lúc ${hhmm(rt.loginCheckedAt)})`:''}`};
  if(rt.loginState==='checkpoint')return {dot:'off',text:'Facebook bắt xác minh'+(rt.loginWindowOpen?' — nhập trong cửa sổ Chrome':'')};
  if(rt.loginWindowOpen&&['logged_out','unknown'].includes(rt.loginState))return {dot:'wait',text:'Facebook: đăng nhập trong cửa sổ Chrome…'};
  if(['logged_out','login_required'].includes(rt.loginState))return {dot:'off',text:'Facebook: chưa đăng nhập'};
  if(rt.loginState==='error')return {dot:'off',text:'Facebook: '+(rt.loginError||'lỗi')};
  return {dot:'wait',text:'Facebook: chưa rõ trạng thái đăng nhập'};
}
