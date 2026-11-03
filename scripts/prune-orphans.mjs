// 本番FTPから「過去にアップしたが現行ビルドに存在しない」残存ページ（orphan）を削除する。
// 対象は match/ と matchday/ のみ（期限切れ試合・節で蓄積する生成物）。誤削除防止ガード多数。
// 既定はドライラン（一覧表示のみ）。実削除は PRUNE_APPLY=1。
//   使い方: FTP_*環境変数を設定し、先に `node scripts/build-site.mjs` を実行してから本スクリプト。
//   判定: マニフェスト(data/deploy-manifest.json)のキーのうち、match/・matchday/ 配下で
//         現行 site/ に存在しないもの＝orphan。削除後はマニフェストからも除去して保存。
import ftp from 'basic-ftp';
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const MANIFEST = 'data/deploy-manifest.json';
const env = {};
for (const k of ['FTP_HOST','FTP_USER','FTP_PASS','FTP_DIR','SITE_URL']) if (process.env[k]) env[k] = process.env[k];
for (const k of ['FTP_HOST','FTP_USER','FTP_PASS','FTP_DIR']) if (!env[k]) { console.error('FTP情報が不足: ' + k); process.exit(1); }
const APPLY = process.env.PRUNE_APPLY === '1';

function listFiles(dir, base = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const fp = dir + '/' + name, rel = base ? base + '/' + name : name;
    if (statSync(fp).isDirectory()) out.push(...listFiles(fp, rel));
    else out.push(rel);
  }
  return out;
}

if (!existsSync('site') ) { console.error('site/ が無い（先に build-site を実行）。中止。'); process.exit(1); }
if (!existsSync(MANIFEST)) { console.log('マニフェストが無い。orphanなしとして終了。'); process.exit(0); }

const cur = new Set(listFiles('site'));
// ビルド健全性ガード：現行の match/matchday が異常に少ない＝ビルド失敗の疑い → 何も消さない
let curMatch = 0, curMd = 0; for (const f of cur) { if (f.startsWith('match/')) curMatch++; else if (f.startsWith('matchday/')) curMd++; }
if (curMatch + curMd < 500) { console.error(`現行の match+matchday が ${curMatch + curMd} 件と少なすぎます。ビルド不全の可能性があるため中止（誤削除防止）。`); process.exit(1); }

const man = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const orphans = Object.keys(man).filter(k => (k.startsWith('match/') || k.startsWith('matchday/')) && !cur.has(k));

console.log(`現行 match=${curMatch} / matchday=${curMd} ／ マニフェストキー=${Object.keys(man).length}`);
console.log(`orphan候補（match/・matchday/で現行に無い）: ${orphans.length} 件`);
orphans.slice(0, 20).forEach(o => console.log('  - ' + o));
if (orphans.length > 20) console.log(`  …ほか ${orphans.length - 20} 件`);

// 安全キャップ：想定外の大量削除を防ぐ（期限切れ蓄積でも通常は数百件まで）
const CAP = Number(process.env.PRUNE_CAP || 1500);
if (orphans.length > CAP) { console.error(`orphanが${orphans.length}件（上限${CAP}）を超過。異常の可能性があるため中止。PRUNE_CAPで調整可。`); process.exit(1); }

if (!orphans.length) { console.log('削除対象なし。終了。'); process.exit(0); }
if (!APPLY) { console.log('\n[ドライラン] PRUNE_APPLY=1 で実削除します。今回は削除しません。'); process.exit(0); }

const rootClean = (env.FTP_DIR || '/').replace(/\/+$/, '');
async function connect() {
  const c = new ftp.Client(120000); c.ftp.verbose = false;
  try { await c.access({ host: env.FTP_HOST, user: env.FTP_USER, password: env.FTP_PASS, secure: true, secureOptions: { rejectUnauthorized: false } }); }
  catch { await c.access({ host: env.FTP_HOST, user: env.FTP_USER, password: env.FTP_PASS, secure: false }); }
  return c;
}

let c = await connect();
let done = 0, failed = [];
for (const rel of orphans) {
  const abs = (rootClean || '') + '/' + rel;
  for (let attempt = 1; ; attempt++) {
    try {
      await c.remove(abs);
      delete man[rel]; done++;
      console.log(`  ✕ 削除 ${rel} (${done}/${orphans.length})`);
      if (done % 20 === 0) { try { writeFileSync(MANIFEST, JSON.stringify(man)); } catch {} }
      break;
    } catch (e) {
      // 既に存在しない(550)等はorphan解消とみなしマニフェストから除去
      if (/550|not exist|No such|Not Found|cannot find/i.test(e.message)) { delete man[rel]; done++; console.log(`  ・既に無し ${rel}（マニフェストから除去）`); break; }
      if (attempt > 4) { failed.push(rel); console.error(`  失敗 ${rel}: ${e.message}`); break; }
      try { c.close(); } catch {}
      await new Promise(r => setTimeout(r, attempt * 2000));
      try { c = await connect(); } catch {}
    }
  }
}
try { c.close(); } catch {}
writeFileSync(MANIFEST, JSON.stringify(man));
console.log(`\n完了: 削除/解消 ${done} / 失敗 ${failed.length}${failed.length ? '（' + failed.join(', ') + '）' : ''}`);
if (failed.length) process.exitCode = 1;
