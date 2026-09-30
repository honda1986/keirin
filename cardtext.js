// ============================================================
// cardtext.js — Kドリームスのレース詳細ページ(HTML)を、parseCard が読めるテキストにする
//   fetch.js(今日の出走表)・scorefill.js(過去の出走表から得点を埋める)・pastcard.js(過去の出走表の作り直し)が使う
// ============================================================
"use strict";
// ---- HTML → テキスト ----
function htmlToText(html) {
  let s = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<img\b[^>]*\balt\s*=\s*["']([^"']*)["'][^>]*>/gi, (_, a) => {
    const v = a.replace(/\s+/g, " ").trim(); return /^[1-9]$/.test(v) ? v : " "; });
  s = s.replace(/<(br|\/tr|\/td|\/th|\/p|\/div|\/li|\/h[1-6]|\/option|\/a|\/span)\b[^>]*>/gi, "\n")
       .replace(/<[^>]+>/g, " ")
       .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
       .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return " "; } });
  // 空白は2個までは残す。並び予想は「空白2個」でラインを区切っているので、
  // 1個につぶすと 1 7 4  8 2  5 6 3 → 1 7 4 8 2 5 6 3 になり並びが消える。
  return s.replace(/\u00a0/g, " ").replace(/\t/g, " ").replace(/ {2,}/g, "  ");
}

// ---- 並び予想は「色付きの番号チップ」で書かれている ----
//   <div class="line_position">
//     <span class="icon_p"><span class="p001">1</span><span class="p201">先行</span></span>
//     <span class="icon_p"><span class="p007">7</span><span class="p105">追込</span></span>
//     <span class="icon_p space"></span>          ← ★ラインの切れ目(中身が空)
//     <span class="icon_p bracket_open">(</span> 5 4 <span class="icon_p bracket_close">)</span> ← 競り(2人が同じ位置を競る)
//     <span class="icon_p"><span class="p008">8</span><span class="p202">押え先</span></span>
//     ...
//   </div>
// 普通にタグを消すと空の span が消えて区切りが失われるので、
// HTML→テキストに渡す前に「← 1 7 4・8 2・5 6 3」という1行に置き換えておく。
// 競りのカッコは残す:「← 1・3 (5 4) (6 2)・7」(2026-09-30 まではカッコを捨てていた)
function narabiFromHtml(html) {
  const m = String(html).match(/<div[^>]*class="[^"]*line_position[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return null;
  const parts = m[1].split(/<span[^>]*\bclass\s*=\s*"([^"]*icon_p[^"]*)"[^>]*>/i);
  const groups = []; let cur = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const cls = parts[i] || "", body = parts[i + 1] || "";
    if (/(^|[\s])space([\s]|$)/.test(cls)) { if (cur.length) { groups.push(cur); cur = []; } continue; }
    if (/bracket_open/.test(cls)) { cur.push("("); continue; }
    if (/bracket_close/.test(cls)) { cur.push(")"); continue; }
    const d = body.replace(/<[^>]+>/g, " ").match(/[1-9]/);
    if (d) cur.push(d[0]);
  }
  if (cur.length) groups.push(cur);
  if (!groups.length) return null;
  return "← " + groups.map((g) => g.join(" ").replace(/\( /g, "(").replace(/ \)/g, ")")).join("・");
}
function withNarabiText(html) {
  const s = narabiFromHtml(html);
  if (!s) return html;
  // <br> にしておくと HTML→テキストで必ず独立した1行になる
  return String(html).replace(/<div[^>]*class="[^"]*line_position[^"]*"[^>]*>[\s\S]*?<\/div>/i, "<br>" + s + "<br>");
}

// ---- ページは4万字あるので、予想に必要な部分だけ残す(races.json を太らせないため) ----
const PROF = /^[^\/\s]{1,6}[\s　]?[^\/\s]{0,6}\/\d{1,2}\/\d{1,3}$/;
function compactCard(text, place, raceNo) {
  const L = text.split("\n").map((x) => x.trim()).filter(Boolean);
  const out = [place + "競輪 レース詳細"];
  const dl = L.find((x) => /^\d{4}年\d{1,2}月\d{1,2}日/.test(x));
  out.push((dl ? dl.replace(/\s+/g, " ") : "") + " レース詳細 " + raceNo);
  const gl = L.find((x) => /[ＳＡＬSAL]級/.test(x) && x.length <= 24);
  if (gl) out.push(gl);
  const si = L.findIndex((x) => /^発走予定/.test(x));
  if (si >= 0) { out.push(L[si]); if (L[si + 1]) out.push(L[si + 1]); }
  const seen = new Set();
  for (let i = 2; i < L.length; i++) {
    if (!PROF.test(L[i])) continue;
    const car = parseInt(L[i - 2], 10);
    if (!(car >= 1 && car <= 9)) continue;
    if (seen.has(car)) break;                 // 2周目(別タブの繰り返し)に入ったら終わり
    seen.add(car);
    for (let j = Math.max(0, i - 3); j <= i + 18 && j < L.length; j++) out.push(L[j]);
  }
  const ni = L.findIndex((x) => /並び予想/.test(x) && x.length <= 40);
  if (ni >= 0) for (let j = ni; j < Math.min(L.length, ni + 45); j++) { out.push(L[j]); if (/^レース評/.test(L[j])) break; }
  return out.join("\n");
}

module.exports = { htmlToText, narabiFromHtml, withNarabiText, compactCard };
