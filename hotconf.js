// ============================================================
// hotconf.js — 🔥9車の「朝の自信度」(出走表の予想印の◎の位置 × 本命ラインの地元の位置。2026-11-24〜・hikitsugi §4-67)
//   fetch.js(出走表から印を読む)・index.html(アプリの「今日の自信度」)・results.js(夜の成績)で共用
//
//   予想印 = Kドリームスのレース詳細の出走表に付いている記者の印(◎○▲△×注)。倍率は使わないので朝から分かる
//   ◎の位置(pos): 本命ライン(🔥の3人がそろうライン)の 1 = 先頭 / 2 = 番手 / 3 = 3番手 / 4 = ほかのライン / null = 分からない(印が無い)
//   自信度(level): 3 = ◎◎ とても自信(◎が先頭・地元が番手か3番手) / 2 = ◎ 自信(◎が先頭) / 1 = △ ふつう(◎がほかのライン・3番手) / 0 = × 見送り候補(◎が番手)
//   🔥9車(SS無し・切れる確率17%以上)を倍率を見ずに買ったとき(払い戻しは確定の配当そのもの):
//     過去データ 2022〜2026/10(作り直した出走表の印):
//       3: 226点 137.9%(73/130/163/215/134%)・2: 1,151点 120.4%(130/95/135/117/132%)・1: 400点 104.8%(120/96/148/41/112%)・0: 591点 88.8%(81/73/120/77/92%)
//     アプリの記録 2025-01〜2026-10: 3: 96点 154.4%・2: 447点 109.4%・1: 185点 137.4%(的中8.6%)・0: 254点 91.2%(2025 91.5% / 2026 90.9%)
//   → 表示だけ(自動投票は変えない)。7車は倍率を見ないとどう分けても85%前後なので出さない
//   ★1番車の印: 出走表を短くしたテキスト(races.json の raw)には入らない。fetch.js はページ全体のテキストから読む。
//     読めなかったときは「◎○▲△× のうち1つだけ誰にも付いていない」ならそれを1番車の印とみなす(過去の出走表で約92%合う)
// ============================================================
(function (root) {
  "use strict";
  const MK = ["◎", "○", "▲", "△", "×", "注"];
  const MAIN = ["◎", "○", "▲", "△", "×"];
  const PROF = /^[^\/\s]{1,6}[\s　]?[^\/\s]{0,6}\/\d{1,2}\/\d{1,3}$/;   // 府県/年齢/期(cardtext.js と同じ)
  // 出走表のテキスト → { cm: { 車番: 印 }, inferred: 1番車の印を推定したか }
  //   並びは「印・枠番・車番・名前・府県/年齢/期」の順(印の無い選手は印の行が無い)。2周目(別タブの繰り返し)に入ったら終わり
  function marksFromText(text) {
    const L = String(text || "").split("\n").map((x) => x.trim()).filter(Boolean);
    const cm = {}, seen = new Set();
    for (let i = 4; i < L.length; i++) {
      if (!PROF.test(L[i]) || !/^[1-9]$/.test(L[i - 2]) || !/^[1-9]$/.test(L[i - 3])) continue;
      const car = +L[i - 2];
      if (seen.has(car)) break;
      seen.add(car);
      if (MK.includes(L[i - 4])) cm[car] = L[i - 4];
    }
    let inferred = false;
    const used = new Set(Object.values(cm)), miss = MAIN.filter((m) => !used.has(m));
    if (seen.has(1) && cm[1] == null && used.size && miss.length === 1) { cm[1] = miss[0]; inferred = true; }
    return { cm, inferred, cars: seen.size };
  }
  // { 車番: 印 } ⇔ "◎3○5▲1△7×2"(races.json・history.json にはこの形で残す)
  function toStr(cm) {
    if (!cm) return "";
    return MK.flatMap((m) => Object.keys(cm).filter((c) => cm[c] === m).map((c) => m + c)).join("");
  }
  function parse(s) {
    const o = {};
    if (typeof s !== "string") return o;
    for (const m of s.matchAll(/([◎○▲△×注])([1-9])/g)) o[+m[2]] = m[1];
    return o;
  }
  // ◎の位置。lines: 並び予想(前から) / ticket: "a=b=c"(🔥の3連複) / cm: { 車番: 印 } か "◎3○5…"
  function posOf(lines, ticket, cm) {
    const o = typeof cm === "string" ? parse(cm) : cm || {};
    const hon = Object.keys(o).find((c) => o[c] === "◎");
    if (hon == null || !Array.isArray(lines) || typeof ticket !== "string") return null;
    const t = ticket.split("=").map(Number);
    if (t.length !== 3) return null;
    const ln = lines.find((l) => Array.isArray(l) && t.every((c) => l.includes(c)));
    if (!ln || ln.length < 3) return null;
    const h = +hon;
    return h === ln[0] ? 1 : h === ln[1] ? 2 : h === ln[2] ? 3 : 4;
  }
  // 自信度。pos: posOf の値 / loc: hotloc.js の codeOf(2 = 番手か3番手が地元・先頭は違う)
  function level(pos, loc) {
    if (pos == null) return null;
    return pos === 1 ? (loc === 2 ? 3 : 2) : pos === 2 ? 0 : 1;
  }
  const LV = {
    3: { mk: "◎◎", name: "とても自信", why: "◎が先頭・地元が番手か3番手", roi: "5年 137.9%・アプリの記録 154.4%" },
    2: { mk: "◎", name: "自信", why: "◎が先頭", roi: "5年 120.4%・アプリの記録 109.4%" },
    1: { mk: "△", name: "ふつう", why: "◎がほかのライン", roi: "5年 104.8%・当たりにくい（的中8%）が配当が大きい。年でばらつく" },
    0: { mk: "×", name: "見送り候補", why: "◎が番手", roi: "5年 88.8%・アプリの記録 91.2%" },
  };
  const POS_NAME = { 1: "◎が先頭", 2: "◎が番手", 3: "◎が3番手", 4: "◎がほかのライン" };
  const api = { MK, marksFromText, toStr, parse, posOf, level, LV, POS_NAME };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HOTCONF = api;
})(typeof window !== "undefined" ? window : this);
