// evdcheck.js — evd.js(モデルD)の期待値が、学習した分析(Python)の値と一致するかを確かめる
//   node evdcheck.js   … test/evd_fixture.json(2026年の30レース・分析で出した全組の期待値)と突き合わせ。ずれたら終了コード1
"use strict";
const E = require("./evd.js");
const F = require("./test/evd_fixture.json");
let worst = 0, combos = 0, bad = 0;
for (const x of F) {
  const all = E.evAll(x.riders, x.lines, x.place, x.o, x.n);
  if (!all) { console.log("計算できない:", x.id); bad++; continue; }
  for (const a of all) {
    const want = x.ev[a.ticket];
    if (want == null) { console.log("分析に無い組:", x.id, a.ticket); bad++; continue; }
    worst = Math.max(worst, Math.abs(a.ev - want)); combos++;
  }
}
console.log(`${F.length}レース ${combos}組 期待値の差の最大 ${worst.toExponential(2)}`);
if (bad || worst > 1e-9) { console.log("★一致しません"); process.exit(1); }
console.log("一致");
