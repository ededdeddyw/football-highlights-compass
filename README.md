# Football Highlights Compass

世界中の**公式**サッカーハイライトを、合法リンク・公式埋め込みだけで探しやすくする発見サイト。

> 動画を配るサイトではない。公式が公開している映像を見つけやすくする検索サイトである。

🌐 **公開URL: https://ededdeddyw.github.io/football-highlights-compass/**

## ローカルで動かす / 別端末で再開

```bash
git clone https://github.com/ededdeddyw/football-highlights-compass
cd football-highlights-compass
python -m http.server 8124 --directory site   # ← 必ずhttp。file://だと埋め込みがerror153になる
# ブラウザで http://localhost:8124
```

- `main` にpushすると GitHub Actions が `site/` を自動でPages公開（[.github/workflows/pages.yml](.github/workflows/pages.yml)）。
- 企画書・引き継ぎメモ・メモリは**別の非公開リポジトリ** `football-highlights-compass-planning` にあります（戦略系のため非公開）。再開時はそちらの `handoff.md` を参照。

## このリポジトリの現在地

公開済み（W杯26／Jリーグ／日本人所属クラブの多重ソースサイト）。`site/index.html` が本体で、試合データ（静的 `details.match` ＋ JS内の `EXTRA_WC/JL/CLUB` 配列）を持つ。個別ページは下記スクリプトで生成する。

| ファイル | 役割 |
|---|---|
| [docs/embedding-policy.md](docs/embedding-policy.md) | 埋め込み・引用・サムネのOK/NG判断ルール（**最重要**） |
| [docs/data-schema.md](docs/data-schema.md) | 動画レコードのスキーマ定義（手動運用でもこの形で記録する） |
| [scripts/build-site.mjs](scripts/build-site.mjs) | **個別ページ生成（正準）**。`site/index.html` を純Nodeで直接パースし、試合ページ・国/クラブページ・`article.css`・`sitemap.xml` を生成。Playwright/ローカルサーバ不要。 |
| [scripts/entities.mjs](scripts/entities.mjs) | 国・クラブの歴史／基本情報データ（個別ページ本文に使用） |
| [templates/weekly-japanese-players.md](templates/weekly-japanese-players.md) | 第1号記事「今週の日本人選手 公式ハイライトまとめ」の雛形 |
| [data/videos.sample.csv](data/videos.sample.csv) | スキーマに沿ったCSVのヘッダ＋サンプル行 |

### 個別ページの再生成

```bash
npm run build      # = node scripts/build-site.mjs
```

`site/index.html` を編集（試合を足す等）したら必ず再実行する。生成物（`site/match/`・`site/country/`・`site/club/` の各 `*.html`、`article.css`、`sitemap.xml`）と `index.html` 内 `ENTITY_PAGES` マップが更新される。個別ページは Gizmodo 風のエディトリアルデザイン（`article.css`）。生成物もコミットすること（Actions は `site/` をそのまま配信するため）。

## 運用ルール（最低限）

1. **記事を書く前に必ず [embedding-policy.md](docs/embedding-policy.md) のフローチャートを通す。** NGに1つでも当たれば掲載しない。
2. 掲載した各動画は [data/videos.sample.csv](data/videos.sample.csv) と同じ形で記録する（後でDB化するため）。
3. 迷ったら載せない。「載せない潔さ」がこのサービスのブランド。

## 立ち上げ方針

- 最初の3〜5記事は**ブログ型で手動運用**。記録だけはスキーマJSON/CSVで残す。
- 軌道に乗ったらDB型検索サイトへ移行（データは無駄にならない設計）。
- 差別化の核は3つ: **ロングハイライト特化** / **日本人選手軸** / **ネタバレ防止**。
