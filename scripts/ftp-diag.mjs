import { readFileSync } from 'node:fs';
import * as ftp from 'basic-ftp';
const env = {}; for (const l of readFileSync('deploy.env','utf8').replace(/^﻿/,'').split(/\r?\n/)) { const m=l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if(m) env[m[1]]=m[2].trim(); }
const c = new ftp.Client(30000);
try {
  try { await c.access({host:env.FTP_HOST,user:env.FTP_USER,password:env.FTP_PASS,secure:true,secureOptions:{rejectUnauthorized:false}}); }
  catch { await c.access({host:env.FTP_HOST,user:env.FTP_USER,password:env.FTP_PASS,secure:false}); }
  console.log('PWD(ログイン直後):', await c.pwd());
  console.log('--- "/" の中身 ---');
  for (const f of await c.list('/')) console.log('  ', f.isDirectory?'[DIR]':'     ', f.name);
  // public_html を探す
  for (const cand of ['/public_html','/highlight-compass.com','/highlight-compass.com/public_html']) {
    try { const l = await c.list(cand); console.log('--- '+cand+' あり('+l.length+'件) ---'); l.slice(0,8).forEach(f=>console.log('   ', f.isDirectory?'[DIR]':'     ', f.name)); }
    catch { console.log('--- '+cand+' : 無し/不可'); }
  }
} catch(e){ console.error('ERR', e.message); } finally { c.close(); }
