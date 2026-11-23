// ============================================================
// hotloc.js — 🔥(本命ライン3人)の「地元の位置」(2026-11-23〜・hikitsugi §4-66)
//   betplan.js(PC の自動投票)・index.html(アプリ)・results.js(夜の成績)で共用
//
//   地元 = 選手の府県が開催場の府県と同じ。本命ライン(並び予想で🔥の3人が先頭から3人そろうライン)の
//     code 1 = 先頭が地元 / 2 = 先頭は地元でなく、番手か3番手が地元 / 0 = 3人とも地元でない / null = 分からない(府県が無い・並びと合わない)
//   2022〜2026/10(確定オッズ・作り直した出走表)とアプリの記録(2025-01〜2026-10):
//     🔥9車(今の条件) code 2: 119点 175.0%(138/131/206/175/222%)・アプリ 45点 223.1% / code 0: 678点 134.6%・アプリ 113.7% / code 1: 129.6%・アプリ 125.4%
//     🔥7車(確定9〜15倍・少ない) code 2: 294点 139.2%・アプリ 81点 131.5% / code 1: 198点 87.4%・アプリ 38点 53.7% / code 0: 101.7%・アプリ 109.6%
//   → 🔥9車は code 2 なら金額を増やす(既定2倍)・🔥7車は code 1 なら見送り、code 2 のときだけ買う(設定。既定はそうする)
//   ★確定オッズで確かめた。締切前の倍率では数ポイント下がる
// ============================================================
(function (root) {
  "use strict";
  const VP = { "函館": "北海道", "青森": "青森", "いわき平": "福島", "弥彦": "新潟", "前橋": "群馬", "取手": "茨城", "宇都宮": "栃木", "大宮": "埼玉", "西武園": "埼玉",
    "京王閣": "東京", "立川": "東京", "松戸": "千葉", "千葉": "千葉", "川崎": "神奈川", "平塚": "神奈川", "小田原": "神奈川", "伊東": "静岡", "静岡": "静岡",
    "名古屋": "愛知", "岐阜": "岐阜", "大垣": "岐阜", "豊橋": "愛知", "富山": "富山", "松阪": "三重", "四日市": "三重", "福井": "福井", "奈良": "奈良",
    "向日町": "京都", "和歌山": "和歌山", "岸和田": "大阪", "玉野": "岡山", "広島": "広島", "防府": "山口", "高松": "香川", "小松島": "徳島", "高知": "高知",
    "松山": "愛媛", "小倉": "福岡", "久留米": "福岡", "武雄": "佐賀", "佐世保": "長崎", "別府": "大分", "熊本": "熊本" };
  const NAME = { 0: "地元なし", 1: "先頭が地元", 2: "番手か3番手が地元" };
  // lines: 並び予想(前から) / pref: { 車番: 府県 } / place: 開催場 / ticket: "a=b=c"(🔥の3連複)
  function codeOf(lines, pref, place, ticket) {
    const vp = VP[place];
    if (!vp || !Array.isArray(lines) || !pref || typeof ticket !== "string") return null;
    const t = ticket.split("=").map(Number);
    if (t.length !== 3) return null;
    const ln = lines.find((l) => Array.isArray(l) && t.every((c) => l.includes(c)));
    if (!ln || ln.length < 3 || !ln.slice(0, 3).every((c) => t.includes(c))) return null;
    const p = ln.slice(0, 3).map((c) => pref[c]);
    if (p.some((v) => typeof v !== "string" || !v)) return null;
    return p[0] === vp ? 1 : p[1] === vp || p[2] === vp ? 2 : 0;
  }
  // riders(races.json・history.json の riders。[車番, 年齢, 期, ライン内位置, 評価順位, 評価点, 競走得点, 府県, …])→ { 車番: 府県 }。府県が無い古い形なら null
  function prefOfRiders(riders) {
    if (!Array.isArray(riders) || !riders.length || !riders.every((r) => Array.isArray(r) && typeof r[7] === "string")) return null;
    const o = {}; for (const r of riders) o[r[0]] = r[7]; return o;
  }
  const api = { VP, NAME, codeOf, prefOfRiders };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HOTLOC = api;
})(typeof window !== "undefined" ? window : this);
