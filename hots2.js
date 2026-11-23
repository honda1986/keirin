// ============================================================
// hots2.js — 🔥9車の「2人だけ来る組」の見送り(2026-11-23〜・hikitsugi §4-62)
//   betplan.js(PC の自動投票)・index.html(アプリ)・results.js(夜の成績)で共用
//
//   2人だけ来る組 = 🔥の3人のうち2人を含む、ほかの3連複の組(9車なら18組)。その人気(1/倍率 を全組で割り戻した値)を足したものを s2 とする。
//   倍率が高い🔥ほど人気は散る(s2 は小さくなる)ので、倍率ごとの目安 EXP = A + B × log(🔥の倍率) と比べ、
//   s2 − EXP が TH 以上(= 目安より多い)なら見送る。目安と境目は 2022〜2024 の🔥(今の条件 939点・確定オッズ)で決めた値(上位3分の1)。
//   検証(確定オッズ。今の🔥の条件 = 9車・5〜15倍・切れる確率17%以上・SS無し):
//     2022〜2026/10: 多い 480点 回収96.0%(年ごと 80/90/139/87/89%)・それ以外 949点 139.7%。当たった率は5年とも「多い」が低い
//     2025〜2026(境目を決めたあとの期間): 今の🔥 490点 113.3% +6,540円 → 多いを見送る 323点 126.5% +8,560円
//   ★確定オッズで決めた。本番は締切2分前の倍率で判定する(入れたあとの記録で確かめること)
// ============================================================
(function (root) {
  "use strict";
  const RULE = { A: 0.5773571823529675, B: -0.08768999098900528, TH: 0.021699134142198748 };
  const COMBOS = {};
  function trioCombos(n) {
    if (!COMBOS[n]) { const o = []; for (let a = 1; a <= n; a++) for (let b = a + 1; b <= n; b++) for (let c = b + 1; c <= n; c++) o.push([a, b, c]); COMBOS[n] = o; }
    return COMBOS[n];
  }
  // o: 3連複の全組の倍率(trioCombos(n) の順) / ticket: "a=b=c" → s2(2人だけ来る組の人気の合計)。倍率が無い・組の数が合わないときは null
  function share2(o, n, ticket) {
    const cs = trioCombos(n);
    if (!Array.isArray(o) || o.length !== cs.length || typeof ticket !== "string") return null;
    const t = ticket.split("=").map(Number);
    if (t.length !== 3) return null;
    let tot = 0, s2 = 0, found = false;
    for (let i = 0; i < cs.length; i++) {
      const v = o[i];
      if (!(v > 0 && v < 9999)) continue;
      const q = 1 / v; tot += q;
      const k = cs[i].filter((c) => t.includes(c)).length;
      if (k === 2) s2 += q; else if (k === 3) found = true;
    }
    return tot > 0 && found ? s2 / tot : null;
  }
  // → null(倍率が無い) か { s2, exp(目安), over(s2 − 目安), many(目安より多い = 見送り) }
  function judge(o, n, ticket) {
    const cs = trioCombos(n);
    if (!Array.isArray(o) || o.length !== cs.length) return null;
    const i = cs.findIndex((c) => c.join("=") === ticket);
    const odds = i >= 0 ? o[i] : null;
    if (!(odds > 0 && odds < 9999)) return null;
    const s2 = share2(o, n, ticket);
    if (s2 == null) return null;
    const exp = RULE.A + RULE.B * Math.log(odds), over = s2 - exp;
    return { s2, exp, over, many: over >= RULE.TH, odds };
  }
  const api = { RULE, share2, judge, trioCombos };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HOTS2 = api;
})(typeof window !== "undefined" ? window : this);
