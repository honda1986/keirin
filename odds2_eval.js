// ============================================================
// odds2_eval.js — 2車単・2車複の検証(2026-09-26)。結果は hikitsugi.md §4-5
//
//   git fetch origin odds2 && mkdir -p /tmp/odds2 && git archive origin/odds2 | tar -x -C /tmp/odds2
//   node --max-old-space-size=12000 odds2_eval.js . /tmp/odds2      (20〜30分かかる)
//
// 1. 市場の癖(倍率帯ごと・全組を買ったときの回収率)
// 2. 🔥の本命ラインから作る2車の買い目
// 3. 期待値: P(組) ∝ exp(a·log倍率 + b·log倍率² + 選手の特徴)。条件付きロジットを 2025 年で作り 2026 年で測る
// history.json と odds2 ブランチ(odds2.js が書く)だけを使う。furoito は使わない
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const K = process.argv[2], O = process.argv[3];
const { f3PlanFrom } = require(path.join(K, "engine.js"));

const H = JSON.parse(fs.readFileSync(path.join(K, "history.json"), "utf8")).entries;
const odds = { "2t": {}, "2f": {} };
for (const f of fs.readdirSync(O)) {
  const m = f.match(/^o(2t|2f)-(\d{6})\.json$/);
  if (!m) continue;
  Object.assign(odds[m[1]], JSON.parse(fs.readFileSync(path.join(O, f), "utf8")).races);
}
console.log("history", H.length, "/ 2車単", Object.keys(odds["2t"]).length, "/ 2車複", Object.keys(odds["2f"]).length);

const pairs = (kind, n) => { const o = []; for (let a = 1; a <= n; a++) for (let b = 1; b <= n; b++) { if (a === b) continue; if (kind === "2t" || a < b) o.push([a, b]); } return o; };
const rankedOf = (e) => [...e.riders].sort((a, b) => (a[4] || 99) - (b[4] || 99)).map((r) => r[0]);
const yr = (e) => e.id.slice(0, 4);
const pct = (r, b) => (b ? (100 * r / b).toFixed(1) : "-");

// ---- レースごとの材料 ----
const R = [];
for (const e of H) {
  if (!e.f || !e.s || !Array.isArray(e.riders) || !e.riders.length || !Array.isArray(e.lines)) continue;
  const n = e.riders.length;
  const o2t = odds["2t"][e.id], o2f = odds["2f"][e.id];
  if (!o2t && !o2f) continue;
  const rk = rankedOf(e);
  const pl = f3PlanFrom(rk, e.lines);
  // 選手の特徴
  const pos = {}, len = {}, head = {}, next = {};
  for (const l of e.lines) l.forEach((c, i) => { pos[c] = i; len[c] = l.length; if (i === 0) head[c] = true; if (i + 1 < l.length) next[c] = l[i + 1]; });
  const scoreRank = {};
  [...e.riders].sort((a, b) => (b[6] || 0) - (a[6] || 0)).forEach((r, i) => { scoreRank[r[0]] = i + 1; });
  const feat = {};
  for (const r of e.riders) {
    const c = r[0], ll = len[c] || 1, lp = pos[c] ?? 0;
    feat[c] = {
      er: r[4] || 5,                       // 評価順位
      single: ll === 1 ? 1 : 0,
      head: ll >= 2 && lp === 0 ? 1 : 0,   // ラインの先頭
      banme: ll >= 2 && lp === 1 ? 1 : 0,
      third: lp >= 2 ? 1 : 0,
      age50: (r[1] || 0) >= 50 ? 1 : 0,
      young: (r[2] || 0) >= 121 ? 1 : 0,
      sr: scoreRank[c] || 5,
    };
  }
  R.push({ id: e.id, y: yr(e), n, f: e.f, s: e.s, p2pay: e.p2pay, o2t, o2f, pl, rk, feat, next, lines: e.lines });
}
console.log("使えるレース", R.length, "(2025:", R.filter((r) => r.y === "2025").length, "/ 2026:", R.filter((r) => r.y === "2026").length, ")");

// ---- 1. 市場の癖: 倍率帯ごとの回収率(全組を100円ずつ買ったら) ----
function calib(kind) {
  const bands = [[1, 2], [2, 3], [3, 5], [5, 8], [8, 12], [12, 20], [20, 35], [35, 60], [60, 100], [100, 200], [200, 1e9]];
  for (const y of ["2025", "2026"]) {
    const acc = bands.map(() => ({ b: 0, r: 0, h: 0 }));
    for (const x of R) {
      if (x.y !== y) continue;
      const o = kind === "2t" ? x.o2t : x.o2f;
      if (!o) continue;
      const ps = pairs(kind, o.cars);
      ps.forEach(([a, b], i) => {
        const v = o.o[i];
        if (!(v > 0)) return;
        const bi = bands.findIndex(([lo, hi]) => v >= lo && v < hi);
        if (bi < 0) return;
        const hit = kind === "2t" ? a === x.f && b === x.s : (a === Math.min(x.f, x.s) && b === Math.max(x.f, x.s));
        acc[bi].b += 100; acc[bi].h += hit ? 1 : 0; acc[bi].r += hit ? v * 100 : 0;
      });
    }
    console.log(`  ${y}: ` + bands.map(([lo, hi], i) => `${lo}〜${hi > 1e8 ? "" : hi}倍 ${pct(acc[i].r, acc[i].b)}%`).join(" / "));
  }
}
console.log("\n==== 1. 市場の癖(倍率帯ごと・全組を買ったときの回収率) ====");
console.log("2車単"); calib("2t");
console.log("2車複"); calib("2f");

// ---- 2. 🔥(本命ライン)から作る買い目 ----
function rule(name, kind, pick, filt) {
  for (const y of ["2025", "2026"]) {
    let n = 0, ret = 0, hit = 0;
    for (const x of R) {
      if (x.y !== y || !filt(x)) continue;
      const o = kind === "2t" ? x.o2t : x.o2f;
      if (!o) continue;
      const t = pick(x);
      if (!t) continue;
      const [a, b] = t;
      const ps = pairs(kind, o.cars);
      const i = ps.findIndex(([p, q]) => kind === "2t" ? p === a && q === b : p === Math.min(a, b) && q === Math.max(a, b));
      const v = i >= 0 ? o.o[i] : null;
      if (!(v > 0)) continue;
      if (x.band && !(v >= x.band[0] && v <= x.band[1])) continue;
      n++;
      const h = kind === "2t" ? a === x.f && b === x.s : Math.min(a, b) === Math.min(x.f, x.s) && Math.max(a, b) === Math.max(x.f, x.s);
      if (h) { hit++; ret += v * 100; }
    }
    console.log(`  ${name} ${y}: ${n}R 的中${pct(hit, n)}% 回収${pct(ret, n * 100)}%`);
  }
}
console.log("\n==== 2. 🔥の本命ラインから作る買い目(1レース1点) ====");
const hot = (x) => x.pl && x.pl.hot;
const hot9 = (x) => hot(x) && x.n >= 8, hot7 = (x) => hot(x) && x.n === 7;
const all = (x) => x.pl && x.pl.trio;
const h2 = (x) => x.pl && x.pl.trio ? [x.pl.trio[0], x.pl.trio[1]] : null;
const h2r = (x) => x.pl && x.pl.trio ? [x.pl.trio[1], x.pl.trio[0]] : null;
rule("2車単 先頭→番手 🔥9車", "2t", h2, hot9);
rule("2車単 先頭→番手 🔥7車", "2t", h2, hot7);
rule("2車単 番手→先頭 🔥9車", "2t", h2r, hot9);
rule("2車単 番手→先頭 🔥7車", "2t", h2r, hot7);
rule("2車単 先頭→番手 本命ライン3人以上の全レース", "2t", h2, all);
rule("2車複 先頭=番手 🔥9車", "2f", h2, hot9);
rule("2車複 先頭=番手 🔥7車", "2f", h2, hot7);
rule("2車複 先頭=番手 本命ライン3人以上の全レース", "2f", h2, all);
const top2 = (x) => [x.rk[0], x.rk[1]];
rule("2車単 評価1位→2位 全レース", "2t", top2, () => true);
rule("2車複 評価1位=2位 全レース", "2f", top2, () => true);

// ---- 3. 期待値(市場の曲がり＋選手の特徴)。2025年で作って2026年で測る ----
const FEATS = ["er", "single", "head", "banme", "third", "age50", "young", "sr"];
function rows(kind, x) {
  const o = kind === "2t" ? x.o2t : x.o2f;
  if (!o || !o.o || o.cars !== x.n) return null;
  const ps = pairs(kind, o.cars);
  const out = [];
  let win = -1, valid = 0;
  ps.forEach(([a, b], i) => {
    const v = o.o[i];
    if (!(v > 0 && v < 9999)) return;
    valid++;
    const fa = x.feat[a], fb = x.feat[b];
    if (!fa || !fb) return;
    const lo = -Math.log(v);
    let z;
    if (kind === "2t") z = [lo, lo * lo, ...FEATS.map((k) => fa[k]), ...FEATS.map((k) => fb[k]), x.next[a] === b ? 1 : 0, x.next[b] === a ? 1 : 0];
    else z = [lo, lo * lo, ...FEATS.map((k) => fa[k] + fb[k]), x.next[a] === b || x.next[b] === a ? 1 : 0];
    const hit = kind === "2t" ? a === x.f && b === x.s : a === Math.min(x.f, x.s) && b === Math.max(x.f, x.s);
    if (hit) win = out.length;
    out.push({ a, b, v, z: Float64Array.from(z), hot: x.pl && x.pl.hot, trio: x.pl && x.pl.trio, n: x.n });
  });
  if (win < 0 || valid < ps.length * 0.8) return null;
  return { rows: out, win, hot: x.pl && x.pl.hot, trio: x.pl && x.pl.trio, n: x.n };
}
function standardize(train, test, use) {
  const D = train[0].rows[0].z.length, m = new Float64Array(D), s2 = new Float64Array(D);
  let N = 0;
  for (const d of train) for (const r of d.rows) { N++; for (let j = 0; j < D; j++) m[j] += r.z[j]; }
  for (let j = 0; j < D; j++) m[j] /= N;
  for (const d of train) for (const r of d.rows) for (let j = 0; j < D; j++) s2[j] += (r.z[j] - m[j]) ** 2;
  const sd = Array.from(s2, (v) => Math.sqrt(v / N) || 1);
  for (const set of [train, test]) for (const d of set) for (const r of d.rows) {
    r.x = new Float64Array(D);
    for (let j = 0; j < D; j++) r.x[j] = use[j] ? (r.z[j] - m[j]) / sd[j] : 0;
  }
  return { m, sd };
}
function loglik(w, data) {
  let ll = 0;
  for (const d of data) {
    let mx = -1e9; const sc = d.rows.map((r) => { let s = 0; for (let j = 0; j < w.length; j++) s += w[j] * r.x[j]; if (s > mx) mx = s; return s; });
    let Z = 0; for (const s of sc) Z += Math.exp(s - mx);
    ll += sc[d.win] - mx - Math.log(Z);
  }
  return ll / data.length;
}
function fit(data, D, iters = 250) {
  const w = new Float64Array(D), m1 = new Float64Array(D), m2 = new Float64Array(D);
  const lr = 0.05, b1 = 0.9, b2 = 0.999;
  for (let it = 1; it <= iters; it++) {
    const g = new Float64Array(D);
    for (const d of data) {
      let mx = -1e9; const sc = d.rows.map((r) => { let s = 0; for (let j = 0; j < D; j++) s += w[j] * r.x[j]; if (s > mx) mx = s; return s; });
      let Z = 0; const ex = sc.map((s) => { const e = Math.exp(s - mx); Z += e; return e; });
      const wr = d.rows[d.win].x; for (let j = 0; j < D; j++) g[j] += wr[j];
      d.rows.forEach((r, i) => { const p = ex[i] / Z; for (let j = 0; j < D; j++) g[j] -= p * r.x[j]; });
    }
    for (let j = 0; j < D; j++) {
      const gj = -g[j] / data.length;                 // 最小化する(負の対数尤度)
      m1[j] = b1 * m1[j] + (1 - b1) * gj; m2[j] = b2 * m2[j] + (1 - b2) * gj * gj;
      w[j] -= lr * (m1[j] / (1 - b1 ** it)) / (Math.sqrt(m2[j] / (1 - b2 ** it)) + 1e-8);
    }
  }
  return w;
}
function w0x(w) { const o = Float64Array.from(w); for (let j = 2; j < o.length; j++) o[j] = 0; return o; }
function evTest(w, data, label, oddsMax = 1e9, filt = null) {
  const th = [1.0, 1.1, 1.2, 1.3, 1.5];
  const acc = th.map(() => ({ n: 0, r: 0, h: 0 })), top = th.map(() => ({ n: 0, r: 0, h: 0 }));
  for (const d of data) {
    let mx = -1e9; const sc = d.rows.map((r) => { let s = 0; for (let j = 0; j < w.length; j++) s += w[j] * r.x[j]; if (s > mx) mx = s; return s; });
    let Z = 0; const ex = sc.map((s) => { const e = Math.exp(s - mx); Z += e; return e; });
    const evs = d.rows.map((r, i) => (r.v <= oddsMax && (!filt || filt(d, r)) ? ex[i] / Z * r.v : -1));
    let best = 0; evs.forEach((e, i) => { if (e > evs[best]) best = i; });
    th.forEach((t, k) => {
      evs.forEach((e, i) => { if (e >= t) { acc[k].n++; if (i === d.win) { acc[k].h++; acc[k].r += d.rows[i].v * 100; } } });
      if (evs[best] >= t) { top[k].n++; if (best === d.win) { top[k].h++; top[k].r += d.rows[best].v * 100; } }
    });
  }
  console.log(`  ${label} 全部: ` + th.map((t, k) => `≥${t} ${acc[k].n}点 ${pct(acc[k].r, acc[k].n * 100)}%`).join(" / "));
  console.log(`  ${label} 1R1点: ` + th.map((t, k) => `≥${t} ${top[k].n}R 的中${pct(top[k].h, top[k].n)}% ${pct(top[k].r, top[k].n * 100)}%`).join(" / "));
}
console.log("\n==== 3. 期待値(2025年で作り、2026年で測る) ====");
for (const kind of ["2t", "2f"]) {
  const tr = R.filter((x) => x.y === "2025").map((x) => rows(kind, x)).filter(Boolean);
  const te = R.filter((x) => x.y === "2026").map((x) => rows(kind, x)).filter(Boolean);
  const D = tr[0].rows[0].z.length;
  const names = kind === "2t" ? ["log倍率", "log倍率²", ...FEATS.map((f) => "1着" + f), ...FEATS.map((f) => "2着" + f), "スジ", "逆スジ"] : ["log倍率", "log倍率²", ...FEATS, "同ライン"];
  console.log(`\n${kind === "2t" ? "2車単" : "2車複"}: 学習 ${tr.length}R / 検証 ${te.length}R`);
  // 市場だけ(倍率の2項)
  const use0 = names.map((_, j) => j < 2 ? 1 : 0);
  standardize(tr, te, use0);
  const w0 = fit(tr, D);
  const ll0tr = loglik(w0, tr), ll0te = loglik(w0, te);
  console.log(`  市場だけ: 対数尤度/R 学習 ${ll0tr.toFixed(4)} 検証 ${ll0te.toFixed(4)}`);
  evTest(w0, te, "2026 市場だけ");
  // 市場＋特徴
  standardize(tr, te, names.map(() => 1));
  const w = fit(tr, D);
  const lltr = loglik(w, tr), llte = loglik(w, te);
  console.log(`  市場＋特徴: 対数尤度/R 学習 ${lltr.toFixed(4)} 検証 ${llte.toFixed(4)}（市場だけとの差 検証 ${(llte - ll0te).toFixed(4)}）`);
  console.log("  係数(標準化後): " + names.map((nm, j) => `${nm} ${w[j].toFixed(3)}`).join(" / "));
  const hotPair = (d, r) => d.hot && d.trio && ((r.a === d.trio[0] && r.b === d.trio[1]) || (kind === "2f" && r.a === Math.min(d.trio[0], d.trio[1]) && r.b === Math.max(d.trio[0], d.trio[1])));
  const hotPair9 = (d, r) => d.n >= 8 && hotPair(d, r), hotPair7 = (d, r) => d.n === 7 && hotPair(d, r);
  for (const [lab, set] of [["2025", tr], ["2026", te]]) {
    evTest(w, set, lab + " 🔥本命ライン先頭→番手", 1e9, hotPair);
    evTest(w, set, lab + " 同 9車", 1e9, hotPair9);
    evTest(w, set, lab + " 同 7車", 1e9, hotPair7);
    evTest(w0x(w), set, lab + " 同・市場の曲がりだけで期待値", 1e9, hotPair);
  }
}
