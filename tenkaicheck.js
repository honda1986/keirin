// tenkaicheck.js — tenkai.js(アプリの展開予想)が Python(analysis/tenkai)と同じ確率を出すか。ずれたら終了コード1
"use strict";
const T = require("./tenkai.js").load(require("./tenkai-model.json"));
const X = require("./test/tenkai_fixture.json");
let worst = 0, bad = 0;
for (const x of X) {
  const r = T.predict(x.input);
  for (const [c, v] of Object.entries(x.pw)) worst = Math.max(worst, Math.abs(r.pw[c] - v));
  x.top.forEach(([a, b, c, p], i) => {
    const t = r.tri.find((q) => q[0] === a && q[1] === b && q[2] === c);
    if (!t) { bad++; console.log("組が無い", x.id, a, b, c); return; }
    worst = Math.max(worst, Math.abs(t[3] - p));
    if (i === 0 && (r.tri[0][0] !== a || r.tri[0][1] !== b || r.tri[0][2] !== c)) { bad++; console.log("1番手が違う", x.id, r.tri[0], [a, b, c]); }
  });
}
console.log(`${X.length}レース 差の最大 ${worst.toExponential(2)}`);
if (bad || worst > 1e-5) { console.log("★一致しません"); process.exit(1); }
console.log("一致");
