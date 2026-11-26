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
//   ★2026-11-23(hikitsugi §4-63): 7車立ても。7車は「2人だけ来る組が少ない(下から3分の1)」ときだけ買う(RULE7。目安と境目は 2022〜2024 の
//     7車の本命ライン3人・4〜15倍・競りなし 16,083点で決めた)。7車の本命ライン3人(4〜15倍)は全部で 88.7%(24,564点)・少ない 99.7%(8,249点)・
//     2025〜2026 は 100.7%。もうけはほぼゼロなので、買うかは今までどおり設定(既定は買わない)
//   ★確定オッズで決めた。本番は締切2分前の倍率で判定する(入れたあとの記録で確かめること)
//   ★2026-11-23(hikitsugi §4-65): 7車は 9〜15倍だけにした(BAND7)。「少ない」の中で 9〜15倍は 2,447点 105.0%(4〜9倍は 96%)。
//     買うときの倍率は確定までに1〜2割下がる(締切前の記録 2,020R: 確定÷買うとき 4〜15倍で 0.79〜0.84)ので、
//     締切前の倍率で買うときは 10〜15倍(loPre・hiPre)。上限を上げないのは、確定15〜17倍の「少ない」が 70.2%(450点)と悪いから。
//     過去5年にこの動きを当てはめて買うときの決まりをまねると: 買うとき10〜15倍 102.9% / 9〜15倍 102.8% / 10.5〜17.5倍(確定に合わせた帯) 98.8%
//     「少ない」の境目はずらさない(買うときは s2 が少し多めに出る = 少しきびしくなる。まねると、そのほうが回収は少し高い)
// ============================================================
(function (root) {
  "use strict";
  const RULE = { A: 0.5773571823529675, B: -0.08768999098900528, TH: 0.021699134142198748 };      // 9車(8車以上): over ≥ TH なら見送り
  const RULE7 = { A: 0.5679384083863769, B: -0.07853322957752044, TH: -0.05164880051609013 };    // 7車: over < TH(少ない)のときだけ買う
  // 7車の倍率の帯: 確定オッズで数えるとき lo〜hi / 締切前の倍率(買うとき)で決めるとき loPre〜hiPre(2026-11-23〜・hikitsugi §4-65)
  const BAND7 = { lo: 9, hi: 15, loPre: 10, hiPre: 15 };
  // ★2026-11-26(hikitsugi §4-72): 本命ラインの番手か3番手が地元(hotloc.js の code 2・先頭は地元でない)の7車は 締切前5〜15倍(確定で数えるとき 4〜15倍)。
  //   2人だけ来る組が少ない・地元の番手の7車は 5〜9倍でもプラス(確定4〜15倍: 2022〜24 116.6%・2025〜26 134.8%)。
  //   倍率の動きを当てはめて締切前の帯をまねると: 10〜15倍 104.5%(215点)/149.4%(70点) → 5〜15倍 106.5%(677点)/132.0%(259点)。点数は約3倍
  const BAND7L = { lo: 4, hi: 15, loPre: 5, hiPre: 15 };
  const band7Of = (loc) => (loc === 2 ? BAND7L : BAND7);
  const inBand7 = (odds, pre, loc) => { const B = band7Of(loc); return odds != null && odds >= (pre ? B.loPre : B.lo) && odds <= (pre ? B.hiPre : B.hi); };
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
  // → null(倍率が無い・6車以下) か { s2, exp(目安), over(s2 − 目安), many(目安より多い), few(目安よりずっと少ない), skip(見送り) }
  //   9車(8車以上): skip = many / 7車: skip = !few(少ないときだけ買う)
  function judge(o, n, ticket) {
    if (!(n >= 7)) return null;
    const R = n >= 8 ? RULE : RULE7;
    const cs = trioCombos(n);
    if (!Array.isArray(o) || o.length !== cs.length) return null;
    const i = cs.findIndex((c) => c.join("=") === ticket);
    const odds = i >= 0 ? o[i] : null;
    if (!(odds > 0 && odds < 9999)) return null;
    const s2 = share2(o, n, ticket);
    if (s2 == null) return null;
    const exp = R.A + R.B * Math.log(odds), over = s2 - exp;
    const many = over >= RULE.TH && n >= 8, few = n === 7 && over < RULE7.TH;
    return { s2, exp, over, many, few, skip: n >= 8 ? many : !few, odds };
  }
  const api = { RULE, RULE7, BAND7, BAND7L, band7Of, inBand7, share2, judge, trioCombos };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HOTS2 = api;
})(typeof window !== "undefined" ? window : this);
