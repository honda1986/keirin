// ============================================================
// cardtext.js — Kドリームスのレース詳細ページ(HTML)を、parseCard が読めるテキストにする
//   fetch.js(今日の出走表)と scorefill.js(過去の出走表から得点を埋める)が使う
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
//     <span class="icon_p"><span class="p008">8</span><span class="p202">押え先</span></span>
//     ...
//   </div>
// 普通にタグを消すと空の span が消えて区切りが失われるので、
// HTML→テキストに渡す前に「← 1 7 4・8 2・5 6 3」という1行に置き換えておく。
function narabiFromHtml(html) {
  const m = String(html).match(/<div[^>]*class="[^"]*line_position[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return null;
  const parts = m[1].split(/<span[^>]*\bclass\s*=\s*"([^"]*icon_p[^"]*)"[^>]*>/i);
  const groups = []; let cur = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const cls = parts[i] || "", body = parts[i + 1] || "";
    if (/(^|[\s])space([\s]|$)/.test(cls)) { if (cur.length) { groups.push(cur); cur = []; } continue; }
    const d = body.replace(/<[^>]+>/g, " ").match(/[1-9]/);
    if (d) cur.push(d[0]);
  }
  if (cur.length) groups.push(cur);
  if (!groups.length) return null;
  return "← " + groups.map((g) => g.join(" ")).join("・");
}
function withNarabiText(html) {
  const s = narabiFromHtml(html);
  if (!s) return html;
  // <br> にしておくと HTML→テキストで必ず独立した1行になる
  return String(html).replace(/<div[^>]*class="[^"]*line_position[^"]*"[^>]*>[\s\S]*?<\/div>/i, "<br>" + s + "<br>");
}

module.exports = { htmlToText, narabiFromHtml, withNarabiText };
