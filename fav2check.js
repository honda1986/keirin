// fav2.js の突き合わせ(test/fav2_fixture.json = 学習に使った Python の式で出した見込み)。node fav2check.js
"use strict";
const FAV2 = require("./fav2.js");
const fx = require("./test/fav2_fixture.json");
let bad = 0, max = 0;
for (const r of fx.races) {
  const E = {}; for (const [k, v] of Object.entries(r.E)) E[+k] = v;
  const j = FAV2.judge({ n: r.n, place: r.place, lines: r.lines, E }, r.o);
  if (!j || j.ticket !== r.ticket || j.odds !== r.odds) { bad++; console.log("✗", r.id, "1番人気が合わない", j && j.ticket, r.ticket); continue; }
  const d = Math.max(Math.abs(j.p - r.p), Math.abs(j.p0 - r.p0)); max = Math.max(max, d);
  if (d > 1e-9) { bad++; console.log("✗", r.id, j.p, r.p, j.p0, r.p0); }
}
// 当てはまらない例: 2倍より上・1番人気が2組・倍率の数が合わない
const r0 = fx.races[0], E0 = {}; for (const [k, v] of Object.entries(r0.E)) E0[+k] = v;
const o2 = r0.o.slice(); const i0 = o2.indexOf(Math.min(...o2.filter((v) => v > 0))); o2[i0] = 2.1; for (let i = 0; i < o2.length; i++) if (o2[i] > 0 && o2[i] < 2.1) o2[i] = 2.2;
if (FAV2.judge({ n: r0.n, place: r0.place, lines: r0.lines, E: E0 }, o2) !== null) { bad++; console.log("✗ 2倍より上なのに出した"); }
const o3 = r0.o.slice(); const j3 = o3.indexOf(r0.odds); const k3 = o3.findIndex((v, i) => i !== j3 && v > 0); o3[k3] = r0.odds;
if (FAV2.judge({ n: r0.n, place: r0.place, lines: r0.lines, E: E0 }, o3) !== null) { bad++; console.log("✗ 1番人気が2組なのに出した"); }
if (FAV2.judge({ n: r0.n, place: r0.place, lines: r0.lines, E: E0 }, r0.o.slice(1)) !== null) { bad++; console.log("✗ 倍率の数が合わないのに出した"); }
console.log(bad ? "✗ 合わない " + bad + " 件" : "✓ " + fx.races.length + "レースで一致(差の最大 " + max.toExponential(1) + ")・当てはまらない例 3つも OK");
process.exitCode = bad ? 1 : 0;
