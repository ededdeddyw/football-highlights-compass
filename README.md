# Football Highlights Compass

世界中の**公式**サッカーハイライトを、合法リンク・公式埋め込みだけで探しやすくする発見サイト。

> 動画を配るサイトではない。公式が公開している映像を見つけやすくする検索サイトである。

## このリポジトリの現在地

Phase 1（手動キュレーション）の土台ドキュメントを整備した段階。コードはまだ無い。

| ファイル | 役割 |
|---|---|
| [docs/embedding-policy.md](docs/embedding-policy.md) | 埋め込み・引用・サムネのOK/NG判断ルール（**最重要**） |
| [docs/data-schema.md](docs/data-schema.md) | 動画レコードのスキーマ定義（手動運用でもこの形で記録する） |
| [templates/weekly-japanese-players.md](templates/weekly-japanese-players.md) | 第1号記事「今週の日本人選手 公式ハイライトまとめ」の雛形 |
| [data/videos.sample.csv](data/videos.sample.csv) | スキーマに沿ったCSVのヘッダ＋サンプル行 |

## 運用ルール（最低限）

1. **記事を書く前に必ず [embedding-policy.md](docs/embedding-policy.md) のフローチャートを通す。** NGに1つでも当たれば掲載しない。
2. 掲載した各動画は [data/videos.sample.csv](data/videos.sample.csv) と同じ形で記録する（後でDB化するため）。
3. 迷ったら載せない。「載せない潔さ」がこのサービスのブランド。

## 立ち上げ方針

- 最初の3〜5記事は**ブログ型で手動運用**。記録だけはスキーマJSON/CSVで残す。
- 軌道に乗ったらDB型検索サイトへ移行（データは無駄にならない設計）。
- 差別化の核は3つ: **ロングハイライト特化** / **日本人選手軸** / **ネタバレ防止**。
