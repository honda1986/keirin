// frontcheck.js — front.js(前受けの予想)が分析(Python・analysis/front)の確率と一致するか。ずれたら終了コード1
"use strict";
const F = require("./front.js");
const X = require("./test/front_fixture.json");
let worst = 0, bad = 0;
for (const x of X) {
  const E = {};
  for (const [c, v] of Object.entries(x.E)) E[c] = { kyaku: v[0], S: v[1], B: v[2], starts: v[3], score: v[4], rank: v[5], nige: v[6] };
  const p = F.probs(x.lines, E);
  if (!p) { console.log("計算できない:", x.id); bad++; continue; }
  p.forEach((v, i) => { worst = Math.max(worst, Math.abs(v - x.p[i])); });
}
console.log(`${X.length}レース 差の最大 ${worst.toExponential(2)}`);
if (bad || worst > 1e-6) { console.log("★一致しません"); process.exit(1); }
console.log("一致");
