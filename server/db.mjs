import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {nowIso} from './util.mjs';
function openBinding(filename){
  if(filename!==':memory:')mkdirSync(dirname(filename),{recursive:true});
  const sqlite=new DatabaseSync(filename);sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  sqlite.exec('CREATE TABLE IF NOT EXISTS _local_migrations (tag TEXT PRIMARY KEY)');
  const journal=JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url),'utf8'));
  for(const {tag} of journal.entries){if(sqlite.prepare('SELECT tag FROM _local_migrations WHERE tag=?').get(tag))continue;const sql=readFileSync(new URL('../drizzle/'+tag+'.sql',import.meta.url),'utf8');sqlite.exec('BEGIN IMMEDIATE');try{sqlite.exec(sql);sqlite.prepare('INSERT INTO _local_migrations(tag) VALUES(?)').run(tag);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}
  return {
    prepare(sql){return {bind(...params){return {all(){return {results:sqlite.prepare(sql).all(...params)};},first(){return sqlite.prepare(sql).get(...params)||null;},run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...params).changes)}};},_run(){return sqlite.prepare(sql).run(...params);}};}};},
    batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const out=statements.map(s=>({meta:{changes:Number(s._run().changes)}}));sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}},
    close(){sqlite.close();},
  };
}
export class Database {
  constructor(binding){this.binding=binding;}
  async all(sql,params=[]){const r=await this.binding.prepare(sql).bind(...params).all();return r.results||[];}
  async first(sql,params=[]){return this.binding.prepare(sql).bind(...params).first();}
  async run(sql,params=[]){const r=await this.binding.prepare(sql).bind(...params).run();return r.meta?.changes??0;}
  async batch(items){return this.binding.batch(items.map(([sql,params=[]])=>this.binding.prepare(sql).bind(...params)));}
  async setting(key,fallback){const row=await this.first('SELECT value FROM settings WHERE key=?',[key]);try{return row?JSON.parse(row.value):fallback;}catch{return fallback;}}
  async setSetting(key,value){await this.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[key,JSON.stringify(value)]);}
  close(){this.binding.close();}
}
export function openDatabase(file=':memory:'){return new Database(openBinding(file));}
export async function logEvent(db,kind,detail,at=nowIso()){await db.run('INSERT INTO events(at,kind,detail) VALUES(?,?,?)',[at,kind,detail===undefined?null:typeof detail==='string'?detail:JSON.stringify(detail)]);}
