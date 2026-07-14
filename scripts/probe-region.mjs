// 動画の「地域制限」と「埋め込み可否」を watch ページの ytInitialPlayerResponse から診断する。
// なぜ日本の視聴者が embed で「お住まいの国では公開されていません」になるのかを切り分けるために使う。
//   - playableInEmbed:false        → 埋め込み自体が禁止（別サイトで再生不可）。サイト側は「YouTubeで見る」導線に。
//   - availableCountries に "JP" 無 → 日本が地域制限で除外（そもそも日本で視聴不可）。ソース差し替えが必要。
//   - status/reason               → 非公開/削除/年齢制限など他要因。
// 使い方: node scripts/probe-region.mjs id1,id2,...   （CIランナー=米国IPからでも availableCountries は全件返るので判定可能）
const ids = (process.argv[2] || process.env.PROBE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
if (!ids.length) { console.log('IDが指定されていません'); process.exit(0); }

const pick = (s, re) => { const m = s.match(re); return m ? m[1] : null; };

for (const id of ids) {
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${id}&hl=ja&gl=US`, {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36', 'accept-language': 'ja' },
    });
    const html = await r.text();
    const i = html.indexOf('ytInitialPlayerResponse');
    const seg = i >= 0 ? html.slice(i, i + 200000) : html;
    // 視聴可能国（microformatに列挙される全許可国。JPが含まれるか）
    const ac = pick(seg, /"availableCountries":\[([^\]]*)\]/);
    const countries = ac ? ac.replace(/"/g, '').split(',').filter(Boolean) : null;
    const jp = countries ? countries.includes('JP') : null;
    const embed = /"playableInEmbed":true/.test(seg) ? true : /"playableInEmbed":false/.test(seg) ? false : null;
    const status = pick(seg, /"status":"([A-Z_]+)"/);
    const reason = pick(seg, /"reason":\{"simpleText":"([^"]+)"/) || pick(seg, /"reason":"([^"]+)"/);
    console.log(`● ${id}`);
    console.log(`   status: ${status || '不明'}${reason ? '  reason: ' + reason : ''}`);
    console.log(`   playableInEmbed: ${embed === null ? '不明' : embed}`);
    if (countries) console.log(`   availableCountries: ${countries.length}ヶ国  日本(JP)=${jp ? '○ 視聴可' : '× 除外'}`);
    else console.log(`   availableCountries: 記載なし（＝全世界許可の可能性 or 取得失敗）`);
  } catch (e) { console.log(`✗ ${id}: ${e.message}`); }
}
