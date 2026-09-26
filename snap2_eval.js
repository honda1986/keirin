// ============================================================
// snap2_eval.js — 締切前の 2車(2車単・2車複)と3連複のずれは、確定オッズの動きや回収に効くか(読み取りのみ)
//
// hikitsugi §4-7: 確定オッズどうしで比べると、2車の市場と3連複の市場のずれに取れる歪みは無かった。
// ずれが出るとすれば締切前。snap.js が 2026-09-27 から締切6分前以内の記録に 2車単(t2)・2車複(f2)を足している。
// 2〜3か月たまったら、これで測る。
//
// レースごとに、締切 2〜4分前(自動購入が決める頃)の記録を「判定時」とし、🔥の買い目(本命ライン3人)について:
//   q3  = 判定時の3連複から見た確率(1/倍率 を全組で割り戻し)
//   q2  = 判定時の2車単から見た「3人が3着以内」の確率(並びの確率 × 3着目は1着確率から Harville 近似)
//   ずれ = log(q2 / q3)   … プラスなら「2車の市場のほうが本命ラインに強気」
//   動き = log(確定の3連複オッズ / 判定時の3連複オッズ)  … マイナスなら確定までに買われた
// を出し、
//   1. ずれ と 動き の関係(ずれが大きいと、確定までに3連複が買われるか = 判定時の3連複はまだ高いか)
//   2. ずれ の大小ごとの🔥の回収率(払戻は history.json の p3fpay)
//   3. 判定時の期待値(snap の倍率・ev.js)に ずれ を足すと分けられるか
// を並べる。
//
// 使い方: git fetch origin odds-snap && mkdir -p /tmp/snap && git archive origin/odds-snap snap | tar -x -C /tmp/snap
//         node snap2_eval.js /tmp/snap/snap
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { combos } = require("./snap.js");
const { combos2 } = require("./odds2parse.js");
const { f3PlanFrom } = require("./engine.js");
const EV = require("./ev.js");

const dir = process.argv[2];
if (!dir) { console.error("使い方: node snap2_eval.js <snapのディレクトリ>"); process.exit(1); }
const LO = 2, HI = 4;          // 判定時とみなす締切前の分

const odCache = {};
function finalOdds(id) {
  const ym = id.slice(0, 6);
  if (!(ym in odCache)) { try { odCache[ym] = JSON.parse(fs.readFileSync(path.join(__dirname, "odds-" + ym + ".json"), "utf8")).races; } catch (e) { odCache[ym] = {}; } }
  return odCache[ym][id] || null;
}
const H = {};
for (const e of JSON.parse(fs.readFileSync(path.join(__dirname, "history.json"), "utf8")).entries) H[e.id] = e;

function q2of(t2, n, trio) {
  const ks = combos2("2t", n), p = {};
  let s = 0;
  ks.forEach((k, i) => { const v = t2[i]; if (v > 0 && v < 9999) { p[k] = 1 / v; s += 1 / v; } });
  if (!s) return null;
  for (const k in p) p[k] /= s;
  const w = {};
  for (let a = 1; a <= n; a++) { w[a] = 0; for (let b = 1; b <= n; b++) if (a !== b) w[a] += p[a + "-" + b] || 0; }
  const third = (a, b, c) => { const r = 1 - w[a] - w[b]; return r > 0.02 ? Math.min(1, w[c] / r) : 0; };
  const [x, y, z] = trio;
  let q = 0;
  for (const [a, b, c] of [[x, y, z], [x, z, y], [y, x, z], [y, z, x], [z, x, y], [z, y, x]]) q += (p[a + "-" + b] || 0) * third(a, b, c);
  return q;
}

const R = [];
const files = fs.readdirSync(dir).filter((f) => /^\d{8}\.json\.gz$/.test(f)).sort();
for (const f of files) {
  const { date, rows } = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString("utf8"));
  const byKey = {};
  for (const r of rows) if (r.t2 && r.left >= LO && r.left <= HI) (byKey[r.k] = byKey[r.k] || []).push(r);
  for (const k in byKey) {
    const snap = byKey[k].sort((a, b) => a.left - b.left)[0];      // 締切にいちばん近い判定時の記録
    const id = (date || f.slice(0, 8)) + "_" + k;
    const e = H[id];
    if (!e || !e.f || e.p3fpay == null || !Array.isArray(e.riders) || !Array.isArray(e.lines)) continue;
    const n = snap.n || e.riders.length;
    const rk = [...e.riders].sort((a, b) => (a[4] || 99) - (b[4] || 99)).map((r) => r[0]);
    const pl = f3PlanFrom(rk, e.lines);
    if (!pl || !pl.hot) continue;
    const trio = pl.trio.slice().sort((a, b) => a - b);
    const cs = combos(n), i = cs.indexOf(trio.join("="));
    const o3 = snap.o[i];
    if (!(o3 > 0 && o3 < 9999)) continue;
    const s3 = snap.o.reduce((s, v) => s + (v > 0 && v < 9999 ? 1 / v : 0), 0);
    const q3 = (1 / o3) / s3, q2 = q2of(snap.t2, n, trio);
    if (!q2) continue;
    const fin = finalOdds(id), fo = fin && fin.o && fin.o[i];
    const delta = EV.deltaFromRiders(e.riders, e.lines, e.place);
    const ev = delta ? EV.evOf(delta, pl.ticket, snap.o, n) : null;
    const hit = [e.f, e.s, e.t].sort((a, b) => a - b).join() === trio.join();
    R.push({ id, n, gap: Math.log(q2 / q3), drift: fo ? Math.log(fo / o3) : null, ev, hit, pay: hit ? e.p3fpay : 0, o3,
      inBand: !pl.needOdds || (o3 >= pl.bandLo && o3 <= pl.bandHi) });
  }
}
console.log("判定時(締切" + LO + "〜" + HI + "分前)の記録に2車があった🔥:", R.length, "R", "(" + files[0] + " 〜 " + files[files.length - 1] + ")");
if (R.length < 50) { console.log("まだ少なすぎます。2〜3か月たまってから"); }

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : "-");
const sorted = R.map((r) => r.gap).sort((a, b) => a - b);
const cut = [0.2, 0.4, 0.6, 0.8].map((p) => sorted[Math.floor(p * sorted.length)] ?? 0);
const bins = [-1e9, ...cut, 1e9], labels = ["下位20%", "20-40%", "40-60%", "60-80%", "上位20%"];
console.log("\n1. ずれ(2車÷3連複)ごとの、確定までの3連複の動き(マイナス=確定までに買われた)");
labels.forEach((lab, j) => {
  const g = R.filter((r) => r.gap >= bins[j] && r.gap < bins[j + 1] && r.drift != null).map((r) => r.drift).sort((a, b) => a - b);
  if (g.length) console.log(`  ${lab}: ${g.length}R 動きの中央値 ${(100 * (Math.exp(g[g.length >> 1]) - 1)).toFixed(1)}%`);
});
console.log("\n2. ずれごとの🔥の回収(実際の買い方: 7車は判定時の倍率が帯の中だけ)");
labels.forEach((lab, j) => {
  const g = R.filter((r) => r.gap >= bins[j] && r.gap < bins[j + 1] && r.inBand);
  const ret = g.reduce((a, r) => a + r.pay, 0), h = g.filter((r) => r.hit).length;
  if (g.length) console.log(`  ${lab}: ${g.length}R 的中${pct(h, g.length)}% 回収${pct(ret, g.length * 100)}%`);
});
console.log("\n3. 判定時の期待値 × ずれ");
for (const [lab, f] of [["期待値≥1", (r) => r.ev != null && r.ev >= 1], ["期待値<1", (r) => r.ev != null && r.ev < 1]]) {
  for (const [gl, gf] of [["ずれ+(2車が強気)", (r) => r.gap >= 0], ["ずれ−(3連複が強気)", (r) => r.gap < 0]]) {
    const g = R.filter((r) => f(r) && gf(r) && r.inBand);
    const ret = g.reduce((a, r) => a + r.pay, 0), h = g.filter((r) => r.hit).length;
    console.log(`  ${lab}・${gl}: ${g.length}R 的中${pct(h, g.length)}% 回収${pct(ret, g.length * 100)}%`);
  }
}
