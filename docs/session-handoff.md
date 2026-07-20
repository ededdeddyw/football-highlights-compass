# セッション引き継ぎメモ（2026-07-14 → 07-20 更新）

次のセッションがそのまま作業を再開できるようにまとめる。**最初にこのファイルと `docs/product-vision.md`・`docs/monetization-strategy.md`・`docs/japanese-style-rules.md` を読むこと。**

---
## 🆕 最新状況（2026-07-20・五大リーグ展開中）＝ここが最優先の再開ポイント

**サイトを「W杯専用」から「五大リーグ2025-26 全試合の羅針盤」へ拡張中。** ユーザーは翌朝また来る。

### 完了済み
- **五大リーグ 全試合データ化（計1752試合）**：`data/league-<code>-<season>.json`。bl=ブンデス306(OpenLigaDB)、pl=プレミア380/sa=セリエA380/laliga=ラ・リーガ380/ligue1=リーグアン306（football-data.org、`FOOTBALL_DATA_TOKEN`登録済み）。取得は `fetch-league.mjs`＋`fetch-league.yml`。
- **78クラブの日本語名**を `data/league-teams.json` に整備。URLスラッグはクラブごと一意（英語正式名から導出、`homeSlug/awaySlug`）。
- **全試合ページ生成**（`build-site.mjs` の `buildLeagueMatch`）：安定スラッグ `bl-2526-mdN-home-away`、結果マスク、モバイル見どころドロワー、大きいネタバレバー。**見どころ記事 or 動画があるページはindex化、無ければnoindex**。
- **ブンデス見どころ 299/306・動画 191/306（本番反映済み）**。動画は**既定で隠し「🙈タップで表示」**（ユーザー選択の1案・`.video-veil`＋`.spoiler-cover`）。
- **動画自動検知** `watch-league.mjs`＋`watch-league.yml`（公式ch＋両チーム名別名`league-team-aliases.json`＋節ゲート＋スコア非表示）。**limit=80程度で回すこと**（306一括は30分timeoutで落ちる。途中保存＋always-commitはあるが小分け推奨）。ブンデスは191で頭打ち（残りは公式にハイライト無し等）。
- **差分デプロイ** `deploy-diff.yml`（変更ファイルのみ・途中保存で再開可）。全アップロードの `deploy-ftp.yml` は648p超で固まりやすいので**基本 deploy-diff を使う**。

### 07-20 夜間バッチで完了したこと ✅
- **五大リーグ全試合の見どころ生成 完了**（各9割超）：bl 304/306・pl 375/380・sa 380/380・laliga 373/380・ligue1 296/306。残り数件は `looksSpoilery` 誤検出による意図的除外。`data/match-previews.json`。
- **リーグアン読み込みバグ修正（PR#56）**：`build-site.mjs` のファイル名フィルタ `[a-z]+` がコード内の数字`1`にマッチせず `league-ligue1-2025.json` が丸ごと欠落していた → `[a-z0-9]+` に修正。これでリーグアン306ページが生成・index化された。
- **夜間cron停止（PR#57）**：`enrich-matches.yml` の30分scheduleを撤去（全リーグ生成完了のため）。以降は手動dispatchのみ。
- **本番デプロイ完了**：`deploy-diff.yml` 実行、変更1463ファイル（新ligue1 306p＋見どころ更新分＋sitemap）を全アップロード。**全5リーグのページが highlight-compass.com に反映済み**。

### 次にやること（翌朝〜・方針確認してから）
1. **動画紐付けを新4リーグへ**：`league-team-aliases.json` は現状ブンデスのみ。pl/sa/laliga/ligue1 各クラブの別名（英/現地/略称）を追加 → `watch-league.yml`（code指定・limit80で複数回）。**プレミアはYouTube公式フルハイライトが無い**ので動画は限定的（記事＋案内で対応）。セリエA/ラ・リーガ/リーグアンは公式chあり（geo/embedは埋め込みフォールバックで吸収）。→ 追加後 deploy-diff で反映。
2. ホームページ（index.html）への五大リーグ導線・一覧の追加（未着手）。
3. ユーザー保留：**AdSense再審査リクエスト**（記事激増で今が出しどき）。

### 注意（五大リーグ特有）
- 見どころ生成の歩留まりは、プロンプトで「過去スコア/勝敗断定語を書かない」よう調整済み（`enrich-matches.mjs`）。
- `build-site.mjs` は古い `site/match/*` を消さない（gitignore）。ローカルに旧スラッグの残骸が出るがCIは新規チェックアウトなので無害。
- W杯は決勝まで完了（スペイン優勝）。cron `wc-knockout.yml` が15分ごとに稼働継続中。

---

## いま何をしていたか（＝最優先の再開ポイント）
**W杯決勝トーナメント動画のソースを「FOX(米国限定・日本で再生不可)」→「DAZN Japan(日本再生可)」へ貼り直す作業の途中。**

### 診断で判明した真因（2026-07-14 diag run 29304220662 のログより）
- **グローバルYouTube検索はデータセンターIPだと英語/FIFA寄りになり、DAZN Japan の「個別試合RECAP」が上位に一切出ない。** 実際、検索で返るDAZN動画は「準々決勝ゴール集」等の**まとめ動画**か「デイリーハイライト」だけで、ユーザーが挙げた個別RECAP（`-zyPZH9Gung`＝アルゼンチンvsスイス準々決勝、`qtVROGuxhw0`＝ノルウェーvsイングランド準々決勝）は候補に現れない。
- 一方、**FIFA公式ハイライトはほぼ全試合で候補に出る**（日本再生可・許可ch）。ただしFIFAのタイトルは `Highlights | Argentina 3-1 Switzerland | FIFA World Cup 2026™` 形式で、**①ラウンド語が無い→ゲート(R.match)で落ちる ②タイトルにスコア→プレイヤーのタイトル欄でネタバレ残留**。
- 結論：ネタバレゼロの日本語RECAP（DAZN）を確実に取るには、**グローバル検索ではなく DAZN Japan の channelId 内を直接検索**する必要がある。

### この診断を受けて入れた修正（このブランチ `claude/new-session-w7tl20`・未マージ）
- `scripts/watch-knockout.mjs` に **`searchChannelIds(channelId, query)`（チャンネル内検索）を追加**。各試合でまず **DAZN Japan の channelId 内を「◯◯ ◯◯ ラウンド語」で検索**して候補の先頭に入れ、その後グローバル検索を続ける（FIFA等のフォールバック）。ゲートは従来どおり（DAZN RECAPはラウンド語入り・スコア無しなので全ゲート通過）。
- 直前の main 反映分（#33 probe / #34 検索語変更）はそのまま活きている。FOXは `data/wc2026-channels.json` で無効のまま。`data/wc-knockout.json` は FOX由来17件クリア済み（日本再生可の既存11件は保持）。

### 追加で判明したこと（diag run 29304639181 = channel-scoped版・2026-07-14）
- **channel-scoped 検索でもDAZNの「個別試合RECAP」は取れない。** DAZN Japan の channelId 内を検索すると候補は増える（22〜31件）が、返るのは**過去のJリーグ/DFB/UEFA等の旧動画**と**W杯まとめ動画（準々決勝ゴール集）**ばかり。ユーザー提示の個別RECAP（`-zyPZH9Gung`＝アルゼンチンvsスイス準々決勝、`qtVROGuxhw0`＝ノルウェーvsイングランド準々決勝）は**グローバル検索でもchannel内検索でも一切ヒットしない**。
- probe（run 29304761368）で両IDの実体を確定：どちらも **DAZN Japan** の「【FIFAワールドカップ2026】◯◯ vs ◯◯ : 準々決勝 │ MATCH RECAP」＝**日本再生可・タイトルにスコア無し（ネタバレ安全）・ラウンド語あり**。全ゲートを通る“理想の”ソース。**問題は判定ではなく「発見（スクレイピング検索で上位に出ない）」だけ。**
- 結論：**未認証スクレイピング検索では DAZN個別RECAPは安定的に発見できない。確実なのは videoId の手動シード（`data/wc-knockout.json` に直接記入）。**

### いま取った対応（このブランチ）
- ユーザー提供のDAZN URL計17本を **probe（oEmbedで実タイトル/チャンネル確認）してから** `data/wc-knockout.json` に直接シード。**probeは必須**だった（URLのpp検索ヒントは当てにならず、実タイトルで判定）。
- **シード済み（15本・全てDAZN公式・タイトルにスコア無し＝ネタバレ安全）**：
  - qf: アルゼンチンvsスイス=`-zyPZH9Gung`／ノルウェーvsイングランド=`qtVROGuxhw0`／フランスvsモロッコ=`vtQ2C6xwe-U`／スペインvsベルギー=`yQWSB6cYPIQ`
  - r16: パラグアイvsフランス=`a4QJewbgwb8`／ブラジルvsノルウェー=`5gGqLfOd5vI`／メキシコvsイングランド=`yf0nHCLcEY4`／アメリカvsベルギー=`aqqoX52X12w`／スペインvsポルトガル=`fs3UTcdj1OE`／アルゼンチンvsエジプト=`zhUzjs3kkDk`／スイスvsコロンビア=`t273-64bkn4`
  - r32: ポルトガルvsクロアチア=`P16goOZz_nM`／スイスvsアルジェリア=`svHrjVxBfdA`／オーストラリアvsエジプト=`sxtDY3LsJHM`／コロンビアvsガーナ=`GQaQsR4BU64`
- **保留（ネタバレのためシードせず・ユーザーにクリーンなDAZN RECAPのURLを要求中）2件**：
  - r16 カナダvsモロッコ：提供URL `sAYjtcpoaf0` は**FIFAの動画でタイトルに「Canada 0-3 Morocco」＝スコア入り**。DAZNの「MATCH RECAP」版URLを別途もらう。
  - r32 アルゼンチンvsカーボベルデ：提供URL `RnuN64r7xhM` はDAZNだがタイトルが「延長120分の激闘を制したのは、前回王者アルゼンチン！」＝結果が読める。クリーンなRECAP版を別途もらう。
- **未実施（試合前）**：sf フランスvsスペイン／イングランドvsアルゼンチン（result空）。試合後にRECAPが出たらシード。
- **シードは必ず main に入れること**（15分毎の `wc-knockout.yml` cron は main の index.html を再生成してデプロイするため、seedがmainに無いと次のcronで消える）。
- **probeで判明した重要な学び**：ユーザーのYouTube URLの `pp=` パラメータは「検索語」であって動画の中身とは限らない（例: pp=「アメリカvsベルギー」でも実体はスペインvsベルギー準々決勝）。**必ずoEmbedの実タイトルで試合と照合する。またタイトルにスコア/結果が入る動画はネタバレなので採用しない。**

### 次にやること（順番）
1. このブランチを **main へ squash マージ**（seed を main に載せる）。
2. `wc-knockout.yml` を**手動実行**（watch がindex.htmlのKOブロックをseed込みで再生成→build-siteが `/match/-zyPZH9Gung.html`・`/match/qtVROGuxhw0.html` を生成→FTPデプロイ→commit）。
3. ユーザーに `https://highlight-compass.com/match/-zyPZH9Gung.html`（アルゼンチンvsスイス）等で**日本から再生できるか**確認してもらう。
4. **残りの決勝T各試合はユーザーからDAZN RECAPのURLをもらって同様にシード**するのが最短で確実。もらったら `data/wc-knockout.json` の該当スロットに `videoId` を記入→main→wc-knockout.yml。
5. （将来の自動化案）DAZNの**アップロードRSS**（`https://www.youtube.com/feeds/videos.xml?channel_id=UCoFLB_Gw_AoxUuuzKjXrc_Q`）を watch-knockout から読んでタイトル一致でRECAPを拾えば、**試合直後に投稿された回はcronで自動取得**できる可能性大（過去分は埋もれるので手動シード併用）。スクレイピング検索より堅い。未実装。

## 完了済みの大きな成果（このセッション）
- **①ハイライト動画復活**：R16/QF が0本だったのを回復（当時FOXで。→ 今DAZNへ移行中）。
- **②トーナメント表モバイル**：国名2行折り返し等。
- **③SEO/GA4監視**：GSC+GA4を毎朝API取得→`docs/seo_daily_report.md`。毎朝07:45に自動起動するRoutineも設定済み（`docs/monetization-strategy.md` が北極星）。
- **④国別42ページのSEO最適化**（title/description/歴史見出し）。
- **⑤試合ページに独自記事「試合の見どころ」を生成**（`scripts/enrich-matches.mjs`）：**246/263件（94%）掲載済み**。アイコン付き注目ポイント集（2〜5個・見出し＋短文）、ネタバレなし、事実ベース。**AdSense「有用性の低いコンテンツ」対策の中核**。
- **⑥動画ラベルのスコア隠し**（`maskLblScores`）＝ネタバレ完全化。
- **⑦試合ページのレイアウト刷新**（見どころ右カラム・ネタバレ切替を上部固定・全幅・内部スクロール廃止）。デスクトップのみ。**モバイルUIは未対応（要今後）**。

## ユーザー側の保留アクション
- **AdSense 再審査のリクエスト**（未実施）：AdSense→サイト→highlight-compass.com→「問題を修正しました」にチェック→「審査をリクエスト」。承認されれば、広告ユニットのスロットIDを `data/ads.json` の `adSlot` に入れて全ページON（現状 `adSlot` 空＝広告非表示＝収益¥0）。
- SEO監視は稼働中（GSC/GA4接続済み・毎朝レポート＋Routine）。

## 残タスク（未完）
- **残り17試合の記事化**（生成が2回失敗した難物。`enrich-matches.yml` を limit 指定で再実行すると数件ずつ回収できる）。AdSense審査には影響小。
- **モバイルUIの作り込み**（試合ページの新レイアウトはデスクトップ前提。モバイルは別途最適化予定）。
- **グローバル/多言語**（`docs/product-vision.md` の長期ビジョン。地域別に最適ハイライトを出し分け＋i18n。まずは日本語のみ）。

## 運用の作法・重要事項（必読）
- **ブランチ**：作業は `claude/new-session-w7tl20`。**最新 origin/main から作り直してから**編集する（`git checkout -B claude/new-session-w7tl20 origin/main`）。**編集→即コミット**（`git checkout -- .` は未コミット変更を消すので、検証後の掃除は `git checkout -- site/ data/matches-index.json` のように対象を限定する）。
- **反映フロー**：branch→PR作成→**squashマージ**→（コード/テンプレ変更なら）`deploy-ftp.yml` 手動実行で本番反映。データだけの自動更新は `wc-knockout.yml`（15分毎）が担う。
- **git author**：`git config user.email noreply@anthropic.com; git config user.name Claude`（検証済みコミットにするため）。
- **FTPデプロイは時々 `Timeout (control socket)` で失敗する**が一時的。**もう一度実行すれば通る**（サーバ側の一時的な接続拒否）。
- **本番サイト/YouTube はこの実行環境から直接アクセス不可**（プロキシのネットワークポリシー）。到達確認は GitHub Actions ランナー側で行う（probe/diag ワークフロー）。ローカルのブラウザ確認は Chromium `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` を Playwright（`createRequire('/opt/node22/lib/node_modules/')`）で。
- **日本語出力は必ず `docs/japanese-style-rules.md` に従う**（既存ページの改訂も含む）。生成プロンプトにも反映済み。
- **ネタバレ防止は絶対条件**：その試合自体の結果（スコア・勝敗・得点者）は出さない。前の試合・過去対戦・移籍はOK。動画は独自ラベル「◯◯ vs ◯◯」表示＋スコアマスク。

## 主要ファイル
- `scripts/build-site.mjs`：静的サイト生成の本体（試合/国/クラブ/ブラケット/index）。`maskLblScores`・`renderPreview`・`POINT_ICONS`・レイアウト等。
- `scripts/enrich-matches.mjs`：見どころ記事生成（Claude API）。`enrich-matches.yml`（手動・limit/ids指定・途中保存＋always-commit）。
- `scripts/watch-knockout.mjs`：決勝T動画の自動検知。`data/wc2026-channels.json`（許可ch）。
- `scripts/verify-results.mjs`／`advance-knockout.mjs`：結果検証／対戦カード自動生成。
- `scripts/fetch_seo_metrics.py`：GSC+GA4レポート（`seo-report.yml` 毎朝）。
- `scripts/deploy.mjs`：FTP差分デプロイ。`deploy-ftp.yml`（手動・全アップ）。
- データ：`data/wc-knockout.json`・`data/match-previews.json`（246件の記事）・`data/matches-index.json`・`data/ads.json`（adSlot空）・`data/analytics.json`（GA4=G-4RVGB3EZDB）。

---
### 更新履歴
- 2026-07-14 初版。決勝T動画のDAZN貼り直し中（検索修正済み・diag確認待ち）。
- 2026-07-14 追記。diag run 29304220662 で真因確定（グローバル検索にDAZN個別RECAPが出ない／FIFAはラウンド語なし＆スコア入り）。対策として `watch-knockout.mjs` に DAZN channelId 内の直接検索（`searchChannelIds`）を追加。次はこのブランチで diag-watch を回して検証。
- 2026-07-14 再追記。channel-scoped検索（diag run 29304639181）でも個別RECAPは発見不可と判明（旧動画・まとめ動画しか返らない）。probe（29304761368）で両IDがDAZN Japanの準々決勝RECAP＝理想ソースと確定。→ **スクレイピング検索は個別RECAPの発見に不適。videoIdの手動シードが確実**と結論。確定2本をqfにシード。残りはユーザーからURLをもらってシードする方針。
- 2026-07-14 デプロイ完了（PR #35 → wc-knockout.yml run 29307163194 成功／FTP成功）。**決勝T動画15本が本番反映**（qf 4・r16 7・r32 4）。保留2枠（カナダvsモロッコ／アルゼンチンvsカーボベルデ）は空のまま維持。cron自動マッチが保留枠をネタバレ動画で埋めないよう、`wc-knockout.json` に `_blocklist`（`sAYjtcpoaf0`＝FIFAスコア入り／`RnuN64r7xhM`＝カーボベルデ勝者バレ／`1M1lVp8b7wY`＝ポルクロ勝者バレ）を追加し、`watch-knockout.mjs` が読むよう対応（PR #36）。その後ユーザーがクリーンなRECAPのURLを提供→カナダvsモロッコ=`vMRBvRT1V30`／アルゼンチンvsカーボベルデ=`FCkYoQcTExM` をシード（PR #37・デプロイ済み）。
- 2026-07-14 **埋め込み再生の問題が判明**：ユーザー（日本）が試合ページで「この動画は、お住まいの国では公開されていません」。**切り分け結果＝地域制限ではなく「埋め込み（シンジケーション）不可」**。当該動画（`-zyPZH9Gung`）は**YouTube直リンクでは日本で普通に再生できる**が、外部iframeでは再生不可（DAZN等のライセンス動画にありがち）。
  - CIからのwatchページ読取（`probe-region.mjs`/`probe-region.yml`・PR #38）は**データセンターIPがbotブロックされ不正確**（全動画UNPLAYABLE表示）＝当てにならない。判定はユーザーの実機が確実。
  - **対策（実装済み・build-site.mjs）**：試合ページのembedに `enablejsapi=1` とid付与＋YouTube IFrame APIの`onError`で `.embedwrap.failed` を付与→**ネタバレなしの「▶ YouTubeで見る」カードへ自動差し替え**。JS/API不達でも詰まないよう常時表示の小リンク`.ytalt`も併置。サムネは出さない（ネタバレ防止）。CSSは共有HEADに追加＝全ページに反映。**要 deploy-ftp.yml で本番反映**（テンプレ変更のためcronの差分デプロイでは出ない）。
  - 未対応：**ホームページ（index.html）側のembedにも同じフォールバックが必要**（試合ページのbuildMatchのみ対応済み。index.htmlは別テンプレなので別途）。またユーザーが「トップのサムネにまたFOXが埋まって見える」と指摘＝**既存R32等の一部videoIdがFOX(米国限定)や埋め込み不可の可能性**。スクショ待ち＋`probe-videos.mjs`でchannel確認して該当をDAZNへ差し替える。
  - **残タスク：sf（フランスvsスペイン/イングランドvsアルゼンチン）は試合後にRECAPをシード。**
