// 指定した動画IDの oEmbed（タイトル・投稿チャンネル）を取得して表示するだけの診断ツール。
// なぜ watch-knockout のマッチから漏れるのかを、実タイトル/チャンネルから突き止めるために使う。
// 使い方: node scripts/probe-videos.mjs id1,id2,...   または  PROBE_IDS=id1,id2 node scripts/probe-videos.mjs
const ids = (process.argv[2] || process.env.PROBE_IDS || '').split(',').map(s=>s.trim()).filter(Boolean);
if (!ids.length) { console.log('IDが指定されていません'); process.exit(0); }
for (const id of ids) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${id}&format=json`);
    if (!r.ok) { console.log(`✗ ${id}: oEmbed HTTP ${r.status}`); continue; }
    const j = await r.json();
    console.log(`● ${id}`);
    console.log(`   タイトル: ${j.title}`);
    console.log(`   チャンネル: ${j.author_name}  (${j.author_url||''})`);
  } catch (e) { console.log(`✗ ${id}: ${e.message}`); }
}
