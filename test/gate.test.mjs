import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS} from '../server/settings.mjs';
import {CATEGORIES,ALWAYS_HUMAN,numberTokens,checkNumbers,decide} from '../server/gate.mjs';

const kb='Giá Robot X: 1.290.000đ. Pin 5000mAh. Có 4G.';
const now=new Date('2026-11-18T12:00:00Z');
const fresh=new Date(now-3600e3).toISOString();
const all={spec:true,price_known:true,no_reply:true};
const cfg=(o={})=>({...DEFAULTS,phase:2,autoSend:all,...o});
const run=(o={})=>decide({draft:{category:'spec',grounded:true,reply:'Có 4G ạ',...o.draft},comment:{created_at:fresh,author_id:'u1',...o.comment},config:cfg(o.config),knowledge:kb,now,autoRepliedToAuthorInThread:false,...o.rest});

test('hằng số loại câu',()=>{
  assert.deepEqual(CATEGORIES,['spec','price_known','price_unknown','order','support','competitor','no_reply','other']);
  assert.deepEqual(ALWAYS_HUMAN,['price_unknown','order','support','competitor','other']);
});
test('numberTokens chuẩn hoá',()=>assert.deepEqual([...numberTokens('Giá 1.290.000đ, pin 5000mAh (4G).')].sort(),['1290000đ','4g','5000mah']));
test('số có trong kiến thức thì đạt',()=>assert.equal(checkNumbers('Robot X giá 1290000đ, pin 5000mAh',kb).ok,true));
test('số lạ thì không đạt (chặn comment điều khiển AI)',()=>assert.deepEqual(checkNumbers('Giá chỉ 1k thôi ạ',kb),{ok:false,missing:['1k']}));
test('hai cách viết một giá không khớp (chủ ý)',()=>assert.equal(checkNumbers('Giá 1,29 triệu',kb).ok,false));
test('không có số thì đạt',()=>assert.equal(checkNumbers('Dạ có ạ',kb).ok,true));
test('phase 1 luôn chờ',()=>{
  const r=run({config:{phase:1}});assert.equal(r.action,'queue');assert.match(r.reason,/Giai đoạn 1/);
});
test('luôn chờ người với price_unknown/order/support/competitor/other',()=>{
  for(const category of ALWAYS_HUMAN){const r=run({draft:{category}});assert.equal(r.action,'queue',category);assert.match(r.reason,/luôn chờ người/);}
});
test('loại không rõ thì chờ',()=>assert.equal(run({draft:{category:'xyz'}}).action,'queue'));
test('phase 2 + spec + grounded + số đạt → auto_send',()=>assert.equal(run().action,'auto_send'));
test('price_known cũng tự gửi khi đủ điều kiện',()=>assert.equal(run({draft:{category:'price_known',reply:'Giá 1290000đ ạ'}}).action,'auto_send'));
test('công tắc tắt → queue',()=>{
  const r=run({config:{autoSend:{...all,spec:false}}});assert.equal(r.action,'queue');assert.match(r.reason,/Công tắc tự gửi đang tắt/);
});
test('grounded=false → queue, reason nói rõ',()=>{
  const r=run({draft:{grounded:false}});assert.equal(r.action,'queue');assert.match(r.reason,/Claude không chắc có trong bảng kiến thức/);
});
test('số lạ → queue, reason nêu số',()=>{
  const r=run({draft:{reply:'Giá chỉ 1k thôi ạ'}});assert.equal(r.action,'queue');assert.match(r.reason,/Có con số không có trong bảng kiến thức: 1k/);
});
test('comment quá 24 giờ → queue',()=>{
  const r=run({comment:{created_at:new Date(now-25*3600e3).toISOString()}});assert.equal(r.action,'queue');assert.match(r.reason,/Comment đã quá 24 giờ/);
});
test('created_at thiếu hoặc sai → queue',()=>{
  assert.equal(run({comment:{created_at:undefined}}).action,'queue');
  assert.equal(run({comment:{created_at:'không phải ngày'}}).action,'queue');
});
test('đã tự trả lời người này trong thread → queue',()=>{
  const r=run({rest:{autoRepliedToAuthorInThread:true}});assert.equal(r.action,'queue');assert.match(r.reason,/Đã tự trả lời người này trong thread/);
});
test('thiếu nhiều điều kiện thì reason nêu hết',()=>{
  const r=run({draft:{grounded:false},rest:{autoRepliedToAuthorInThread:true}});assert.match(r.reason,/không chắc/);assert.match(r.reason,/Đã tự trả lời/);
});
test('no_reply + công tắc bật → auto_skip; tắt → queue',()=>{
  assert.equal(run({draft:{category:'no_reply'}}).action,'auto_skip');
  assert.equal(run({draft:{category:'no_reply'},config:{autoSend:{...all,no_reply:false}}}).action,'queue');
});
const kb2='Pin 15 phút. Nặng 129 gram. Giá 1.290.000đ.';
test('số thập phân không khớp số nguyên khác',()=>{
  const a=checkNumbers('Giá 1,5 triệu',kb2);assert.equal(a.ok,false);assert.ok(a.missing.includes('1,5triệu'));
  assert.equal(checkNumbers('Giá 1,29 triệu',kb2).ok,false);
});
test('dấu phân nghìn vẫn được bỏ',()=>{
  assert.equal(checkNumbers('Giá 1290000đ',kb2).ok,true);
  assert.equal(checkNumbers('Giá 1.290.000đ',kb2).ok,true);
});
test('phase khác 2 thì chờ',()=>{
  for(const phase of [undefined,0,'1','2',3])assert.equal(run({config:{phase}}).action,'queue',String(phase));
});

// final fix wave
test('I3: không rõ người viết (author_id null hoặc rỗng) → queue «Không rõ người viết»',()=>{
  for(const author_id of [null,undefined,'']){const r=run({comment:{author_id}});assert.equal(r.action,'queue',String(author_id));assert.match(r.reason,/Không rõ người viết/);}
});
const kb3='Giá 1.290.000đ, bảo hành 1 năm, 12 tháng';
test('I4: số đi với đơn vị phải khớp cả cặp; chữ chỉ tiền phải có trong kiến thức; link phải có nguyên văn',()=>{
  for(const r of ['giá chỉ 1 triệu','giá một triệu','Giá 12 triệu','https://evil.example/shop'])assert.equal(checkNumbers(r,kb3).ok,false,r);
  for(const r of ['bảo hành 12 tháng','giá 1.290.000đ'])assert.deepEqual(checkNumbers(r,kb3),{ok:true,missing:[]},r);
  assert.deepEqual(checkNumbers('giá chỉ 1 triệu',kb3).missing,['1triệu']);
  assert.deepEqual(checkNumbers('Giá 12 triệu',kb3).missing,['12triệu']);
  assert.deepEqual(checkNumbers('giá một triệu',kb3).missing,['một triệu']);
  assert.deepEqual(checkNumbers('Mua tại https://evil.example/shop nhé',kb3).missing,['https://evil.example/shop']);
});
test('I4: đơn vị viết liền, cách, hoa thường; vài trăm; $ và %; domain trần, @handle',()=>{
  const kb='Giá 500k. Giảm 10%. Phí ship 2 USD. Web: shop-xinh.vn, Zalo zalo.me/0900000000, IG @shop_xinh';
  for(const r of ['giá 500k','giá 500 K','giảm 10 %','giảm 10%','ship 2 usd','xem shop-xinh.vn nhé','zalo.me/0900000000','IG @shop_xinh'])assert.equal(checkNumbers(r,kb).ok,true,r);
  for(const [r,m] of [['giá 500 nghìn','500nghìn'],['giá vài trăm thôi','vài trăm'],['giảm 10 đ','10đ'],['ship $2','2$'],['vào evil.com mua','evil.com'],['nhắn @scam_shop','@scam_shop'],['giá triệu rưỡi','giá triệu']])
    assert.ok(checkNumbers(r,kb).missing.includes(m),r+' → '+m+' ∉ '+JSON.stringify(checkNumbers(r,kb).missing));
  assert.equal(checkNumbers('Dạ shop có ạ.Bạn ơi',kb).ok,true,'chữ dính dấu chấm không phải domain');
});
test('I4: decide giữ lại câu có giá bằng chữ',()=>{
  const r=run({draft:{reply:'Robot X giá một triệu thôi ạ'}});assert.equal(r.action,'queue');assert.match(r.reason,/một triệu/);
});
test('M1: comment ở tương lai quá 5 phút → queue; mốc autoMaxAgeHours đúng 24 giờ',()=>{
  const at=ms=>({comment:{created_at:new Date(now.getTime()+ms).toISOString()}});
  assert.equal(run(at(5*60e3)).action,'auto_send','tương lai đúng 5 phút vẫn nhận');
  const f=run(at(5*60e3+1000));assert.equal(f.action,'queue');assert.match(f.reason,/tương lai/);
  assert.equal(run(at(-24*3600e3)).action,'auto_send','đúng 24 giờ');
  assert.equal(run(at(-24*3600e3-1000)).action,'queue','24 giờ + 1 giây');
});
test('R1: đơn vị gắn với cả khoảng/phân số (2-3 triệu, 1/2 triệu, 2-3 %)',()=>{
  const k='Giá 1.290.000đ, bảo hành 12 tháng, giao hàng 2-3 ngày';
  for(const r of ['Dạ giá tầm 2-3 triệu ạ','Dạ giá (2-3 triệu) ạ','Dạ 1/2 triệu ạ','Dạ giảm 2-3 % ạ'])assert.equal(checkNumbers(r,k).ok,false,r);
  assert.deepEqual(checkNumbers('Dạ giá tầm 2-3 triệu ạ',k).missing,['2-3triệu']);
  assert.deepEqual(checkNumbers('Dạ 1/2 triệu ạ',k).missing,['1/2triệu']);
  assert.deepEqual(checkNumbers('Dạ giảm 2-3 % ạ',k).missing,['2-3%']);
  assert.equal(checkNumbers('Dạ giao hàng 2-3 ngày ạ',k).ok,true);
  const r=decide({draft:{category:'spec',grounded:true,reply:'Dạ bản nâng cấp giá chỉ 2-3 triệu thôi ạ'},comment:{created_at:fresh,author_id:'u1'},config:cfg(),knowledge:k,now,autoRepliedToAuthorInThread:false});
  assert.equal(r.action,'queue');
  assert.equal(decide({draft:{category:'spec',grounded:true,reply:'Dạ giao hàng 2-3 ngày ạ'},comment:{created_at:fresh,author_id:'u1'},config:cfg(),knowledge:k,now,autoRepliedToAuthorInThread:false}).action,'auto_send');
});
