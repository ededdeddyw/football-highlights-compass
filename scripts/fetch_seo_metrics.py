"""GSC（Search Console）+ GA4 を API で取得し、日次 SEO レポートを生成する。

GitHub Actions のスケジュール（毎朝）で実行する想定。ローカルでも実行可。
これにより「スクショを貼る」運用が不要になり、Claude はレポート起点で改善を回せる。

必要な環境変数:
  GOOGLE_APPLICATION_CREDENTIALS … サービスアカウント JSON キーのパス
  GSC_SITE_URL    … 例 "https://pet-er.jp/"（GSC プロパティ URL・末尾スラッシュ）
  GA4_PROPERTY_ID … 例 "541301582"（GA4 プロパティ ID・数字のみ）

出力:
  docs/seo_daily_report.md      … 最新スナップショット + 推移 + 自動ハイライト（毎回上書き）
  docs/seo_metrics_history.csv  … 主要指標の履歴（毎回1行追記・推移用）

依存（Actions でインストール）:
  google-api-python-client google-auth google-analytics-data
"""
from __future__ import annotations

import csv
import datetime
import os
import traceback
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
REPORT = BASE / "docs" / "seo_daily_report.md"
HISTORY = BASE / "docs" / "seo_metrics_history.csv"

SITE = os.environ.get("GSC_SITE_URL", "").strip()
GA4 = os.environ.get("GA4_PROPERTY_ID", "").strip()

GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly"


def _sa_credentials(scopes):
    from google.oauth2 import service_account

    key = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    if not key or not Path(key).exists():
        raise RuntimeError("GOOGLE_APPLICATION_CREDENTIALS が未設定/不在")
    return service_account.Credentials.from_service_account_file(key, scopes=scopes)


# ── GSC ──────────────────────────────────────────────────────────
def _gsc_service():
    from googleapiclient.discovery import build

    return build("searchconsole", "v1", credentials=_sa_credentials([GSC_SCOPE]), cache_discovery=False)


def _gsc_query(service, start, end, dimensions=None, row_limit=1):
    body = {"startDate": start, "endDate": end, "rowLimit": row_limit}
    if dimensions:
        body["dimensions"] = dimensions
    return service.searchanalytics().query(siteUrl=SITE, body=body).execute()


def _gsc_totals(service, start, end):
    r = _gsc_query(service, start, end, dimensions=None, row_limit=1)
    rows = r.get("rows", [])
    if not rows:
        return {"clicks": 0, "impressions": 0, "ctr": 0.0, "position": 0.0}
    row = rows[0]
    return {
        "clicks": int(row.get("clicks", 0)),
        "impressions": int(row.get("impressions", 0)),
        "ctr": float(row.get("ctr", 0.0)),
        "position": float(row.get("position", 0.0)),
    }


def _gsc_rows(service, start, end, dim, limit=15):
    r = _gsc_query(service, start, end, dimensions=[dim], row_limit=limit)
    out = []
    for row in r.get("rows", []):
        keys = row.get("keys", [""])
        out.append({
            "key": keys[0],
            "clicks": int(row.get("clicks", 0)),
            "impressions": int(row.get("impressions", 0)),
            "position": float(row.get("position", 0.0)),
        })
    return out


def _gsc_index_counts(service):
    """サイトマップの submitted/indexed（インデックス件数の目安）。best-effort。"""
    try:
        lst = service.sitemaps().list(siteUrl=SITE).execute()
    except Exception:
        return None
    submitted = indexed = 0
    for sm in lst.get("sitemap", []):
        for c in sm.get("contents", []):
            submitted += int(c.get("submitted", 0) or 0)
            indexed += int(c.get("indexed", 0) or 0)
    return {"submitted": submitted, "indexed": indexed}


# ── GA4 ──────────────────────────────────────────────────────────
def _ga_client():
    from google.analytics.data_v1beta import BetaAnalyticsDataClient

    return BetaAnalyticsDataClient(credentials=_sa_credentials([GA_SCOPE]))


def _ga_report(client, dimensions, metrics, start="28daysAgo", end="today", limit=15):
    from google.analytics.data_v1beta.types import (
        DateRange, Dimension, Metric, RunReportRequest,
    )

    req = RunReportRequest(
        property=f"properties/{GA4}",
        date_ranges=[DateRange(start_date=start, end_date=end)],
        dimensions=[Dimension(name=d) for d in dimensions],
        metrics=[Metric(name=m) for m in metrics],
        limit=limit,
    )
    resp = client.run_report(req)
    rows = []
    for row in resp.rows:
        rows.append({
            "dims": [dv.value for dv in row.dimension_values],
            "mets": [mv.value for mv in row.metric_values],
        })
    return rows


# ── レポート組み立て ──────────────────────────────────────────────
def _fmt_pct(x):
    return f"{x * 100:.1f}%"


def _load_history():
    if not HISTORY.exists():
        return []
    with HISTORY.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _append_history(row):
    fields = ["date", "clicks7", "impr7", "ctr7", "pos7", "indexed", "ga_users28", "ga_sessions28", "ga_engage28"]
    exists = HISTORY.exists()
    HISTORY.parent.mkdir(parents=True, exist_ok=True)
    with HISTORY.open("a", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        if not exists:
            w.writeheader()
        w.writerow({k: row.get(k, "") for k in fields})


def _delta(cur, prev):
    if prev in ("", None):
        return ""
    try:
        d = float(cur) - float(prev)
    except ValueError:
        return ""
    if abs(d) < 1e-9:
        return "→"
    return f"↑{d:g}" if d > 0 else f"↓{abs(d):g}"


def main():
    today = datetime.date.today()
    end = today.isoformat()
    d7 = (today - datetime.timedelta(days=7)).isoformat()
    d28 = (today - datetime.timedelta(days=28)).isoformat()

    errors = []
    gsc = {"t7": None, "t28": None, "queries": [], "pages": [], "index": None}
    ga = {"channels": [], "pages": [], "totals": None}

    # GSC
    try:
        svc = _gsc_service()
        gsc["t7"] = _gsc_totals(svc, d7, end)
        gsc["t28"] = _gsc_totals(svc, d28, end)
        gsc["queries"] = _gsc_rows(svc, d28, end, "query", 15)
        gsc["pages"] = _gsc_rows(svc, d28, end, "page", 15)
        gsc["index"] = _gsc_index_counts(svc)
    except Exception as e:  # noqa: BLE001
        errors.append("GSC: " + str(e))
        traceback.print_exc()

    # GA4
    try:
        cli = _ga_client()
        ga["channels"] = _ga_report(
            cli, ["sessionDefaultChannelGroup"],
            ["sessions", "engagedSessions", "averageSessionDuration"], limit=10)
        ga["pages"] = _ga_report(
            cli, ["pagePath"], ["screenPageViews", "activeUsers", "userEngagementDuration"], limit=15)
        tot = _ga_report(cli, [], ["activeUsers", "sessions", "engagementRate", "averageSessionDuration"], limit=1)
        ga["totals"] = tot[0]["mets"] if tot else None
    except Exception as e:  # noqa: BLE001
        errors.append("GA4: " + str(e))
        traceback.print_exc()

    # 履歴に追記
    t7 = gsc["t7"] or {}
    idx = gsc["index"] or {}
    ga_tot = ga["totals"] or []
    hist_row = {
        "date": end,
        "clicks7": t7.get("clicks", ""),
        "impr7": t7.get("impressions", ""),
        "ctr7": round(t7.get("ctr", 0.0), 4) if t7 else "",
        "pos7": round(t7.get("position", 0.0), 1) if t7 else "",
        "indexed": idx.get("indexed", ""),
        "ga_users28": ga_tot[0] if len(ga_tot) > 0 else "",
        "ga_sessions28": ga_tot[1] if len(ga_tot) > 1 else "",
        "ga_engage28": ga_tot[2] if len(ga_tot) > 2 else "",
    }
    prev = _load_history()
    prev_row = prev[-1] if prev else {}
    _append_history(hist_row)
    history = _load_history()

    # レポート Markdown
    lines = []
    lines.append("# SEO 日次レポート（自動生成）")
    lines.append("")
    lines.append("> `scripts/fetch_seo_metrics.py`（GitHub Actions 毎朝）が自動生成。")
    lines.append("> Claude はこのファイルを読んで改善案を出す。手動編集は次回実行で上書きされる。")
    lines.append(f"> 最終更新: {end}")
    if errors:
        lines.append("")
        lines.append("**⚠️ 取得エラー**: " + " / ".join(errors))
    lines.append("")

    # ハイライト
    lines.append("## 📌 ハイライト（前回比）")
    if gsc["t7"]:
        lines.append(f"- クリック(7日): **{t7['clicks']}** {_delta(t7['clicks'], prev_row.get('clicks7'))}")
        lines.append(f"- 表示(7日): **{t7['impressions']}** {_delta(t7['impressions'], prev_row.get('impr7'))}")
        lines.append(f"- 平均順位(7日): **{t7['position']:.1f}** {_delta(round(t7['position'],1), prev_row.get('pos7'))}（数字が小さいほど上位）")
        lines.append(f"- CTR(7日): **{_fmt_pct(t7['ctr'])}**")
    if idx:
        lines.append(f"- サイトマップ indexed: **{idx.get('indexed','?')}** / submitted {idx.get('submitted','?')} {_delta(idx.get('indexed',''), prev_row.get('indexed'))}")
    if ga["totals"]:
        lines.append(f"- GA ユーザー(28日): **{ga_tot[0]}** / セッション {ga_tot[1] if len(ga_tot)>1 else '?'}")
    lines.append("")

    # GSC 上位クエリ
    lines.append("## 🔎 検索クエリ 上位（28日）")
    if gsc["queries"]:
        lines.append("| クエリ | クリック | 表示 | 平均順位 |")
        lines.append("|---|---:|---:|---:|")
        for q in gsc["queries"]:
            lines.append(f"| {q['key']} | {q['clicks']} | {q['impressions']} | {q['position']:.1f} |")
    else:
        lines.append("（データなし）")
    lines.append("")

    # GSC 上位ページ
    lines.append("## 📄 表示された上位ページ（28日）")
    if gsc["pages"]:
        lines.append("| ページ | クリック | 表示 | 平均順位 |")
        lines.append("|---|---:|---:|---:|")
        for p in gsc["pages"]:
            path = p["key"].replace(SITE.rstrip("/"), "") or "/"
            lines.append(f"| {path} | {p['clicks']} | {p['impressions']} | {p['position']:.1f} |")
    else:
        lines.append("（データなし）")
    lines.append("")

    # GA チャネル
    lines.append("## 🚪 流入チャネル（GA・28日）")
    if ga["channels"]:
        lines.append("| チャネル | セッション | エンゲージ | 平均滞在(秒) |")
        lines.append("|---|---:|---:|---:|")
        for c in ga["channels"]:
            m = c["mets"]
            dur = f"{float(m[2]):.0f}" if len(m) > 2 else "?"
            lines.append(f"| {c['dims'][0]} | {m[0]} | {m[1] if len(m)>1 else '?'} | {dur} |")
    else:
        lines.append("（データなし・GA未接続なら設定を確認）")
    lines.append("")

    # GA ページ
    lines.append("## 👀 よく見られたページ（GA・28日）")
    if ga["pages"]:
        lines.append("| ページ | 表示 | ユーザー | 合計滞在(秒) |")
        lines.append("|---|---:|---:|---:|")
        for p in ga["pages"]:
            m = p["mets"]
            lines.append(f"| {p['dims'][0]} | {m[0]} | {m[1] if len(m)>1 else '?'} | {m[2] if len(m)>2 else '?'} |")
    else:
        lines.append("（データなし）")
    lines.append("")

    # 推移（履歴末尾10行）
    lines.append("## 📈 推移（直近）")
    lines.append("| 日付 | クリック7 | 表示7 | 順位7 | indexed | GAユーザー28 |")
    lines.append("|---|---:|---:|---:|---:|---:|")
    for h in history[-10:]:
        lines.append(f"| {h.get('date','')} | {h.get('clicks7','')} | {h.get('impr7','')} | {h.get('pos7','')} | {h.get('indexed','')} | {h.get('ga_users28','')} |")
    lines.append("")

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {REPORT} (errors={len(errors)})")
    # エラーがあっても部分レポートは出す。全滅時のみ非0で失敗通知。
    if errors and not gsc["t7"] and not ga["channels"]:
        raise SystemExit("GSC/GA どちらも取得失敗: " + " / ".join(errors))


if __name__ == "__main__":
    main()
