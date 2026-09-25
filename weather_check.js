// 使い捨ての診断: 天候・風で「本命ライン3人(3連複)」の当たり方が変わるか。
// GitHub Actions(評価値・読み取り専用)で回す。気象データは Open-Meteo の過去データ(ERA5)。
// 履歴に発走時刻が無いので、その日のレース時間帯(9〜23時)の平均風速・降水量合計で日ごとに分ける。
const fs = require("fs");
const { f3PlanFrom } = require("./engine.js");
const V = { 函館:[41.79,140.75],青森:[40.78,140.79],いわき平:[37.05,140.89],弥彦:[37.69,138.83],前橋:[36.40,139.07],取手:[35.91,140.06],宇都宮:[36.53,139.88],大宮:[35.92,139.63],西武園:[35.77,139.44],京王閣:[35.64,139.56],立川:[35.70,139.42],松戸:[35.79,139.91],千葉:[35.61,140.12],川崎:[35.53,139.70],平塚:[35.33,139.35],小田原:[35.26,139.15],伊東:[34.97,139.10],静岡:[34.97,138.40],名古屋:[35.18,136.88],岐阜:[35.42,136.78],大垣:[35.37,136.62],豊橋:[34.77,137.38],富山:[36.72,137.18],松阪:[34.57,136.54],四日市:[34.96,136.62],福井:[36.07,136.23],奈良:[34.67,135.84],向日町:[34.95,135.70],和歌山:[34.22,135.18],岸和田:[34.46,135.39],玉野:[34.49,133.95],広島:[34.36,132.49],防府:[34.05,131.57],高松:[34.34,134.06],小松島:[34.00,134.59],高知:[33.56,133.53],松山:[33.84,132.76],小倉:[33.87,130.86],久留米:[33.32,130.52],武雄:[33.19,130.02],佐世保:[33.16,129.72],別府:[33.30,131.49],熊本:[32.80,130.70] };
const DOME = new Set(["前橋", "千葉", "小倉"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function weather(place, [lat, lon]) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=2025-01-01&end_date=2026-09-20&hourly=wind_speed_10m,precipitation&wind_speed_unit=ms&timezone=Asia%2FTokyo`;
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); console.error(place, "HTTP", r.status); } catch (e) { console.error(place, e.message); }
    await sleep(3000);
  }
  return null;
}
(async () => {
  const W = {};   // "place|YYYYMMDD" → {wind, rain}
  for (const [p, ll] of Object.entries(V)) {
    const j = await weather(p, ll); await sleep(400);
    if (!j || !j.hourly) { console.error("取得失敗:", p); continue; }
    const { time, wind_speed_10m: ws, precipitation: pr } = j.hourly; const day = {};
    time.forEach((t, i) => { const h = +t.slice(11, 13); if (h < 9 || h > 23) return; const d = t.slice(0, 10).replace(/-/g, "");
      const o = (day[d] = day[d] || { w: 0, n: 0, r: 0 }); if (ws[i] != null) { o.w += ws[i]; o.n++; } if (pr[i] != null) o.r += pr[i]; });
    for (const [d, o] of Object.entries(day)) W[p + "|" + d] = { wind: o.n ? o.w / o.n : null, rain: o.r };
  }
  console.log("気象データ:", Object.keys(W).length, "場・日");
  const H = JSON.parse(fs.readFileSync("history.json", "utf8")).entries;
  const U = [];
  for (const e of H) {
    if (e.f == null || e.s == null || e.t == null || e.p3fpay == null || !Array.isArray(e.riders) || !Array.isArray(e.lines)) continue;
    const w = W[e.place + "|" + e.date]; if (!w || w.wind == null) continue;
    const rk = [...e.riders].sort((a, b) => (a[4] || 99) - (b[4] || 99)).map((r) => r[0]);
    const pl = f3PlanFrom(rk, e.lines); if (!pl || !pl.trio) continue;
    const hit = [e.f, e.s, e.t].sort((a, b) => a - b).join("=") === pl.ticket;
    U.push({ y: e.date < "20260101" ? "2025" : "2026", dome: DOME.has(e.place), hot: !!pl.hot, wind: w.wind, rain: w.rain,
      hit: hit ? 1 : 0, ret: hit ? e.p3fpay : 0, headWin: e.f === pl.trio[0] ? 1 : 0, banWin: e.f === pl.trio[1] ? 1 : 0 });
  }
  console.log("突き合わせたレース:", U.length);
  const row = (lab, g) => {
    if (g.length < 30) return console.log("  " + lab.padEnd(18), "(" + g.length + "R)");
    const n = g.length, p = (f) => (g.reduce((a, x) => a + f(x), 0) / n * 100).toFixed(1).padStart(5);
    console.log("  " + lab.padEnd(18), String(n).padStart(6) + "R  3複的中" + p((x) => x.hit) + "%  回収" + (g.reduce((a, x) => a + x.ret, 0) / n).toFixed(1).padStart(6) + "%  先頭1着" + p((x) => x.headWin) + "%  番手1着" + p((x) => x.banWin) + "%");
  };
  const WB = [["風3m/s未満", (x) => x.wind < 3], ["風3〜5m/s", (x) => x.wind >= 3 && x.wind < 5], ["風5m/s以上", (x) => x.wind >= 5]];
  const RB = [["雨なし(0mm)", (x) => x.rain < 0.1], ["雨0.1〜5mm", (x) => x.rain >= 0.1 && x.rain < 5], ["雨5mm以上", (x) => x.rain >= 5]];
  for (const [scope, f] of [["全レース(屋外)", (x) => !x.dome], ["🔥(屋外)", (x) => !x.dome && x.hot], ["全レース(屋内ドーム・比較用)", (x) => x.dome]]) {
    for (const y of ["2025", "2026"]) {
      const G = U.filter((x) => f(x) && x.y === y);
      console.log(`\n■ ${scope} ${y}`); for (const [l, g] of WB) row(l, G.filter(g)); for (const [l, g] of RB) row(l, G.filter(g));
    }
  }
})();
