// site/ の中身をFTPアップロード
// deploy.env（gitignore済）に FTP_HOST/FTP_USER/FTP_PASS/FTP_DIR/SITE_URL を記載して実行
// 注意: このサーバは転送完了の間際に制御接続を切る（ECONNRESET）ことがあるため、
//  ①本体アップを数回リトライ ②末尾の主要ファイルは別接続で個別に上げ直す、の二段構え。
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
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

// 1ファイルずつアップロード。制御接続が切れたら再接続して続行（このサーバ対策）
async function uploadAll() {
  const files = listFiles('site');
  const rootClean = (env.FTP_DIR || '/').replace(/\/+$/, '');   // "/" の場合は ""
  console.log('アップロード先:', env.FTP_DIR, '／対象', files.length, 'ファイル');
  let c = await connect();
  let curDir = null;
  const ensure = async (dir) => {
    const abs = dir === '.' ? (rootClean || '/') : (rootClean + '/' + dir);
    if (curDir !== abs) { await c.ensureDir(abs); curDir = abs; }
  };
  let done = 0; const failed = [];
  for (const rel of files) {
    const i = rel.lastIndexOf('/');
    const dir = i < 0 ? '.' : rel.slice(0, i);
    const baseName = i < 0 ? rel : rel.slice(i + 1);
    for (let attempt = 1; ; attempt++) {
      try {
        await ensure(dir);
        await c.uploadFrom('site/' + rel, baseName);
        done++; process.stdout.write(`  ↑ ${rel} (${done}/${files.length})\r`);
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
  return { total: files.length, done, failed };
}
async function uploadTail() {
  const c = await connect();
  try { for (const f of TAIL) { try { await c.uploadFrom('site/' + f, f); console.log('  ↑(tail) ' + f); } catch (e) { console.error('  tail失敗 ' + f + ':', e.message); } } }
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
