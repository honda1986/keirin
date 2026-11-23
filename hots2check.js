// hots2.js の突き合わせ(test/hots2_fixture.json = 分析で Python が出した s2 と「多い」か)。node hots2check.js
"use strict";
const H = require("./hots2.js");
const fx = require("./test/hots2_fixture.json");
let bad = 0, max = 0;
for (const r of fx.rows) {
  const x = H.judge(r.o, r.n, r.ticket);
  if (!x) { bad++; console.log("✗", r.id, "判定できない"); continue; }
  max = Math.max(max, Math.abs(x.s2 - r.s2));
  if (Math.abs(x.s2 - r.s2) > 1e-9 || x.many !== r.many) { bad++; console.log("✗", r.id, x.s2, r.s2, x.many, r.many); }
}
const r0 = fx.rows[0];
if (H.judge(r0.o.slice(1), r0.n, r0.ticket) !== null) { bad++; console.log("✗ 組の数が合わないのに判定した"); }
const o2 = r0.o.slice(); o2[H.trioCombos(r0.n).findIndex((c) => c.join("=") === r0.ticket)] = 0;
if (H.judge(o2, r0.n, r0.ticket) !== null) { bad++; console.log("✗ 🔥の倍率が無いのに判定した"); }
console.log(bad ? "✗ 合わない " + bad + " 件" : "✓ " + fx.rows.length + "点で一致(s2 の差の最大 " + max.toExponential(1) + ")・倍率が無い例 2つも OK");
process.exitCode = bad ? 1 : 0;
