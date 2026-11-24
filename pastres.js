// ============================================================
// pastres.js — 全レースの結果(着順・配当)を、pastcard ブランチの res-YYYYMM.json.gz に月ごとに書く(2026-11-24〜・hikitsugi §4-69)
//
// アプリの「レース」タブで過去の日を選ぶと、その日の全レースの出走表(pcraw・dayraw)から予想を開く。そこに結果を添えるため。
//   daily.json の res は🔥・Ⓓ・Ⓐを買ったレースの分しか無いので、全レースの分はここから読む。
//   形: { "YYYYMMDD_場名_1R": [1着, 2着, 3着, 3連複の配当, 3連単の配当, 2車単の配当] }(daily.json の res と同じ並び。分からなければ null)
//   ★結果だけ(予想・買い目は入れない)。history.json から作る
//
// 使い方: node pastres.js <pastcard ブランチを出したフォルダ> [--all]
//   ふつう(毎晩 results.yml): 直近3日の月と、まだファイルが無い月を書く / --all: 全部の月を書き直す
//   gzip の中身が同じなら同じバイト列になる(書いても git の差分は出ない)
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT = process.argv[2];
const ALL = process.argv.includes("--all");
if (!OUT || !fs.existsSync(OUT)) { console.error("使い方: node pastres.js <pastcard ブランチのフォルダ> [--all]"); process.exit(1); }
const hist = JSON.parse(fs.readFileSync(path.join(__dirname, "history.json"), "utf8")).entries || [];
const v = (x) => (x == null || x === "" ? null : x);
const byMonth = {};
for (const e of hist) {
  if (!e || !e.date || !e.place || !e.raceNo || e.f == null) continue;
  const d8 = String(e.date).replace(/-/g, "");
  if (!/^\d{8}$/.test(d8)) continue;
  (byMonth[d8.slice(0, 6)] = byMonth[d8.slice(0, 6)] || {})[d8 + "_" + e.place + "_" + e.raceNo] =
    [v(e.f), v(e.s), v(e.t), v(e.p3fpay), v(e.p3pay), v(e.p2pay)];
}
const dates = [...new Set(hist.map((e) => String(e.date || "").replace(/-/g, "")).filter((d) => /^\d{8}$/.test(d)))].sort();
const recent = new Set(dates.slice(-3).map((d) => d.slice(0, 6)));
let wrote = 0;
for (const ym of Object.keys(byMonth).sort()) {
  const f = path.join(OUT, "res-" + ym + ".json.gz");
  if (!ALL && !recent.has(ym) && fs.existsSync(f)) continue;
  const obj = byMonth[ym], keys = Object.keys(obj).sort(), sorted = {};
  for (const k of keys) sorted[k] = obj[k];
  fs.writeFileSync(f, zlib.gzipSync(JSON.stringify(sorted), { level: 9 }));
  wrote++;
  console.log("res-" + ym + ".json.gz:", keys.length, "レース");
}
console.log("結果のファイル:", wrote, "か月分を書きました(全部で", Object.keys(byMonth).length, "か月)");
