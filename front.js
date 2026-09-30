// ============================================================
// front.js — 初手の前受け(どのラインがスタートで前を取るか)の予想(hikitsugi §4-16)。fetch.js(Node)とアプリで共用
//
//   並び予想のラインの中身は本番も同じだが、ラインの前後(初手の位置)は本番で入れ替わることがある。
//   正解 = Kドリームスの結果の表の S(スタートを取った選手)のライン。2022-01〜2026-09 の10.4万レースで学習(analysis/front)。
//   ラインごとの条件付きロジット: そのレースのラインの中で、どれが前受けするかの確率。
//   前の年までで作って次の年で試すと 64〜67%(並び予想の先頭ラインのままだと 61〜64%)、自信のある上位1/3 は 82〜85%。
//
//   いちばん効くのはラインの選手の S率(S回数÷着度数の合計)。次に単騎(前を取りにくい)・人数・予想の順番。
//   ★係数を変えたら analysis/front と突き合わせる(node frontcheck.js)
// ============================================================
(function (root) {
  "use strict";
  const B = { pred_front: 0.533741, pred_last: 0.17905, pos_rel: -0.318897, size2: 0.33173, size3: 0.60356, size4: 0.66849, solo: -1.60378,
    head_nige: 0.380811, head_ryo: 0.263335, s_max: 2.179842, s_head: 0.954876, s_2nd: 1.120738, b_head: 0.373468, nige_head: -0.211251,
    score_z: 0.186476, best_rank1: 0.131297, has_rank1: 0.11805 };

  // lines: 並び予想のライン(前から順) [[6,1,9],[4,3,8],...] / E: 車番 → { kyaku:"逃|両|追", S, B, starts(着度数の合計), score(競走得点), rank(評価順位), nige(逃げ回数) }
  // → ラインごとの前受け確率(lines と同じ順)。ラインが2本未満・全員単騎・選手が欠けていれば null
  function probs(lines, E) {
    if (!Array.isArray(lines) || lines.length < 2 || lines.every((l) => l.length === 1)) return null;
    const cars = Object.keys(E).map(Number);
    if (lines.some((l) => l.some((c) => !E[c]))) return null;
    const sc = cars.map((c) => E[c].score || 0);
    const m = sc.reduce((a, b) => a + b, 0) / sc.length;
    const sd = Math.sqrt(sc.reduce((a, b) => a + (b - m) * (b - m), 0) / sc.length) || 1;
    let rank1 = null;
    for (const c of cars.slice().sort((a, b) => a - b)) if (rank1 == null || (E[c].rank || 9) < (E[rank1].rank || 9)) rank1 = c;
    const rate = (c, k) => (E[c].starts > 0 ? (E[c][k] || 0) / E[c].starts : 0);
    const n = lines.length;
    const u = lines.map((x, i) => {
      const h = x[0], ky = E[h].kyaku;
      const f = {
        pred_front: i === 0 ? 1 : 0, pred_last: i === n - 1 ? 1 : 0, pos_rel: i / (n - 1),
        size2: x.length === 2 ? 1 : 0, size3: x.length === 3 ? 1 : 0, size4: x.length >= 4 ? 1 : 0, solo: x.length === 1 ? 1 : 0,
        head_nige: ky === "逃" ? 1 : 0, head_ryo: ky === "両" ? 1 : 0,
        s_max: Math.max(...x.map((c) => rate(c, "S"))), s_head: rate(h, "S"), s_2nd: x.length > 1 ? rate(x[1], "S") : 0,
        b_head: rate(h, "B"), nige_head: (E[h].nige || 0) / Math.max(1, E[h].starts || 0),
        score_z: (x.reduce((a, c) => a + (E[c].score || 0), 0) / x.length - m) / sd,
        best_rank1: Math.min(...x.map((c) => E[c].rank || 9)) / 9, has_rank1: x.includes(rank1) ? 1 : 0,
      };
      return Object.keys(B).reduce((a, k) => a + B[k] * f[k], 0);
    });
    const mx = Math.max(...u), e = u.map((v) => Math.exp(v - mx)), s = e.reduce((a, b) => a + b, 0);
    return e.map((v) => v / s);
  }
  // parseCard の entries(engine.js)と評価順位から E を作る
  function fromEntries(entries, rankOf) {
    const E = {};
    for (const e of entries || []) {
      const st = e.seiseki ? (e.seiseki.win1 || 0) + (e.seiseki.win2 || 0) + (e.seiseki.win3 || 0) + (e.seiseki.out || 0) : 0;
      E[e.car] = { kyaku: e.kyaku, S: e.S || 0, B: e.B || 0, starts: st, score: e.score || 0, rank: (rankOf && rankOf[e.car]) || 9, nige: (e.k && e.k.nige) || 0 };
    }
    return E;
  }
  const api = { probs, fromEntries, COEF: B };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FRONT = api;
})(typeof window !== "undefined" ? window : this);
