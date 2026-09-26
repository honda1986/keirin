// ============================================================
// odds2parse.js — Kドリームスのオッズ画面から 2車単・2車複 を読む(odds2.js と snap.js で共用)
//
// 1つのページに全種別のオッズ表が入っている(2026-09-26 に確認)。3連複のページ
// (kakeshikiType=3renhuku)からも 2車単・2車複 が読める。
//   2車単: 「4-1 3.1」の並び(1着-2着)。3連単の「4-1-3」は拾わない
//   2車複: 「1=4 2.3」の並び。3連複の「1=2=3」は拾わない
// 並び順: 2車単 1-2, 1-3, …, 1-n, 2-1, … / 2車複 1=2, 1=3, …, (n-1)=n
// ============================================================
"use strict";

const toText = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&gt;/g, ">").replace(/\s+/g, " ");

const ORDERED = { "2t": true, "2f": false };

function combos2(kind, n) {
  const o = [];
  for (let a = 1; a <= n; a++) for (let b = 1; b <= n; b++) {
    if (a === b) continue;
    if (ORDERED[kind]) o.push(a + "-" + b);
    else if (a < b) o.push(a + "=" + b);
  }
  return o;
}

// text は toText 済みでもよい(同じページを何種類も読むとき、変換を1回で済ませる)
function parse2(kind, htmlOrText) {
  const text = /</.test(htmlOrText) ? toText(htmlOrText) : htmlOrText;
  const out = new Map();
  const sep = ORDERED[kind] ? "(?:-|－|→|>)" : "(?:=|＝)";
  const re = new RegExp("(?<![=＝\\-－→>]\\s*)(?<![\\d.,])(\\d)\\s*" + sep + "\\s*(\\d)(?!\\s*[=＝\\-－→>]\\s*\\d)[^\\d]{0,24}?([\\d,]+(?:\\.\\d+)?)", "g");
  let m;
  while ((m = re.exec(text))) {
    const a = +m[1], b = +m[2];
    if (a === b || a < 1 || b < 1) continue;
    const v = parseFloat(m[3].replace(/,/g, ""));
    if (!isFinite(v) || v <= 0) continue;
    const key = ORDERED[kind] ? a + "-" + b : Math.min(a, b) + "=" + Math.max(a, b);
    if (!out.has(key)) out.set(key, v);
  }
  return out;
}

// n 車立ての並びで配列にする(無い組は null)
function array2(kind, htmlOrText, n) {
  const map = parse2(kind, htmlOrText);
  return combos2(kind, n).map((k) => (map.has(k) ? map.get(k) : null));
}

module.exports = { toText, combos2, parse2, array2 };
