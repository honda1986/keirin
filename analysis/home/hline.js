// ============================================================
// analysis/home/hline.js — バックを取るラインの予測に H が効くか(ライン1本 = 1行の CSV を作る。hikitsugi §4-48)
//
// 並びは history.json の lines(その日の予想に使った並び予想)。成績と結果は wtrec(WINTICKET の当時の出走表と結果)。
// 2人以上のラインごとに、先頭の B率・H率・S率・逃げ率・捲り率(回数 ÷ 着度数の合計)、ライン長、
// 番手(チャレンジは先頭)の競走得点 − 中央値、番手が年上か、と「そのラインがバックを取ったか」を書く。
// engine.js の backProb と同じ材料(+ H・S・逃げ・捲り)。fit は hline.py
//
// 使い方: node analysis/home/hline.js <wtrec のフォルダ> <出力.csv>
// ============================================================
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const K = path.join(__dirname, "..", "..");
const [WR, OUT] = process.argv.slice(2);
if (!WR || !OUT) { console.error("使い方: node analysis/home/hline.js <wtrec dir> <out.csv>"); process.exit(1); }
const H = {};
for (const e of JSON.parse(fs.readFileSync(path.join(K, "history.json"), "utf8")).entries) H[e.date + "_" + e.place + "_" + e.raceNo] = e;
const rows = ["id,date,klass,n,nlines,len,bR,hR,sR,nigeR,makuriR,starts,gdiff,older,won"];
let races = 0, noB = 0;
for (const f of fs.readdirSync(WR).filter((x) => /^wtrec-\d{6}\.json\.gz$/.test(x)).sort()) {
  const W = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(WR, f))).toString("utf8"));
  for (const [id, w] of Object.entries(W)) {
    const h = H[id];
    if (!h || !Array.isArray(h.lines)) continue;
    const C = {}; for (const c of w.c || []) if (!c[1]) C[c[0]] = c;
    const age = {}; for (const rd of h.riders || []) age[rd[0]] = rd[1];
    const bCar = ((w.r || []).find((x) => x[5]) || [])[0];
    if (!bCar) { noB++; continue; }
    const lines = h.lines.map((l) => l.filter((c) => C[c])).filter((l) => l.length >= 2);
    if (lines.length < 2) continue;
    const pts = Object.values(C).map((c) => c[9]).filter((v) => v > 0).sort((a, b) => a - b);
    const med = pts.length ? (pts.length % 2 ? pts[(pts.length - 1) / 2] : (pts[pts.length / 2 - 1] + pts[pts.length / 2]) / 2) : 0;
    races++;
    for (const l of lines) {
      const hd = C[l[0]], sc = C[l[1]];
      const st = (hd[12] || 0) + (hd[13] || 0) + (hd[14] || 0) + (hd[15] || 0);
      const r = (v) => (st > 0 ? ((v || 0) / st).toFixed(4) : "0");
      const g = h.klass === "challenge" ? hd : sc;
      rows.push([id, id.slice(0, 8), h.klass || "", Object.keys(C).length, lines.length, l.length, r(hd[4]), r(hd[3]), r(hd[2]), r(hd[5]), r(hd[6]), st,
        (g[9] > 0 ? (g[9] - med).toFixed(2) : "0"), (age[l[1]] || 0) > (age[l[0]] || 0) ? 1 : 0, l.includes(bCar) ? 1 : 0].join(","));
    }
  }
}
fs.writeFileSync(OUT, rows.join("\n") + "\n");
console.log("レース", races, "/ ライン", rows.length - 1, "/ B の記録が無いレース", noB);
