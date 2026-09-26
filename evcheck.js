// evcheck.js — アプリ(index.html)と夜の集計(ev.js)の期待値の計算が同じかを、でたらめなレース1000件で確かめる
//   node evcheck.js     (係数や計算を変えたら必ず動かす。ずれていたら終了コード1)
"use strict";
const fs = require("fs");
const EV = require("./ev.js");
const html = fs.readFileSync(__dirname + "/index.html", "utf8");
const a = html.indexOf("const EV_MODEL"), b = html.indexOf("let LIVE_ODDS");
if (a < 0 || b < 0) { console.log("index.html に期待値の部分が見つかりません"); process.exit(1); }
const app = new Function(html.slice(a, b) + "\nreturn { EV_MODEL, VENUE_PREF, evDelta, evOfRow, scoreChange };")();
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const PREFS = ["福岡", "熊本", "東京", "埼玉", "大阪", "岡山", "宮城"];
const PLACES = Object.keys(EV.VENUE_PREF);
let bad = 0, n = 0;
if (JSON.stringify(app.EV_MODEL) !== JSON.stringify(EV.EV_MODEL)) { console.log("× 係数が違う"); bad++; }
if (JSON.stringify(app.VENUE_PREF) !== JSON.stringify(EV.VENUE_PREF)) { console.log("× 場の府県が違う"); bad++; }
if (app.scoreChange.toString() !== EV.scoreChange.toString()) { console.log("× 得点の変化(scoreChange)の中身が違う"); bad++; }
for (let t = 0; t < 1000; t++) {
  const cars = [6, 7, 9][Math.floor(rnd() * 3)];
  const ids = Array.from({ length: cars }, (_, i) => i + 1).sort(() => rnd() - 0.5);
  const lines = []; for (let i = 0; i < ids.length;) { const k = 1 + Math.floor(rnd() * 3); lines.push(ids.slice(i, i + k)); i += k; }
  const order = Array.from({ length: cars }, (_, i) => i + 1).sort(() => rnd() - 0.5);
  const ents = order.map((car) => ({ car, age: 20 + Math.floor(rnd() * 40), ki: 70 + Math.floor(rnd() * 60), pref: PREFS[Math.floor(rnd() * PREFS.length)],
    name: "選手" + t + "_" + car, score: Math.round((60 + rnd() * 50) * 100) / 100, san: rnd() < 0.1 ? null : Math.round(rnd() * 1000) / 10, nr: rnd() < 0.1 ? 0 : Math.floor(rnd() * 30) }));
  // 得点の記録(でたらめな日付と得点)。半分くらいの選手は90日以上前の記録を持つ
  const scores = { riders: {} };
  const d8 = "20260926";
  for (const e of ents) if (rnd() < 0.8) scores.riders[e.name + "|" + e.ki] = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () =>
    ["2026" + String(1 + Math.floor(rnd() * 9)).padStart(2, "0") + String(1 + Math.floor(rnd() * 28)).padStart(2, "0"), Math.round((60 + rnd() * 50) * 100) / 100]).sort((x, y) => (x[0] < y[0] ? -1 : 1));
  const place = PLACES[Math.floor(rnd() * PLACES.length)];
  const cs = EV.trioCombos(cars);
  const o = cs.map(() => (rnd() < 0.03 ? 9999.9 : Math.round((1.5 + rnd() * 300) * 10) / 10));
  const ticket = cs[Math.floor(rnd() * cs.length)].join("=");
  // アプリ: 出走表(entries)と採点の並び(scores)から
  const p = { place, lines, date: "2026年09月26日", entries: ents.map((e) => ({ car: e.car, age: e.age, ki: e.ki + "期", pref: e.pref, name: e.name, score: e.score,
    rate: { sanren: e.san }, seiseki: { win1: e.nr, win2: 0, win3: 0, out: 0 } })) };
  const r = { scores: order.map((car) => ({ car })) };
  const ea = app.evOfRow({ delta: app.evDelta(p, r, scores), ticket, cars }, { o, n: cars });
  // 夜の集計: history の riders 形式から
  const riders = ents.map((e) => [e.car, e.age, e.ki, 0, order.indexOf(e.car) + 1, 0, e.score, e.pref, e.san, e.nr,
    EV.scoreChange(scores.riders[e.name + "|" + e.ki], d8, e.score)]);
  const eb = EV.evOf(EV.deltaFromRiders(riders, lines, place), ticket, o, cars);
  const va = ea && !ea.thin ? ea.ev : null;
  if ((va == null) !== (eb == null) || (va != null && Math.abs(va - eb) > 1e-9)) { bad++; if (bad < 5) console.log("× ずれ", va, eb); }
  n++;
}
console.log(bad ? "★ずれ " + bad + " 件" : "○ " + n + "件すべて一致(アプリと夜の集計の期待値)");
process.exitCode = bad ? 1 : 0;
