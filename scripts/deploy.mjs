// site/ の中身をFTPアップロード
// deploy.env（gitignore済）に FTP_HOST/FTP_USER/FTP_PASS/FTP_DIR/SITE_URL を記載して実行
// 注意: このサーバは転送完了の間際に制御接続を切る（ECONNRESET）ことがあるため、
//  ①本体アップを数回リトライ ②末尾の主要ファイルは別接続で個別に上げ直す、の二段構え。
import { readFileSync, existsSync } from 'node:fs';
import * as ftp from 'basic-ftp';

// 認証情報は ①環境変数（GitHub Actions の Secrets）優先 ②無ければ deploy.env から読む
const env = {};
if (existsSync('deploy.env')) {
  for (const line of readFileSync('deploy.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].trim();
  }
}
for (const k of ['FTP_HOST','FTP_USER','FTP_PASS','FTP_DIR','SITE_URL']) if (process.env[k]) env[k] = process.env[k];
for (const k of ['FTP_HOST', 'FTP_USER', 'FTP_PASS', 'FTP_DIR']) if (!env[k]) { console.error('FTP情報が不足: ' + k + '（deploy.env または環境変数で指定）'); process.exit(1); }

async function connect() {
  const c = new ftp.Client(60000); c.ftp.verbose = false;
  try {
    await c.access({ host: env.FTP_HOST, user: env.FTP_USER, password: env.FTP_PASS, secure: true, secureOptions: { rejectUnauthorized: false } });
  } catch {
    await c.access({ host: env.FTP_HOST, user: env.FTP_USER, password: env.FTP_PASS, secure: false });
  }
  await c.ensureDir(env.FTP_DIR);
  return c;
}

// 末尾で切れがちな主要ファイル（表示・SEOに効くもの）は最後に個別保証
const TAIL = ['index.html', 'sitemap.xml', 'robots.txt', 'og.png', 'ads.txt', 'about.html', 'privacy.html', 'contact.html'];

async function uploadFull() {
  const c = await connect();
  console.log('アップロード先:', env.FTP_DIR);
  c.trackProgress(info => { if (info.name) process.stdout.write('  ↑ ' + info.name + '\r'); });
  try { await c.uploadFromDir('site', env.FTP_DIR); } finally { c.trackProgress(); c.close(); }
}
async function uploadTail() {
  const c = await connect();
  try { for (const f of TAIL) { try { await c.uploadFrom('site/' + f, f); console.log('  ↑(tail) ' + f); } catch (e) { console.error('  tail失敗 ' + f + ':', e.message); } } }
  finally { c.close(); }
}

let ok = false;
for (let i = 1; i <= 3 && !ok; i++) {
  try { await uploadFull(); ok = true; }
  catch (e) { console.error(`\n本体アップ 試行${i} 中断: ${e.message}`); await new Promise(r => setTimeout(r, 3000)); }
}
// 本体が完走しても途中で切れても、末尾主要ファイルは個別に上げ直して保証する
try { await uploadTail(); } catch (e) { console.error('tail 一括失敗:', e.message); }
console.log(ok ? '\n✅ デプロイ完了 -> ' + (env.SITE_URL || ('https://' + env.FTP_HOST))
  : '\n⚠️ 本体アップに中断がありました（末尾の主要ファイルは個別アップ済み）。欠けが疑われる場合は再実行してください。');
