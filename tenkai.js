// ============================================================
// tenkai.js — 展開から着順を予想する(hikitsugi §4-24)
//
//   ① 前受け(スタートを取るライン)  モデル A
//   ② 主導権(最終バックを先頭で通るライン)| 前受け  モデル B   … 前受けのラインが取れば「突っ張り」
//   ③ 1着 | 前受け・主導権  モデル W                       … ①②の全部の筋書きを確率で重ねて 1着率
//   ④ 2着 | 1着  モデル S2 / 3着 | 1・2着  モデル S3        … 1着→2着→3着 の順に予想(3連単の確率)
//   ⑥ ラインで前について行けない(離れる)確率  モデル D        … 表示だけ(予想に足しても当たりは変わらなかった)
//
// ★学習・木は analysis/tenkai(Python・sklearn の HistGradientBoosting)。木は tenkai-model.json。
//   特徴の作り方は analysis/tenkai/tkcore.py と同じ。node tenkaicheck.js で Python と突き合わせる
// ★2022〜2026年9月(約11万レース)で学習。2022〜24年で作って2025〜26年で試すと
//   評価値の順: 1着41.6% 3連単4.4% 3連複14.4% → この予想: 1着44% 3連単11.8% 3連複25.6%
//   (倍率と組み合わせても儲けは増えなかったので、買い方(🔥・モデルD)には使わない。予想印と展開の説明に使う)
//
// 入力 race = { n, bank, klass, seri:[[前,後],…], lines:[[車番,…],…](並び予想の順・前から),
//               R:{ 車番: [脚質, 逃, 捲, 差, マ, S, B, 競走得点, 評価順位, 3連対率, 年齢] } }
// ============================================================
(function (root) {
  "use strict";
  let MODEL = null;
  function load(json) { MODEL = json; return api; }

  function style(nige, maku) { const J = nige + maku; return J <= 2 ? 3 : nige / J >= 0.6 ? 0 : nige / J <= 0.4 ? 2 : 1; }  // 0逃げ型 1両立 2捲り 3自力弱
  const STYLE_NAME = ["逃げ型", "両立型", "捲り型", "自力弱"];
  const KYAKU = { "逃": 0, "両": 1, "追": 2 };

  // 木の計算(sklearn の HistGradientBoosting と同じ: x <= しきい値 なら左、欠けていれば missing_go_to_left)
  function prob(md, x) {
    let s = md.base;
    for (const t of md.trees) {
      let n = 0;
      while (t.f[n] >= 0) {
        const v = x[t.f[n]];
        n = (v == null || Number.isNaN(v)) ? (t.m[n] ? t.l[n] : t.r[n]) : (v <= t.t[n] ? t.l[n] : t.r[n]);
      }
      s += t.v[n];
    }
    return 1 / (1 + Math.exp(-s));
  }
  const vec = (md, o) => md.feats.map((k) => o[k]);
  const P = (name, o) => prob(MODEL.models[name], vec(MODEL.models[name], o));

  // 特徴(tkcore.py / tk_model.py と同じ)
  function features(race) {
    const L = race.lines, R = race.R, nl = L.length;
    const cars = Object.keys(R).map(Number);
    const sc = cars.map((c) => +R[c][7] || 0), m = sc.reduce((a, b) => a + b, 0) / sc.length;
    const sd = Math.sqrt(sc.reduce((a, b) => a + (b - m) * (b - m), 0) / sc.length) || 1;
    const z = (c) => ((+R[c][7] || 0) - m) / sd;
    const big = L.map((x, i) => (x.length >= 2 ? i : -1)).filter((i) => i >= 0);
    const rear = big.length ? Math.max(...big) : nl - 1;
    const base = { n: race.n, nl, ntank: L.filter((x) => x.length === 1).length, bank: race.bank || 400, ks: race.klass === "s" ? 1 : 0, seri: (race.seri || []).length > 0 ? 1 : 0 };
    const lines = L.map((x, i) => {
      const h = R[x[0]], s2 = x.length > 1 ? R[x[1]] : null;
      const zs = x.slice(0, 3).map(z);
      return Object.assign({}, base, {
        pos: i, first: i === 0 ? 1 : 0, rear: i === rear ? 1 : 0, size: x.length, style: style(h[1], h[2]),
        h_nige: h[1], h_maku: h[2], h_S: h[5], h_B: h[6], h_z: z(x[0]), h_rank: h[8], h_kn: h[0] === "逃" ? 1 : 0,
        s_oik: s2 && s2[0] === "追" ? 1 : 0, s_mark: s2 ? s2[4] : 0, s_z: s2 ? z(x[1]) : 0,
        l_best: Math.min(...x.map((c) => R[c][8])), l_z: zs.reduce((a, b) => a + b, 0) / zs.length,
      });
    });
    const riders = [];
    L.forEach((x, i) => x.forEach((c, k) => {
      const q = R[c];
      riders.push(Object.assign({}, base, {
        car: c, li: i, k, role: x.length === 1 ? 3 : Math.min(k, 2), lsize: x.length, lpos: i, lrear: i === rear ? 1 : 0,
        kyaku: KYAKU[q[0]] != null ? KYAKU[q[0]] : 1, nige: q[1], maku: q[2], sashi: q[3], mark: q[4], S: q[5], B: q[6],
        z: z(c), rank: q[8], san: q[9] || 0, age: q[10], lh_style: lines[i].style, lh_z: lines[i].h_z,
      }));
    }));
    return { lines, riders };
  }

  // ⑥ ラインで前の選手について行けない(離れる)確率。番手・3番手…ごと(先頭・単騎は無し)。モデル D
  //   勝敗因が全員に付いているレース(2022〜2026年・約17万人)の「離れ」「千切れ」「続けず」「追えず」「連結外す」で学習。平均 8.4%
  //   (前の選手が離れた「前が離れて」・自分が千切った「捲り千切る」などは数えない)
  function detach(race) {
    if (!MODEL || !MODEL.models.D) return {};
    const L = race.lines, R = race.R, out = {};
    const cars = Object.keys(R).map(Number);
    const sc = cars.map((c) => +R[c][7] || 0), m = sc.reduce((a, b) => a + b, 0) / sc.length;
    const sd = Math.sqrt(sc.reduce((a, b) => a + (b - m) * (b - m), 0) / sc.length) || 1;
    const z = (c) => ((+R[c][7] || 0) - m) / sd;
    const ky = (q) => (KYAKU[q[0]] != null ? KYAKU[q[0]] : 1);
    L.forEach((x, i) => {
      if (x.length < 2) return;
      const h = R[x[0]];
      for (let k = 1; k < x.length; k++) {
        const f = x[k], fr = x[k - 1], q = R[f], p = R[fr];
        out[f] = P("D", { k, size: x.length, pos: i, nl: L.length, n: race.n, bank: race.bank || 400, ks: race.klass === "s" ? 1 : 0,
          f_kyaku: ky(q), f_mark: q[4], f_sashi: q[3], f_nige: q[1], f_maku: q[2], f_S: q[5], f_B: q[6], f_z: z(f), f_rank: q[8], f_san: q[9] || 0, f_age: q[10],
          p_kyaku: ky(p), p_nige: p[1], p_maku: p[2], p_B: p[6], p_z: z(fr), p_age: p[10], p_style: style(p[1], p[2]),
          h_style: style(h[1], h[2]), h_nige: h[1], h_maku: h[2], h_B: h[6], h_z: z(x[0]), h_age: h[10], dz: z(f) - z(fr), dage: q[10] - p[10] });
      }
    });
    return out;
  }

  function predict(race) {
    if (!MODEL) throw new Error("tenkai-model.json が読み込まれていません");
    const { lines, riders } = features(race);
    const nl = lines.length, prune = MODEL.prune || 0.003;
    // ① 前受け
    let pS = lines.map((o) => P("A", o)); const sS = pS.reduce((a, b) => a + b, 0); pS = pS.map((v) => v / sS);
    // ② 主導権 | 前受け
    const pB = [];   // pB[s][b]
    for (let s = 0; s < nl; s++) {
      const S = lines[s];
      let row = lines.map((o) => P("B", Object.assign({}, o, { isS: o.pos === S.pos ? 1 : 0, rel: o.pos - S.pos, S_size: S.size, S_style: S.style, S_hB: S.h_B, S_hnige: S.h_nige, S_hz: S.h_z, S_pos: S.pos })));
      const t = row.reduce((a, b) => a + b, 0); pB.push(row.map((v) => v / t));
    }
    const lead = lines.map((_, b) => pS.reduce((a, ps, s) => a + ps * pB[s][b], 0));   // 主導権を取る確率(全部の筋書き)
    // ③ 筋書きごとの 1着 → 重ねる
    let sc = [];
    for (let s = 0; s < nl; s++) for (let b = 0; b < nl; b++) { const p = pS[s] * pB[s][b]; if (p >= prune) sc.push({ s, b, p }); }
    const tot = sc.reduce((a, x) => a + x.p, 0); sc.forEach((x) => { x.p /= tot; });
    const pw = {}; riders.forEach((r) => { pw[r.car] = 0; });
    for (const x of sc) {
      const B = lines[x.b], S = lines[x.s];
      const w = riders.map((r) => P("W", Object.assign({}, r, { inS: r.li === x.s ? 1 : 0, inB: r.li === x.b ? 1 : 0, tsup: x.s === x.b ? 1 : 0, relB: r.lpos - B.pos,
        B_size: B.size, B_style: B.style, B_hz: B.h_z, S_size: S.size, S_style: S.style })));
      const t = w.reduce((a, b) => a + b, 0);
      x.win = {}; riders.forEach((r, i) => { x.win[r.car] = w[i] / t; pw[r.car] += x.p * w[i] / t; });
    }
    sc.sort((a, b) => b.p - a.p);
    // ④ 2着 | 1着、3着 | 1・2着
    const rel1 = (j, i, sfx) => ({ ["role" + sfx]: i.role, ["lsize" + sfx]: i.lsize, ["z" + sfx]: i.z, ["kyaku" + sfx]: i.kyaku,
      ["same" + sfx]: j.li === i.li ? 1 : 0, ["behind" + sfx]: j.li === i.li && j.k === i.k + 1 ? 1 : 0, ["ahead" + sfx]: j.li === i.li && j.k === i.k - 1 ? 1 : 0, ["dz" + sfx]: j.z - i.z });
    const tri = [];
    for (const i of riders) {
      const js = riders.filter((r) => r !== i);
      let p2 = js.map((j) => P("S2", Object.assign({}, j, rel1(j, i, "_1"), { maku_1: i.maku, nige_1: i.nige })));
      const t2 = p2.reduce((a, b) => a + b, 0); p2 = p2.map((v) => v / t2);
      js.forEach((j, jj) => {
        const ks = js.filter((r) => r !== j);
        let p3 = ks.map((k) => P("S3", Object.assign({}, k, rel1(k, i, "_1"), { maku_1: i.maku, nige_1: i.nige }, rel1(k, j, "_2"), { same12: i.li === j.li ? 1 : 0 })));
        const t3 = p3.reduce((a, b) => a + b, 0);
        ks.forEach((k, kk) => tri.push([i.car, j.car, k.car, pw[i.car] * p2[jj] * p3[kk] / t3]));
      });
    }
    tri.sort((a, b) => b[3] - a[3]);
    const fukuM = {}; for (const [a, b, c, p] of tri) { const key = [a, b, c].sort((x, y) => x - y).join("="); fukuM[key] = (fukuM[key] || 0) + p; }
    const fuku = Object.entries(fukuM).sort((a, b) => b[1] - a[1]);
    const place = {}; riders.forEach((r) => { place[r.car] = [0, 0, 0]; });
    for (const [a, b, c, p] of tri) { place[a][0] += p; place[b][1] += p; place[c][2] += p; }
    const det = detach(race);
    // ラインの上から3人が切れずに続く確率(番手・3番手が離れない)
    const keep3 = race.lines.map((x) => x.slice(1, 3).reduce((a, c) => a * (1 - (det[c] || 0)), 1));
    return { det, keep3, lines: race.lines, lineInfo: lines.map((o) => ({ size: o.size, style: STYLE_NAME[o.style] })), pS, pB, lead, scenarios: sc, pw, place, tri, fuku };
  }

  // 予想印: 3連単の1番手の 1着-2着-3着 に ◎○▲、残りは3着以内の確率の順に △ ×
  function marks(res) {
    const [a, b, c] = res.tri[0];
    const in3 = (car) => res.place[car][0] + res.place[car][1] + res.place[car][2];
    const rest = Object.keys(res.place).map(Number).filter((x) => x !== a && x !== b && x !== c).sort((x, y) => in3(y) - in3(x));
    return [["◎", a], ["○", b], ["▲", c], ["△", rest[0]], ["×", rest[1]]].filter((x) => x[1] != null).map(([m, car]) => ({ mark: m, car, win: res.place[car][0], top3: in3(car) }));
  }

  const api = { load, predict, detach, marks, features, style, STYLE_NAME, get model() { return MODEL; } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TENKAI = api;
})(typeof self !== "undefined" ? self : this);
