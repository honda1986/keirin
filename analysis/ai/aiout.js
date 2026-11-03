// ============================================================
// analysis/ai/aiout.js — 「1番人気がライン3車なのに AI予想の4車に入らない」レースを詳しく見る(hikitsugi §4-49 の ☆)
//
// ailine.js で、この組の1番人気を1点買うと回収 102.5%(4,561R)だった。続けて見るもの:
//   ・回収の誤差(レースを引き直して作った 95% の幅)・月ごと・四半期ごと
//   ・1番人気の倍率・車立て・級班・ラインの人数・AI の4車に1番人気の3人が何人入っているか
//   ・🔥(本命ライン3人。results.js の writeDaily と同じ f3PlanFrom)と重なるか
//   ・締切前の倍率(odds-snap。自動投票が決める締切2分前の記録)で1番人気を決めても同じか(2026-09-26〜)
//
// 使い方: node analysis/ai/aiout.js <wtai のフォルダ> [<odds-snap の snap フォルダ>]
// ============================================================
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const K = path.join(__dirname, "..", "..");
const { f3PlanFrom } = require(path.join(K, "engine.js"));
const [WA, SNAP] = process.argv.slice(2);
if (!WA) { console.error("使い方: node analysis/ai/aiout.js <wtai dir> [<snap dir>]"); process.exit(1); }
const gz = (f) => { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString("utf8")); } catch (e) { return null; } };
const AI = {};
for (const f of fs.readdirSync(WA).filter((x) => /^wtai-\d{6}\.json\.gz$/.test(x))) Object.assign(AI, gz(path.join(WA, f)) || {});
const OD = {};
const oddsOf = (id) => { const ym = id.slice(0, 6); if (!(ym in OD)) { try { OD[ym] = JSON.parse(fs.readFileSync(path.join(K, "odds-" + ym + ".json"), "utf8")).races || {}; } catch (e) { OD[ym] = {}; } } return OD[ym][id] || null; };
const T = {};
const tri = (n) => T[n] || (T[n] = (() => { const o = []; for (let a = 1; a <= n; a++) for (let b = a + 1; b <= n; b++) for (let c = b + 1; c <= n; c++) o.push([a, b, c].join("=")); return o; })());
const key3 = (a) => a.slice().sort((x, y) => x - y).join("=");
// いちばん低い3連複(同じ倍率が2組以上なら null)
function favOf(o, n) {
  let lo = Infinity, at = -1, tie = false;
  o.forEach((v, i) => { if (v > 0 && v < lo) { lo = v; at = i; tie = false; } else if (v > 0 && v === lo) tie = true; });
  return at < 0 || tie ? null : { fav: tri(n)[at], odds: lo };
}
// 締切前の記録: その日のレースごとに、締切2分前より前でいちばん新しい記録(snap_live.js の d と同じ)
const SN = {};
function snapOf(d8, k) {
  if (!SNAP) return null;
  if (!(d8 in SN)) {
    SN[d8] = {};
    const j = gz(path.join(SNAP, d8 + ".json.gz"));
    for (const r of (j && j.rows) || []) if (r.left >= 2.0 && (!SN[d8][r.k] || r.left < SN[d8][r.k].left)) SN[d8][r.k] = r;
  }
  return SN[d8][k] || null;
}
const rankedOf = (e) => {
  if (!Array.isArray(e.riders) || !e.riders.length) return [];
  const k = e.riders.every((r) => r[11] != null) ? 11 : 4;
  return [...e.riders].sort((a, b) => (a[k] || 99) - (b[k] || 99)).map((r) => r[0]);
};

// ☆ の判定(1番人気 fav がライン3車で、そのラインの3車が AI の4車にそろっていない)
function classify(e, ai, fav) {
  const lines = (e.lines || []).filter((l) => l.length >= 3);
  const fs3 = new Set(fav.split("=").map(Number));
  const favLine = lines.find((l) => l.filter((c) => fs3.has(c)).length === 3);
  if (!favLine) return null;
  const lineTrios = [];
  for (const l of lines) {
    const inAi = l.filter((c) => ai.includes(c));
    if (inAi.length === 3) lineTrios.push(key3(inAi));
    if (inAi.length === 4) for (let i = 0; i < 4; i++) lineTrios.push(key3(inAi.filter((_, j) => j !== i)));
  }
  return { star: !lineTrios.includes(fav), lineLen: favLine.length, inAi: [...fs3].filter((c) => ai.includes(c)).length, aiOtherLine: lineTrios.length > 0 };
}

const rows = [], snapRows = [];
for (const e of JSON.parse(fs.readFileSync(path.join(K, "history.json"), "utf8")).entries) {
  if (e.klass === "girls" || e.f == null || e.s == null || e.t == null || e.p3fpay == null) continue;
  const id = e.date + "_" + e.place + "_" + e.raceNo;
  const ai = AI[id];
  if (!ai || ai.length !== 4) continue;
  const n = (e.riders || []).length;
  const fin = key3([e.f, e.s, e.t]);
  const rk = rankedOf(e);
  const pl = rk.length >= 4 && Array.isArray(e.lines) ? f3PlanFrom(rk, e.lines, { ss: !!e.ss, seri: e.seri }) : null;
  const hot = pl && pl.hot && pl.trio ? pl.ticket : null;
  const A = oddsOf(id);
  if (A && A.cars === n && Array.isArray(A.o)) {
    const F = favOf(A.o, n);
    const c = F && classify(e, ai, F.fav);
    if (c && c.star) rows.push({ id, d8: e.date, ym: e.date.slice(0, 6), q: e.date.slice(0, 4) + "Q" + (Math.floor((+e.date.slice(4, 6) - 1) / 3) + 1), n, klass: e.klass,
      odds: F.odds, hit: fin === F.fav, pay: fin === F.fav ? e.p3fpay : 0, ...c, hot: hot === F.fav });
  }
  // 締切前の倍率で1番人気を決めた場合(払戻は確定のまま)
  const s = snapOf(e.date, e.place + "_" + e.raceNo);
  if (s && s.n === n && Array.isArray(s.o)) {
    const F = favOf(s.o, n);
    const c = F && classify(e, ai, F.fav);
    if (c && c.star) snapRows.push({ id, odds: F.odds, hit: fin === F.fav, pay: fin === F.fav ? e.p3fpay : 0, n });
  }
}

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + "%" : "-");
// 回収率の 95% の幅(レースを引き直す。固定の乱数で毎回同じ結果)
function ci(g) {
  if (g.length < 30) return "";
  let seed = 12345;   // mulberry32(整数だけで回す。前の線形合同法は掛け算が 2^53 を超えて偏っていた)
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const v = [];
  for (let b = 0; b < 1000; b++) { let s = 0; for (let i = 0; i < g.length; i++) s += g[Math.floor(rnd() * g.length)].pay; v.push(s / g.length); }
  v.sort((a, b) => a - b);
  return " (95%の幅 " + v[25].toFixed(0) + "〜" + v[975].toFixed(0) + "%)";
}
function show(lab, g) {
  if (!g.length) return console.log(lab.padEnd(26), "0R");
  const ret = g.reduce((a, r) => a + r.pay, 0), h = g.filter((r) => r.hit);
  const avgHitPay = h.length ? Math.round(h.reduce((a, r) => a + r.pay, 0) / h.length) : 0;
  console.log(lab.padEnd(26), String(g.length).padStart(5) + "R", "的中", pct(h.length, g.length).padStart(6), "当たりの平均", String(avgHitPay).padStart(4) + "円",
    "回収", pct(ret, g.length * 100).padStart(7) + ci(g), "収支", (ret - g.length * 100 >= 0 ? "+" : "") + (ret - g.length * 100) + "円");
}
console.log("☆ 1番人気(確定オッズ)がライン3車なのに AI の4車に入らない。1番人気を100円ずつ買った場合");
show("全体", rows);
console.log("\n■ 四半期ごと");
for (const q of [...new Set(rows.map((r) => r.q))].sort()) show(q, rows.filter((r) => r.q === q));
console.log("\n■ 月ごとで回収100%以上だった月", [...new Set(rows.map((r) => r.ym))].filter((m) => { const g = rows.filter((r) => r.ym === m); return g.reduce((a, r) => a + r.pay, 0) >= g.length * 100; }).length, "/", new Set(rows.map((r) => r.ym)).size, "か月");
console.log("\n■ 1番人気の倍率");
for (const [lab, lo, hi] of [["3倍未満", 0, 3], ["3〜4倍", 3, 4], ["4〜5倍", 4, 5], ["5〜6倍", 5, 6], ["6〜8倍", 6, 8], ["8倍以上", 8, 1e9]]) show(lab, rows.filter((r) => r.odds >= lo && r.odds < hi));
console.log("\n■ 車立て・級班");
show("9車(8〜9車)", rows.filter((r) => r.n >= 8)); show("7車", rows.filter((r) => r.n === 7)); show("6車以下", rows.filter((r) => r.n <= 6));
show("S級", rows.filter((r) => r.klass === "s")); show("A級(チャレンジ含む)", rows.filter((r) => r.klass !== "s"));
show("9車・S級", rows.filter((r) => r.n >= 8 && r.klass === "s")); show("9車・A級", rows.filter((r) => r.n >= 8 && r.klass !== "s"));
console.log("\n■ 1番人気のライン・AI との重なり");
show("3人ライン", rows.filter((r) => r.lineLen === 3)); show("4人以上のラインの3人", rows.filter((r) => r.lineLen >= 4));
for (const k of [0, 1, 2]) show("AIの4車に1番人気の" + k + "人", rows.filter((r) => r.inAi === k));
show("AI は別のラインの3車を推す", rows.filter((r) => r.aiOtherLine)); show("AI はラインでそろえていない", rows.filter((r) => !r.aiOtherLine));
console.log("\n■ 🔥(本命ライン3人)と同じ組か");
show("🔥と同じ", rows.filter((r) => r.hot)); show("🔥ではない", rows.filter((r) => !r.hot));
console.log("\n■ 組み合わせ");
show("1番人気4倍以上", rows.filter((r) => r.odds >= 4)); show("1番人気4倍以上・🔥ではない", rows.filter((r) => r.odds >= 4 && !r.hot));
show("9車 or S級", rows.filter((r) => r.n >= 8 || r.klass === "s"));
console.log("\n■ 年ごと(よかった組が続いているか)");
for (const y of ["2025", "2026"]) {
  const g = rows.filter((r) => r.d8.startsWith(y));
  show(y + " 全体", g); show(y + " 1番人気4倍以上", g.filter((r) => r.odds >= 4)); show(y + " S級", g.filter((r) => r.klass === "s"));
  show(y + " 4倍以上・S級", g.filter((r) => r.odds >= 4 && r.klass === "s")); show(y + " 4倍以上・A級", g.filter((r) => r.odds >= 4 && r.klass !== "s"));
}
const best = rows.filter((r) => r.odds >= 4 && r.klass === "s");
console.log("\n■ 4倍以上・S級 と🔥の重なり");
show("4倍以上・S級", best); show("  うち🔥と同じ組", best.filter((r) => r.hot)); show("  うち🔥ではない", best.filter((r) => !r.hot));
show("  うち9車", best.filter((r) => r.n >= 8)); show("  うち7車", best.filter((r) => r.n === 7));
if (SNAP) {
  console.log("\n■ 締切前の倍率(締切2分前より前の最後の記録)で1番人気を決めた場合(2026-09-26〜。払戻は確定)");
  show("締切前の1番人気で☆", snapRows);
  const ids = new Set(snapRows.map((r) => r.id));
  show("  同じ期間の確定オッズで☆", rows.filter((r) => r.d8 >= "20260926"));
  show("  両方で☆(重なり)", rows.filter((r) => ids.has(r.id)));
}
