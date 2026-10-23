// ============================================================
// analysis/home/hab.js — H(ホーム回数)を本物にしたら予想が良くなるか(hikitsugi §4-48)
//
// engine.js の予想は H に B を流用している(Kドリームスに H が無かったため)。H を使っているのは
// バック取得ラインの予測(backProb・記事027 のロジスティック回帰。x2 = 先頭の H 回数)だけ。
// 同じ出走表(pastcard ブランチの pcraw = Kドリームスの当時のテキスト)で、
//   A: 今のまま(H = B)
//   B: H を WINTICKET の当時の H に差し替え(wtrec ブランチの wtrec-YYYYMM.json.gz)
// の2通りで予想し直し、次を比べる:
//   ・バックを取ったライン(結果の B の選手がいるライン)を、主導権ライン(leadLine)が当てた率
//   ・評価1位の1着率、🔥(f3PlanFrom の hot)の的中・回収(3連複の配当は history.json)
//
// 使い方: node analysis/home/hab.js <pcraw のフォルダ> <wtrec のフォルダ> [YYYYMM,YYYYMM,...]
// ============================================================
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const K = path.join(__dirname, "..", "..");
const E = require(path.join(K, "engine.js"));
const { T, TRACK_NAMES } = require(path.join(K, "bankdata.js"));
const [PC, WR, MON] = process.argv.slice(2);
if (!PC || !WR) { console.error("使い方: node analysis/home/hab.js <pcraw dir> <wtrec dir> [YYYYMM,...]"); process.exit(1); }
let LEARN_W = null; try { LEARN_W = JSON.parse(fs.readFileSync(path.join(K, "weights.json"), "utf8")); } catch (e) {}
const gz = (f) => { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString("utf8")); } catch (e) { return null; } };

const months = (MON ? MON.split(",") : fs.readdirSync(WR).filter((f) => /^wtrec-\d{6}\.json\.gz$/.test(f)).map((f) => f.slice(6, 12))).sort();
const H = {};
for (const e of JSON.parse(fs.readFileSync(path.join(K, "history.json"), "utf8")).entries) H[e.date + "_" + e.place + "_" + e.raceNo] = e;

// 得点の記録(pastcard_rebuild.js と同じ。pcraw 自身から 名前|期 → [日付, 得点])。前回開催からの増減に使う
const raws = {}, wts = {};
for (const ym of months) {
  Object.assign(raws, gz(path.join(PC, "pcraw-" + ym + ".json.gz")) || gz(path.join(PC, "dayraw-" + ym + ".json.gz")) || {});
  Object.assign(wts, gz(path.join(WR, "wtrec-" + ym + ".json.gz")) || {});
}
const log = { riders: {} };
for (const id of Object.keys(raws).sort()) {
  let p; try { p = E.parseCard(raws[id], TRACK_NAMES); } catch (e) { continue; }
  for (const en of (p && p.entries) || []) {
    if (!(en.score > 0) || !en.name || !en.ki) continue;
    const a = (log.riders[en.name + "|" + String(en.ki).replace(/期$/, "")] ||= []);
    if (!a.length || a[a.length - 1][0] !== id.slice(0, 8)) a.push([id.slice(0, 8), en.score]);
  }
}

function run(id, raw, wc, real) {
  const p = E.parseCard(raw, TRACK_NAMES);
  if (!p || !p.entries || p.entries.length < 5) return null;
  const cars = new Set(p.entries.map((e) => e.car));
  p.lines = (p.lines || []).map((l) => l.filter((c) => cars.has(c))).filter((l) => l.length);
  for (const e of p.entries) if (!e.seiseki) e.seiseki = { win1: 0, win2: 0, win3: 0, out: 0 };
  const d8 = id.slice(0, 8);
  if (!/\d{4}年\d{1,2}月\d{1,2}日/.test(String(p.date || ""))) p.date = `${d8.slice(0, 4)}年${+d8.slice(4, 6)}月${+d8.slice(6, 8)}日`;
  E.applyScoreLog(p, log);
  p.place = p.place || id.split("_")[1]; p.raceNo = id.split("_")[2];
  if (real) for (const e of p.entries) { const c = wc[e.car]; if (c && c[3] != null) e.H = c[3]; }
  const r = E.predict(p, T[p.place], p.place, LEARN_W);
  const ranked = (r.scores || []).map((s) => s.car);
  const pl = E.f3PlanFrom(ranked, p.lines, { ss: p.entries.some((e) => e.grade === "SS"), seri: p.seri });
  return { p, r, ranked, pl };
}

const S = { A: {}, B: {} };
const add = (arm, k, v) => { const o = (S[arm][k] ||= { n: 0, v: 0, pay: 0 }); o.n++; o.v += v ? 1 : 0; };
let used = 0, bMismatch = 0, bCheck = 0, changedLead = 0, changedHot = 0, changedTop = 0;
for (const [id, w] of Object.entries(wts)) {
  const raw = raws[id], h = H[id];
  if (!raw || !h || h.f == null) continue;
  const wc = {}; for (const c of w.c || []) wc[c[0]] = c;
  let a, b;
  try { a = run(id, raw, wc, false); b = run(id, raw, wc, true); } catch (e) { continue; }
  if (!a || !b) continue;
  used++;
  // 突き合わせの確認: Kドリームスの B 回数と WINTICKET の B 回数(同じ車番)
  for (const e of a.p.entries) { const c = wc[e.car]; if (c && c[4] != null) { bCheck++; if (c[4] !== e.B) bMismatch++; } }
  const n = a.p.entries.length, nk = n >= 9 ? "9車" : n === 7 ? "7車" : n + "車";
  const bCar = ((w.r || []).find((x) => x[5]) || [])[0];
  const multi = a.p.lines.filter((l) => l.length >= 2).length;
  const fin = [h.f, h.s, h.t].filter((x) => x != null).sort((x, y) => x - y).join("=");
  for (const [arm, x] of [["A", a], ["B", b]]) {
    if (bCar && multi >= 2 && x.r.leadLine) { add(arm, "lead全体", x.r.leadLine.includes(bCar)); add(arm, "lead" + nk, x.r.leadLine.includes(bCar)); }
    add(arm, "1位1着" + nk, x.ranked[0] === h.f);
    if (x.pl && x.pl.hot && x.pl.trio && !(x.pl.cars >= 8 && a.p.entries.some((e) => e.grade === "SS"))) {
      const t = x.pl.trio.slice().sort((p, q) => p - q).join("=");
      const k = "🔥" + nk; add(arm, k, t === fin);
      if (t === fin && h.p3fpay) S[arm][k].pay += h.p3fpay;
    }
  }
  if (String(a.r.leadLine) !== String(b.r.leadLine)) changedLead++;
  if (a.ranked[0] !== b.ranked[0]) changedTop++;
  const ta = a.pl && a.pl.hot ? String(a.pl.trio) : "", tb = b.pl && b.pl.hot ? String(b.pl.trio) : "";
  if (ta !== tb) changedHot++;
}
console.log("月", months.join(","), "/ 比べたレース", used, "R");
console.log("確認: B回数が Kドリームスと WINTICKET で違う選手", bMismatch, "/", bCheck);
console.log("H を差し替えて変わったレース: 主導権ライン", changedLead, "R / 評価1位", changedTop, "R / 🔥の買い目", changedHot, "R");
const keys = [...new Set([...Object.keys(S.A), ...Object.keys(S.B)])].sort();
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : "-");
for (const k of keys) {
  const x = S.A[k] || { n: 0, v: 0, pay: 0 }, y = S.B[k] || { n: 0, v: 0, pay: 0 };
  const roi = (o) => (/🔥/.test(k) ? " 回収" + pct(o.pay, o.n * 100) + "%" : "");
  console.log(`${k.padEnd(10)}  A(H=B) ${x.n}R ${pct(x.v, x.n)}%${roi(x)}   B(本物のH) ${y.n}R ${pct(y.v, y.n)}%${roi(y)}`);
}
