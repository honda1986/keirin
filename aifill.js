// ============================================================
// aifill.js — 過去のレースの history.json に AI予想の4車(ai)を足す(Ⓐの成績をさかのぼって出すため・hikitsugi §4-50)
//
// AI予想は wtrec ブランチの wtai-YYYYMM.json.gz(wtai.js が取った。2025-01〜)。2026-11-03 からは races.json → results.js が入れる。
// 既に ai があるレースは触らない。件数が減ったら書かない(履歴を消さない安全装置)。
//
// 使い方: node aifill.js <wtai のフォルダ> [--apply]
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const DIR = process.argv[2], APPLY = process.argv.includes("--apply");
if (!DIR || !fs.existsSync(DIR)) { console.error("使い方: node aifill.js <wtai のフォルダ> [--apply]"); process.exit(1); }
const AI = {};
for (const f of fs.readdirSync(DIR).filter((x) => /^wtai-\d{6}\.json\.gz$/.test(x))) {
  try { Object.assign(AI, JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR, f))).toString("utf8"))); } catch (e) { console.error("読めない:", f, e.message); }
}
const histPath = path.join(__dirname, "history.json");
const hist = JSON.parse(fs.readFileSync(histPath, "utf8"));
const before = hist.entries.length;
let added = 0, had = 0, none = 0;
for (const e of hist.entries) {
  if (Array.isArray(e.ai) && e.ai.length === 4) { had++; continue; }
  const a = AI[e.date + "_" + e.place + "_" + e.raceNo];
  if (Array.isArray(a) && a.length === 4) { e.ai = a; added++; } else none++;
}
console.log("AI予想", Object.keys(AI).length, "レース / history", before, "件: 足した", added, "/ 既にあった", had, "/ 無い", none);
if (hist.entries.length < before) { console.error("件数が減っています。書き込まずに中止します。"); process.exit(1); }
if (!APPLY) { console.log("点検のみのため書き込みませんでした。--apply を付けると書き込みます。"); process.exit(0); }
if (added) { fs.writeFileSync(histPath, JSON.stringify(hist)); console.log("history.json を書き込みました"); }
