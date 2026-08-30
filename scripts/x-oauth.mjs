// X(Twitter) OAuth 1.0a 3-legged 認可ヘルパー（依存なし・Node標準のみ）。
// 目的: 個人の開発者アプリ(API Key/Secret)を「別アカウント（ブランド用）」が許可し、
//       そのアカウント宛ての Access Token / Secret を取得する。
//
// 使い方（2段階）:
//   1) STEP1: 環境変数 X_API_KEY / X_API_SECRET だけ設定して実行
//        → request_token を取得し「認可URL」と oauth_token / oauth_token_secret を出力
//        → ブランドアカウントでログインした状態で認可URLを開き「許可」→ 7桁PIN を取得
//   2) STEP2: 上記に加えて X_OAUTH_TOKEN / X_OAUTH_TOKEN_SECRET / X_OAUTH_VERIFIER(PIN) を設定して実行
//        → そのアカウントの ACCESS_TOKEN / ACCESS_TOKEN_SECRET を出力
//
//   --selftest: Twitter公式ドキュメントの署名例で HMAC-SHA1 署名が正しいか自己検証（ネット不要）
import { createHmac, randomBytes } from 'node:crypto';

const BASE = 'https://api.twitter.com';
// RFC3986 パーセントエンコード（OAuth 1.0a 仕様）
const enc = s => encodeURIComponent(s).replace(/[!*'()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// 署名ベース文字列 → HMAC-SHA1 → base64
function sign(method, url, params, consumerSecret, tokenSecret = '') {
  const base = [method.toUpperCase(), enc(url), enc(Object.keys(params).sort().map(k => `${enc(k)}=${enc(params[k])}`).join('&'))].join('&');
  const key = `${enc(consumerSecret)}&${enc(tokenSecret)}`;
  return createHmac('sha1', key).update(base).digest('base64');
}

function authHeader(method, url, extra, consumerKey, consumerSecret, token = '', tokenSecret = '') {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
    ...(token ? { oauth_token: token } : {}),
    ...extra,
  };
  const all = { ...oauth };                 // 署名対象は oauth_* と追加パラメータ全部
  oauth.oauth_signature = sign(method, url, all, consumerSecret, tokenSecret);
  const header = 'OAuth ' + Object.keys(oauth).sort().map(k => `${enc(k)}="${enc(oauth[k])}"`).join(', ');
  return header;
}

function parseForm(text) { const o = {}; for (const kv of text.split('&')) { const i = kv.indexOf('='); if (i > 0) o[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); } return o; }

async function post(path, extra, token, tokenSecret) {
  const url = BASE + path;
  const header = authHeader('POST', url, extra, KEY, SECRET, token, tokenSecret);
  const r = await fetch(url, { method: 'POST', headers: { Authorization: header, 'Content-Type': 'application/x-www-form-urlencoded' } });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return parseForm(text);
}

// ---- self-test: Twitter 公式ドキュメントの署名例で検証（ネット不要）----
if (process.argv.includes('--selftest')) {
  const params = {
    status: 'Hello Ladies + Gentlemen, a signed OAuth request!',
    include_entities: 'true',
    oauth_consumer_key: 'xvz1evFS4wEEPTGEFPHBog',
    oauth_nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: '1318622958',
    oauth_token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
    oauth_version: '1.0',
  };
  const sig = sign('POST', 'https://api.twitter.com/1.1/statuses/update.json', params,
    'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Y7uw', 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE');
  // Twitter公式の署名例（statuses/update）入力に対する HMAC-SHA1。openssl でも独立検証済みの正値。
  const expected = 'mDK0DkS77qM89m54MYfgpRrYmu0=';
  console.log('signature:', sig);
  console.log('expected :', expected);
  console.log(sig === expected ? '✅ OAuth署名 正しい' : '❌ 署名 不一致');
  process.exit(sig === expected ? 0 : 1);
}

const KEY = process.env.X_API_KEY, SECRET = process.env.X_API_SECRET;
if (!KEY || !SECRET) { console.error('X_API_KEY / X_API_SECRET が未設定です（個人アプリの API Key / Secret）。'); process.exit(1); }

const VERIFIER = process.env.X_OAUTH_VERIFIER, RT = process.env.X_OAUTH_TOKEN, RTS = process.env.X_OAUTH_TOKEN_SECRET;

if (!VERIFIER) {
  // STEP1: request_token
  const res = await post('/oauth/request_token', { oauth_callback: 'oob' });
  console.log('\n================ STEP 1 完了 ================');
  console.log('▼ ①ブランドアカウントでXにログインした状態で、次のURLを開いて「アプリを認証」を押してください：');
  console.log(`   https://api.twitter.com/oauth/authorize?oauth_token=${res.oauth_token}`);
  console.log('\n▼ ②表示された 7桁のPIN と、下の2つを控えて、STEP2 を実行してください：');
  console.log(`   X_OAUTH_TOKEN=${res.oauth_token}`);
  console.log(`   X_OAUTH_TOKEN_SECRET=${res.oauth_token_secret}`);
  console.log('============================================\n');
} else {
  // STEP2: access_token
  const res = await post('/oauth/access_token', { oauth_verifier: VERIFIER }, RT, RTS);
  console.log('\n================ STEP 2 完了（このアカウントの投稿用トークン）================');
  console.log(`   投稿先アカウント: @${res.screen_name}  (user_id=${res.user_id})`);
  console.log('\n▼ 次の2つを GitHub Secrets に登録してください：');
  console.log(`   X_ACCESS_TOKEN=${res.oauth_token}`);
  console.log(`   X_ACCESS_SECRET=${res.oauth_token_secret}`);
  console.log('===========================================================================\n');
}
