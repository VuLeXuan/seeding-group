import {vnDay} from './util.mjs';
const MIN=60e3,HOUR=3600e3;
const d=v=>new Date(v);
const iso=ms=>new Date(ms).toISOString();

export function nextPollAt(postedAt,now,cadence){
  const age=(d(now)-d(postedAt))/MIN;
  const band=cadence.find(([upTo])=>age<upTo);
  return band?iso(d(now).getTime()+band[1]*MIN):null;
}

function nextVnMidnight(now){
  const [y,m,day]=vnDay(d(now)).split('-').map(Number);
  return iso(Date.UTC(y,m-1,day+1)-7*HOUR);
}

export async function canPost(db,config,now){
  const t=d(now).getTime(),today=vnDay(d(now));
  const rows=await db.all("SELECT posted_at FROM post_targets WHERE status IN ('published','pending_approval','declined') AND posted_at>=?",[iso(t-48*HOUR)]);
  const all=rows.map(r=>d(r.posted_at).getTime()),times=all.filter(ms=>vnDay(d(ms))===today);
  if(times.length>=config.postsPerDay)return {ok:false,reason:`Đã đăng đủ ${config.postsPerDay} bài hôm nay`,waitUntil:nextVnMidnight(now)};
  const last=Math.max(0,...all);
  const gapEnd=last+config.postGapMinutes*MIN;
  if(last&&t<gapEnd)return {ok:false,reason:`Chưa đủ ${config.postGapMinutes} phút từ bài trước`,waitUntil:iso(gapEnd)};
  return {ok:true};
}

export async function canReply(db,config,now){
  const t=d(now).getTime();
  const rows=await db.all('SELECT sent_at FROM replies WHERE sent_at>? ORDER BY sent_at',[iso(t-HOUR)]);
  const times=rows.map(r=>d(r.sent_at).getTime()).filter(ms=>ms<=t);
  if(times.length>=config.repliesPerHour)return {ok:false,reason:`Đã gửi đủ ${config.repliesPerHour} câu trong 1 giờ`,waitUntil:iso(Math.min(...times)+HOUR)};
  const gapEnd=Math.max(0,...times)+config.replyGapSeconds*1000;
  if(times.length&&t<gapEnd)return {ok:false,reason:`Chưa đủ ${config.replyGapSeconds} giây từ câu trước`,waitUntil:iso(gapEnd)};
  return {ok:true};
}

export async function creditsToday(db,now){
  const r=await db.first('SELECT COALESCE(SUM(cost),0) AS total FROM api_calls WHERE day=?',[vnDay(d(now))]);
  return r.total;
}
export async function canSpendCredit(db,config,now){return await creditsToday(db,now)<config.creditCapPerDay;}

export async function browserReadsLastHour(db,now){
  const t=d(now).getTime();
  const r=await db.first("SELECT COUNT(*) AS n FROM events WHERE kind='fb_read' AND at>? AND at<=?",[iso(t-HOUR),iso(t)]);
  return r.n;
}
