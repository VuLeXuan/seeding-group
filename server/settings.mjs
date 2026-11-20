import {AppError} from './util.mjs';
export const DEFAULTS=Object.freeze({
  postsPerDay:5,postGapMinutes:30,repliesPerHour:20,replyGapSeconds:60,creditCapPerDay:500,claudeCallsPerHour:60,
  scrapeCadence:[[60,5],[360,15],[1440,60],[4320,240]],browserCadence:[[60,10],[360,30],[1440,120],[4320,360]],browserReadsPerHour:20,
  pendingCheckMinutes:30,pendingMaxDays:3,scrapeFallbackMinutes:30,maxImages:10,autoMaxAgeHours:24,signatureLine:'',phase:1,
  autoSend:{spec:false,price_known:false,no_reply:false},
});
const RUNTIME_DEFAULTS={paused:false,pauseReason:null,pauseScreenshot:null,ownAuthorId:null,loginState:'unknown',loginRequested:false,loginCheckedAt:null,loginWindowOpen:false,loginError:null};
const AUTO_KEYS=['spec','price_known','no_reply'];
const bad=(key,why)=>new AppError('INVALID_SETTING',`Cài đặt «${key}» không hợp lệ: ${why}.`);
const posInt=v=>Number.isInteger(v)&&v>0;
function check(key,value){
  if(key==='signatureLine'){if(typeof value!=='string')throw bad(key,'phải là chữ');return value;}
  if(key==='phase'){if(value!==1&&value!==2)throw bad(key,'chỉ nhận 1 hoặc 2');return value;}
  if(key==='autoSend'){
    if(!value||typeof value!=='object'||Array.isArray(value))throw bad(key,'phải là một bảng bật/tắt');
    const out={};for(const [k,v] of Object.entries(value)){if(!AUTO_KEYS.includes(k))throw bad(key,`không có loại «${k}»`);if(typeof v!=='boolean')throw bad(key,`«${k}» phải là bật hoặc tắt`);out[k]=v;}
    return out;
  }
  if(key==='scrapeCadence'||key==='browserCadence'){
    if(!Array.isArray(value)||!value.length)throw bad(key,'phải là danh sách không rỗng');
    let prev=0;for(const p of value){if(!Array.isArray(p)||p.length!==2||!posInt(p[0])||!posInt(p[1]))throw bad(key,'mỗi cặp là hai số nguyên dương');if(p[0]<=prev)throw bad(key,'mốc phút phải tăng dần');prev=p[0];}
    return value.map(p=>[p[0],p[1]]);
  }
  if(!posInt(value))throw bad(key,'phải là số nguyên dương');
  return value;
}
export async function getConfig(db){const saved=await db.setting('config',{});return {...structuredClone(DEFAULTS),...saved,autoSend:{...DEFAULTS.autoSend,...(saved.autoSend||{})}};}
export async function saveConfig(db,patch){
  if(!patch||typeof patch!=='object'||Array.isArray(patch))throw bad('config','phải là một bảng giá trị');
  const clean={};for(const [k,v] of Object.entries(patch)){if(!(k in DEFAULTS))throw bad(k,'không có cài đặt này');clean[k]=check(k,v);}
  const saved=await db.setting('config',{});
  const merged={...saved,...clean};
  if(clean.autoSend)merged.autoSend={...DEFAULTS.autoSend,...(saved.autoSend||{}),...clean.autoSend};
  await db.setSetting('config',merged);
  return getConfig(db);
}
export async function getRuntime(db){return {...RUNTIME_DEFAULTS,...await db.setting('runtime',{})};}
export async function setRuntime(db,patch){const next={...await getRuntime(db),...patch};await db.setSetting('runtime',next);return next;}
