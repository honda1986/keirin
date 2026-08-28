// ============================================================
// diagcard.js v6 — 「並び予想」がHTMLでどう書かれているかだけを見る
//                  (読むだけ。ファイルは一切書き換えません)
//
//   ワークフロー「評価値」の cmd 欄に:
//       node diagcard.js
//   場を指定したいとき:
//       node diagcard.js --place=玉野
//   出す件数(既定2レース):
//       node diagcard.js --races=3
//
//   並びは色付きの番号チップで描かれているので、
//   ・チップ1個がどのタグか
//   ・ライン(隊列)の切れ目がどのタグ/文字で表されているか
//   を生HTMLで確認する。
// ============================================================
"use strict";
const { TRACK_NAMES } = require("./bankdata.js");

const VENUE_PIDS = [11,12,13,21,22,23,24,25,26,27,28,31,32,34,35,36,37,38,42,43,44,45,46,47,48,51,53,54,55,56,61,62,63,71,73,74,75,81,83,84,85,86,87];
const PID2NAME = {};
if (TRACK_NAMES.length === VENUE_PIDS.length) TRACK_NAMES.forEach((n, i) => { PID2NAME[VENUE_PIDS[i]] = n; });

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith("--" + k + "=")); return a ? a.split("=")[1] : d; };

async function get(url) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 25000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: c.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally { clearTimeout(t); }
}

// 今の fetch.js と同じ変換(比較用)
function htmlToTextNow(html) {
  let s = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<img\b[^>]*\balt\s*=\s*["']([^"']*)["'][^>]*>/gi, (_, a) => {
    const v = a.replace(/\s+/g, " ").trim(); return /^[1-9]$/.test(v) ? v : " "; });
  s = s.replace(/<(br|\/tr|\/td|\/th|\/p|\/div|\/li|\/h[1-6]|\/option|\/a|\/span)\b[^>]*>/gi, "\n")
       .replace(/<[^>]+>/g, " ")
       .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
       .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return " "; } });
  return s.replace(/ /g, " ").replace(/\t/g, " ").replace(/ {2,}/g, "  ");
}

(async () => {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const d = arg("date", jst.toISOString().slice(0, 10));
  const idx = await get(`https://keirin.kdreams.jp/odds/${d.slice(0,4)}/${d.slice(5,7)}/${d.slice(8,10)}/`);
  const seen = new Set(); let list = [];
  for (const m of idx.matchAll(/\/([a-z]+)\/racedetail\/(\d{16})\//g)) {
    if (seen.has(m[2])) continue; seen.add(m[2]);
    const pid = parseInt(m[2].slice(0, 2), 10), rno = parseInt(m[2].slice(-4), 10);
    const place = PID2NAME[pid];
    if (!place || !(rno >= 1 && rno <= 12)) continue;
    list.push({ place, rno, url: `https://keirin.kdreams.jp/${m[1]}/racedetail/${m[2]}/` });
  }
  const pl = arg("place", "");
  if (pl) list = list.filter((x) => x.place === pl);
  list = list.slice(0, parseInt(arg("races", "2"), 10));
  console.log("対象日", d, "/ 調べるレース", list.length, "件");

  for (const it of list) {
    console.log("\n################################################");
    console.log("#", it.place, it.rno + "R");
    console.log("#", it.url);
    console.log("################################################");
    let html;
    try { html = await get(it.url); }
    catch (e) { console.log("取得失敗:", e.message); continue; }

    const i = html.indexOf("並び予想");
    if (i < 0) { console.log("HTMLに「並び予想」が無い"); continue; }

    // ---- (A) 生HTML ----
    const chunk = html.slice(i, i + 2600);
    console.log("\n──── (A) 生HTML(並び予想の直後 2600文字) ────");
    console.log(chunk.replace(/></g, ">\n<"));

    // ---- (B) 今の変換をかけた結果 ----
    const L = htmlToTextNow(html).split("\n").map((x) => x.replace(/^ +| +$/g, ""));
    const ni = L.findIndex((x) => x.trim() === "並び予想");
    console.log("\n──── (B) いまのHTML→テキストで「並び予想」の後 40行 ────");
    if (ni < 0) console.log("テキスト側で「並び予想」の行が見つからない");
    else for (let j = ni; j < Math.min(L.length, ni + 40); j++) {
      console.log(String(j - ni).padStart(3) + "| " + (L[j] === "" ? "(空行)" : L[j].replace(/ /g, "␣")));
    }
    await sleep(300);
  }
  console.log("\n以上。(A)でラインの切れ目がどう書かれているかを確認します。");
})();
