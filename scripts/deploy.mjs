// site/ の中身をスターサーバーへFTPアップロード
// deploy.env（gitignore済）に FTP_HOST/FTP_USER/FTP_PASS/FTP_DIR/SITE_URL を記載して実行
import { readFileSync, existsSync } from 'node:fs';
import * as ftp from 'basic-ftp';

if (!existsSync('deploy.env')) { console.error('deploy.env が見つかりません。FTP情報を記載してください。'); process.exit(1); }
const env = {};
for (const line of readFileSync('deploy.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].trim();
}
const need = ['FTP_HOST','FTP_USER','FTP_PASS','FTP_DIR'];
for (const k of need) if (!env[k]) { console.error('deploy.env に ' + k + ' がありません'); process.exit(1); }

const client = new ftp.Client(30000);
client.ftp.verbose = false;
try {
  // まず FTPS(明示的) を試し、ダメなら通常FTP
  try {
    await client.access({ host: env.FTP_HOST, user: env.FTP_USER, password: env.FTP_PASS, secure: true, secureOptions: { rejectUnauthorized: false } });
    console.log('接続: FTPS (secure)');
  } catch {
    await client.access({ host: env.FTP_HOST, user: env.FTP_USER, password: env.FTP_PASS, secure: false });
    console.log('接続: FTP (plain)');
  }
  await client.ensureDir(env.FTP_DIR);
  console.log('アップロード先:', env.FTP_DIR);
  client.trackProgress(info => { if (info.name) process.stdout.write('  ↑ ' + info.name + '\r'); });
  await client.uploadFromDir('site', env.FTP_DIR);
  client.trackProgress();
  console.log('\n✅ デプロイ完了 ->', env.SITE_URL || ('https://' + env.FTP_HOST));
} catch (e) {
  console.error('デプロイ失敗:', e.message);
  process.exitCode = 1;
} finally {
  client.close();
}
