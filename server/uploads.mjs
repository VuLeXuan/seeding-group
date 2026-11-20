import {mkdir,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {AppError,uid} from './util.mjs';
export const MAX_UPLOAD=8*1024*1024;
const TYPES={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
const magic=(b,type)=>type==='image/jpeg'?b.length>3&&b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF
  :type==='image/png'?b.length>7&&b.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]))
  :b.length>11&&b.subarray(0,4).toString('latin1')==='RIFF'&&b.subarray(8,12).toString('latin1')==='WEBP';
export const dataDir=env=>env.DATA_DIR||'.data';
export const NAME=/^[A-Za-z0-9_.-]+$/;
export const safeName=name=>typeof name==='string'&&NAME.test(name)&&!name.includes('..');
export async function saveUpload(env,request){
  const type=(request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(!TYPES[type])throw new AppError('INVALID_IMAGE','Chỉ nhận ảnh JPEG, PNG hoặc WebP.',415);
  const buf=Buffer.from(await request.arrayBuffer());
  if(buf.length>MAX_UPLOAD)throw new AppError('BODY_TOO_LARGE','Ảnh quá lớn, tối đa 8 MB.',413);
  if(!magic(buf,type))throw new AppError('INVALID_IMAGE','Nội dung file không phải ảnh đúng loại.',415);
  const dir=join(dataDir(env),'uploads');await mkdir(dir,{recursive:true});
  const name=`${uid()}.${TYPES[type]}`;await writeFile(join(dir,name),buf);return {name};
}
export async function findFile(env,name){
  if(!safeName(name))return null;
  for(const sub of ['uploads','screenshots']){const file=join(dataDir(env),sub,name);try{if((await stat(file)).isFile())return file;}catch{}}
  return null;
}
export const imageType=name=>({jpg:'image/jpeg',png:'image/png',webp:'image/webp'}[name.split('.').pop()]||'application/octet-stream');
