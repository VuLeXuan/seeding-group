import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {handleApi,BIG_BODY,BIG_ROUTES} from './api.mjs';
import {openDatabase,logEvent} from './db.mjs';
import {startLoops} from './worker.mjs';
import {browserTick} from './browser-worker.mjs';
import {closeSession} from './fb/browser.mjs';
import {setRuntime} from './settings.mjs';
import {killAllRunners} from './claude-runner.mjs';
import {MAX_UPLOAD} from './uploads.mjs';
const env={...process.env,DB:openDatabase(process.env.DATABASE_PATH||'.data/fb-auto.sqlite'),DATA_DIR:process.env.DATA_DIR||'.data'};
const root=resolve('public'),host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT)||4180;
const CSP="default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'";
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8'};
let stopping=false,stopLoops=null;
const server=createServer(async(req,res)=>{
  try{
    if(req.url?.startsWith('/api/')){
      const p=req.url.split('?')[0],cap=req.method!=='POST'?16384:p==='/api/uploads'?MAX_UPLOAD:BIG_ROUTES.includes(p)?BIG_BODY:16384;
      const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>cap){res.writeHead(413,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:{code:'BODY_TOO_LARGE',message:'Yêu cầu quá lớn.'}}));req.destroy();return;}chunks.push(chunk);}
      const request=new Request(`http://${req.headers.host||host+':'+port}${req.url}`,{method:req.method,headers:new Headers(req.headers),...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
      const response=await handleApi(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    const url=new URL(req.url,'http://localhost');let file;try{file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));}catch{res.writeHead(400);res.end();return;}
    if(!file.startsWith(root+'/')){res.writeHead(404);res.end();return;}
    if(!(await stat(file)).isFile())throw new Error('Not a file');const body=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache','Content-Security-Policy':CSP});res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404);res.end('Not found');}
});
// boot writes and the loops start only once the port is ours; a half-sent reply or post is never resent: it becomes failed
server.on('error',e=>{if(server.listening){console.error('Server:',e.code||e.name);return;}
  console.error(e.code==='EADDRINUSE'?`FB Auto Post: ${host}:${port} is already in use (another server running?); exiting without touching the database.`:`FB Auto Post: cannot listen on ${host}:${port} (${e.code||e.name}); exiting.`);
  env.DB.close();process.exit(1);});
server.listen(port,host,async()=>{
  try{
    const r=await env.DB.run("UPDATE replies SET status='failed',error='Không rõ đã gửi chưa, kiểm tra trên Facebook' WHERE status='sending'");
    const t=await env.DB.run("UPDATE post_targets SET status='failed',error='Không rõ đã đăng chưa, kiểm tra trên Facebook' WHERE status='posting'");
    if(r||t)await logEvent(env.DB,'boot_recovered',{replies:r,targets:t});
    // a Chrome window cannot survive a restart, and a restart must not open one by itself
    await setRuntime(env.DB,{loginWindowOpen:false,loginRequested:false});
  }catch(e){console.error('Boot:',e.code||e.name,e.message);env.DB.close();process.exit(1);}
  if(stopping)return;
  if(process.env.WORKERS!=='off')stopLoops=startLoops(env,{},{extraTicks:[{every:3000,run:()=>browserTick(env.DB,env)}]});
  console.log(`FB Auto Post: http://${host}:${port}`);
});
function shutdown(){
  if(stopping)return;stopping=true;stopLoops?.();server.close();killAllRunners();closeSession().catch(()=>{});
  setTimeout(()=>process.exit(0),5000).unref();
  setTimeout(()=>{try{env.DB.close();}catch{}process.exit(0);},200);
}
for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,shutdown);
