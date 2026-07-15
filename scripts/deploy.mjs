// site/ の中身をFTPアップロード
// deploy.env（gitignore済）に FTP_HOST/FTP_USER/FTP_PASS/FTP_DIR/SITE_URL を記載して実行
// 注意: このサーバは転送完了の間際に制御接続を切る（ECONNRESET）ことがあるため、
//  ①本体アップを数回リトライ ②末尾の主要ファイルは別接続で個別に上げ直す、の二段構え。
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as ftp from 'basic-ftp';

// 差分アップロード用マニフェスト（相対パス→md5）。前回と同じ内容のファイルは飛ばす＝配信を数分→数秒に。
// DEPLOY_FULL=1 で全アップロード（マニフェスト無視）。マニフェストは data/ 配下（site/外なのでFTPには上がらない）。
const MANIFEST = 'data/deploy-manifest.json';
const md5 = (p) => createHash('md5').update(readFileSync(p)).digest('hex');
const loadManifest = () => { try { return JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch { return {}; } };

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

// site/ 配下の全ファイルを相対パスで列挙
function listFiles(dir, base = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const fp = dir + '/' + name, rel = base ? base + '/' + name : name;
    if (statSync(fp).isDirectory()) out.push(...listFiles(fp, rel));
    else out.push(rel);
  }
  return out;
}

// 1ファイルずつアップロード。制御接続が切れたら再接続して続行（このサーバ対策）。前回と同一ハッシュは飛ばす（差分）。
async function uploadAll() {
  const files = listFiles('site');
  const rootClean = (env.FTP_DIR || '/').replace(/\/+$/, '');   // "/" の場合は ""
  const FULL = process.env.DEPLOY_FULL === '1';
  const man = FULL ? {} : loadManifest();
  const hashes = {}; const targets = [];
  for (const rel of files) { const h = md5('site/' + rel); hashes[rel] = h; if (man[rel] !== h) targets.push(rel); }
  changedTail = new Set(targets.filter(r => TAIL.includes(r)));   // tail保証は「今回変わったtailファイル」だけ
  console.log(`アップロード先: ${env.FTP_DIR} ／ 全${files.length}中 ${targets.length}ファイルが変更（差分）${FULL ? ' [FULL]' : ''}`);
  if (!targets.length) { writeFileSync(MANIFEST, JSON.stringify(hashes)); return { total: files.length, done: 0, failed: [], skipped: files.length }; }
  const newMan = { ...man };
  let c = await connect();
  let curDir = null;
  const ensure = async (dir) => {
    const abs = dir === '.' ? (rootClean || '/') : (rootClean + '/' + dir);
    if (curDir !== abs) { await c.ensureDir(abs); curDir = abs; }
  };
  let done = 0; const failed = [];
  for (const rel of targets) {
    const i = rel.lastIndexOf('/');
    const dir = i < 0 ? '.' : rel.slice(0, i);
    const baseName = i < 0 ? rel : rel.slice(i + 1);
    for (let attempt = 1; ; attempt++) {
      try {
        await ensure(dir);
        await c.uploadFrom('site/' + rel, baseName);
        done++; newMan[rel] = hashes[rel]; process.stdout.write(`  ↑ ${rel} (${done}/${targets.length})\r`);
        if (done % 20 === 0) { try { writeFileSync(MANIFEST, JSON.stringify(newMan)); } catch {} }   // 途中保存＝タイムアウトで打ち切られても進捗を残し次回再開できる
        break;
      } catch (e) {
        if (attempt > 4) { failed.push(rel); console.error(`\n  失敗 ${rel}: ${e.message}`); break; }
        try { c.close(); } catch {}
        await new Promise(r => setTimeout(r, 1500));
        try { c = await connect(); curDir = null; } catch {}
      }
    }
  }
  c.close();
  writeFileSync(MANIFEST, JSON.stringify(newMan));   // 成功分だけ反映。失敗ファイルは旧ハッシュのまま＝次回再試行
  return { total: files.length, done, failed, skipped: files.length - targets.length };
}
let changedTail = new Set();
async function uploadTail() {
  const tails = TAIL.filter(f => changedTail.has(f) && existsSync('site/' + f));   // 今回変わった主要ファイルだけ別接続で念押し
  if (!tails.length) return;
  const c = await connect();
  try { for (const f of tails) { try { await c.uploadFrom('site/' + f, f); console.log('  ↑(tail) ' + f); } catch (e) { console.error('  tail失敗 ' + f + ':', e.message); } } }
  finally { c.close(); }
}

let res = { total: 0, done: 0, failed: ['(未実行)'] };
try { res = await uploadAll(); } catch (e) { console.error('\nアップロード致命的エラー:', e.message); }
// 末尾の主要ファイルは別接続で個別に上げ直して念押し保証する
try { await uploadTail(); } catch (e) { console.error('tail 一括失敗:', e.message); }
if (res.failed.length === 0) {
  console.log('\n✅ デプロイ完了（' + res.done + '/' + res.total + '）-> ' + (env.SITE_URL || ('https://' + env.FTP_HOST)));
} else {
  console.log('\n⚠️ 一部失敗（成功 ' + res.done + '/' + res.total + '）。失敗: ' + res.failed.join(', '));
  process.exitCode = 1;
}
