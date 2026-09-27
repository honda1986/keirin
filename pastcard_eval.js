// ============================================================
// pastcard_eval.js — 作り直した🔥の成績(年別・9車/7車・期待値・混戦)と、2025年以降は history の🔥との突き合わせ(分析用)
//   node pastcard_eval.js <pastcard_rebuild.js の出力> [odds2 のディレクトリ]
//   ・3連複オッズ(7車の帯・期待値)は odds-YYYYMM.json(確定オッズ)。混戦度は odds2 の o2f(2車複の確定オッズ)
//   ・結果は hikitsugi §4-11
// ============================================================
"use strict";
const fs = require("fs"), path = require("path");
const K = __dirname, RB = JSON.parse(fs.readFileSync(process.argv[2], "utf8")), O2 = process.argv[3];
const EV = require(path.join(K, "ev.js"));
const { f3PlanFrom } = require(path.join(K, "engine.js"));
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : "-");
const oc = {};
function odds3(id) {
  const ym = id.slice(0, 6);
  if (!(ym in oc)) { try { oc[ym] = JSON.parse(fs.readFileSync(path.join(K, "odds-" + ym + ".json"), "utf8")).races; } catch (e) { oc[ym] = {}; } }
  return oc[ym][id] || null;
}
const F2 = {};
if (O2) for (const f of fs.readdirSync(O2)) if (/^o2f-\d{6}\.json$/.test(f)) Object.assign(F2, JSON.parse(fs.readFileSync(path.join(O2, f), "utf8")).races);
const trios = (n) => { const o = []; for (let a = 1; a <= n; a++) for (let b = a + 1; b <= n; b++) for (let c = b + 1; c <= n; c++) o.push([a, b, c].join("=")); return o; };
const H = {};
for (const e of JSON.parse(fs.readFileSync(path.join(K, "history.json"), "utf8")).entries) H[e.id] = e;

const rows = [];
let noOdds = 0;
for (const [id, r] of Object.entries(RB)) {
  if (!r.fin || !r.hot || !r.trio) continue;
  const t = r.trio.slice().sort((a, b) => a - b).join("=");
  const A = odds3(id);
  const o3 = A && A.cars === r.n ? A.o[trios(r.n).indexOf(t)] : null;
  if (!(o3 > 0)) noOdds++;
  const hit = r.fin.slice().sort((a, b) => a - b).join("=") === t;
  let pay = 0;
  if (hit) pay = r.p3f && r.p3f[0] === t ? r.p3f[1] : (o3 > 0 ? Math.round(o3 * 100) : 0);
  let ev = null;
  if (A && A.cars === r.n) { const d = EV.deltaFromRiders(r.riders, r.lines, id.split("_")[1]); if (d) ev = EV.evOf(d, t, A.o, r.n); }
  const f = F2[id]; let f13 = null;
  if (f && f.cars === r.n) { const v = f.o.filter((x) => x > 0 && x < 9999).sort((a, b) => a - b); if (v.length >= 3) f13 = v[2] / v[0]; }
  rows.push({ id, y: id.slice(0, 4), n: r.n, hit, pay, o3, ev, f13, inBand: r.n !== 7 || (o3 >= 4 && o3 <= 15) });
}
console.log("🔥(着順あり)", rows.length, "3連複オッズ無し", noOdds);
function line(lab, g) {
  const ret = g.reduce((a, r) => a + r.pay, 0), h = g.filter((r) => r.hit).length;
  return `${lab}: ${g.length}R 的中${pct(h, g.length)}% 回収${pct(ret, g.length * 100)}%`;
}
const years = [...new Set(rows.map((r) => r.y))].sort();
for (const y of years) {
  const g = rows.filter((r) => r.y === y);
  console.log(`\n■ ${y}`);
  console.log("  " + line("9車", g.filter((r) => r.n >= 8)));
  console.log("  " + line("7車 帯なし", g.filter((r) => r.n === 7)));
  console.log("  " + line("7車 4〜15倍", g.filter((r) => r.n === 7 && r.inBand)));
  const act = g.filter((r) => r.inBand);
  console.log("  " + line("実際の買い方(9車＋7車帯)", act));
  console.log("  " + line("  期待値≥1", act.filter((r) => r.ev != null && r.ev >= 1)));
  console.log("  " + line("  期待値<1", act.filter((r) => r.ev != null && r.ev < 1)));
  const wf = act.filter((r) => r.f13 != null);
  if (wf.length) {
    console.log("  " + line("  混戦(2複3番÷1番≤2.0)", wf.filter((r) => r.f13 <= 2)));
    console.log("  " + line("  それ以外", wf.filter((r) => r.f13 > 2)));
    console.log("  " + line("  期待値≥1・混戦", wf.filter((r) => r.ev != null && r.ev >= 1 && r.f13 <= 2)));
    console.log("  " + line("  期待値≥1・それ以外", wf.filter((r) => r.ev != null && r.ev >= 1 && r.f13 > 2)));
    console.log("  " + line("  期待値<1・混戦", wf.filter((r) => r.ev != null && r.ev < 1 && r.f13 <= 2)));
  }
}
// 2025年以降: history の🔥と同じレースで、作り直しの🔥と成績を比べる(作り直しがどれだけ信用できるか)
const S = (t) => t.slice().sort((a, b) => a - b).join("=");
const acc = {};
const add = (k, n, hit, pay, band) => { const o = (acc[k] = acc[k] || { n: 0, h: 0, p: 0, bn: 0, bh: 0, bp: 0 }); o.n++; if (hit) { o.h++; o.p += pay; } if (band) { o.bn++; if (hit) { o.bh++; o.bp += pay; } } };
let both = 0, sameHot = 0, sameTrio = 0, sameLines = 0, sameLineSet = 0;
for (const id of Object.keys(RB)) {
  const h = H[id], r = RB[id];
  if (!h || !h.f || !Array.isArray(h.riders) || !Array.isArray(h.lines) || h.p3fpay == null) continue;
  both++;
  const w = S([h.f, h.s, h.t]);
  const hr = [...h.riders].sort((a, b) => (a[4] || 99) - (b[4] || 99)).map((x) => x[0]);
  const hp = f3PlanFrom(hr, h.lines);
  if (JSON.stringify(h.lines) === JSON.stringify(r.lines)) sameLines++;
  if (JSON.stringify(h.lines.map((l) => l.join(",")).sort()) === JSON.stringify(r.lines.map((l) => l.join(",")).sort())) sameLineSet++;
  if (!!(hp && hp.hot) === r.hot) sameHot++;
  if (hp && hp.hot && r.hot && S(hp.trio) === S(r.trio)) sameTrio++;
  const A = odds3(id);
  const band = (t, n) => { if (n !== 7) return true; if (!A || A.cars !== n) return false; const v = A.o[trios(n).indexOf(t)]; return v >= 4 && v <= 15; };
  if (hp && hp.hot) { const t = S(hp.trio); add("history の🔥", h.riders.length, t === w, h.p3fpay, band(t, h.riders.length)); }
  if (r.hot) { const t = S(r.trio); add("作り直しの🔥", r.n, t === w, h.p3fpay, band(t, r.n)); }
  if (hp && hp.hot && r.hot && S(hp.trio) === S(r.trio)) add("両方🔥・同じ3人", r.n, S(r.trio) === w, h.p3fpay, band(S(r.trio), r.n));
  if (hp && hp.hot && !(r.hot && S(hp.trio) === S(r.trio))) add("history だけ🔥(または3人違い)", h.riders.length, S(hp.trio) === w, h.p3fpay, band(S(hp.trio), h.riders.length));
  if (r.hot && !(hp && hp.hot && S(hp.trio) === S(r.trio))) add("作り直しだけ🔥(または3人違い)", r.n, S(r.trio) === w, h.p3fpay, band(S(r.trio), r.n));
}
if (both) console.log(`\n2025年以降・history と同じレース ${both}R: 並びが完全一致 ${pct(sameLines, both)}% / ラインの中身が一致(順番は問わない) ${pct(sameLineSet, both)}% / 🔥かどうか一致 ${pct(sameHot, both)}% / 両方🔥で3人一致 ${sameTrio}`);
for (const [k, o] of Object.entries(acc)) console.log(`  ${k}: ${o.n}R 的中${pct(o.h, o.n)}% 回収(帯なし)${pct(o.p, o.n * 100)}% | 実際の買い方 ${o.bn}R 的中${pct(o.bh, o.bn)}% 回収${pct(o.bp, o.bn * 100)}%`);
