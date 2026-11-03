// ============================================================
// analysis/ai/ailine.js — WINTICKET の AI予想(4車)の中に同じラインの3車がいて、その3連複が1番人気のときの荒れ具合(hikitsugi §4-49)
//
// はむさん「AI予想の4車の中でライン組んだ3車が1番人気の際の荒れ具合確認したい」。
//   AI予想   : wtrec ブランチの wtai-YYYYMM.json.gz(wtai.js。4車の3連複ボックス)
//   並び     : history.json の lines(その日の予想に使った並び予想。WINTICKET / Kドリームスとも同じ並び)
//   1番人気 : odds-YYYYMM.json の確定オッズで3連複がいちばん低い組(同じ倍率が2組以上なら外す)
//   結果     : history.json の着順・3連複の配当(p3fpay)
// 「ライン組んだ3車」= AI の4車のうち3車が、並び予想の同じライン(3人以上)にいる。4人ラインから3人でもよい。
//
// ★ = AIの4車にライン3車・それが1番人気 / ☆ = 1番人気がライン3車なのに AI の4車に入らない(比べる組)
//
// 使い方: node analysis/ai/ailine.js <wtai のフォルダ> [--from=YYYYMMDD] [--to=YYYYMMDD]
// ============================================================
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const K = path.join(__dirname, "..", "..");
const WA = process.argv[2];
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith("--" + k + "=")); return a ? a.slice(k.length + 3) : d; };
const FROM = arg("from", "00000000"), TO = arg("to", "99999999");
if (!WA) { console.error("使い方: node analysis/ai/ailine.js <wtai dir> [--from=YYYYMMDD] [--to=YYYYMMDD]"); process.exit(1); }
const gz = (f) => { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString("utf8")); } catch (e) { return null; } };

const AI = {};
for (const f of fs.readdirSync(WA).filter((x) => /^wtai-\d{6}\.json\.gz$/.test(x))) Object.assign(AI, gz(path.join(WA, f)) || {});
const OD = {};
const oddsOf = (id) => { const ym = id.slice(0, 6); if (!(ym in OD)) { try { OD[ym] = JSON.parse(fs.readFileSync(path.join(K, "odds-" + ym + ".json"), "utf8")).races || {}; } catch (e) { OD[ym] = {}; } } return OD[ym][id] || null; };
const trios = (n) => { const o = []; for (let a = 1; a <= n; a++) for (let b = a + 1; b <= n; b++) for (let c = b + 1; c <= n; c++) o.push([a, b, c].join("=")); return o; };
const T = {};
const tri = (n) => T[n] || (T[n] = trios(n));
const key3 = (a) => a.slice().sort((x, y) => x - y).join("=");

const rows = [];
let noAi = 0, noOdds = 0;
for (const e of JSON.parse(fs.readFileSync(path.join(K, "history.json"), "utf8")).entries) {
  if (e.date < FROM || e.date > TO || e.klass === "girls" || e.f == null || e.s == null || e.t == null) continue;
  const id = e.date + "_" + e.place + "_" + e.raceNo;
  const ai = AI[id];
  if (!ai) continue;                                   // まだ取っていない月
  if (ai.length !== 4) { noAi++; continue; }
  const n = (e.riders || []).length;
  const A = oddsOf(id);
  if (!A || A.cars !== n || !Array.isArray(A.o)) { noOdds++; continue; }
  // 1番人気(確定オッズでいちばん低い3連複。同じ倍率が2組以上なら決めない)
  const cs = tri(n);
  let lo = Infinity, at = -1, tie = false;
  A.o.forEach((v, i) => { if (v > 0 && v < lo) { lo = v; at = i; tie = false; } else if (v > 0 && v === lo) tie = true; });
  if (at < 0 || tie) { noOdds++; continue; }
  const fav = cs[at];
  // AI の4車のうち、同じライン(3人以上)にいる3車の組
  const lines = (e.lines || []).filter((l) => l.length >= 3);
  const lineTrios = [];
  for (const l of lines) {
    const inAi = l.filter((c) => ai.includes(c));
    if (inAi.length === 3) lineTrios.push(key3(inAi));
    if (inAi.length === 4) for (let i = 0; i < 4; i++) lineTrios.push(key3(inAi.filter((_, j) => j !== i)));
  }
  const fin = key3([e.f, e.s, e.t]);
  const pay = e.p3fpay != null ? e.p3fpay : null;
  const aiTrios = [0, 1, 2, 3].map((i) => key3(ai.filter((_, j) => j !== i)));
  rows.push({ id, y: e.date.slice(0, 4), n, klass: e.klass, fav, favOdds: lo, lineFav: lineTrios.includes(fav), aiLine: lineTrios.length > 0,
    favIsLine: lines.some((l) => { const s = new Set(fav.split("=").map(Number)); return l.filter((c) => s.has(c)).length === 3; }),
    fin, pay, favHit: fin === fav, aiHit: aiTrios.includes(fin), inFav: fav.split("=").map(Number).filter((c) => [e.f, e.s, e.t].includes(c)).length });
}

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + "%" : "-");
const med = (a) => { if (!a.length) return "-"; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
function show(lab, g) {
  if (!g.length) { console.log(lab.padEnd(28), "0R"); return; }
  const paid = g.filter((r) => r.pay != null).map((r) => r.pay);
  const favRet = g.filter((r) => r.favHit && r.pay != null).reduce((a, r) => a + r.pay, 0);
  const aiRet = g.filter((r) => r.aiHit && r.pay != null).reduce((a, r) => a + r.pay, 0);
  const share = (lo) => pct(paid.filter((p) => p >= lo).length, paid.length);
  const inF = [0, 1, 2, 3].map((k) => pct(g.filter((r) => r.inFav === k).length, g.length));
  console.log(lab.padEnd(28), String(g.length).padStart(6) + "R",
    "| 1番人気が的中", pct(g.filter((r) => r.favHit).length, g.length), "(回収" + pct(favRet, g.length * 100) + ")",
    "| AI4車ボックス的中", pct(g.filter((r) => r.aiHit).length, g.length), "(回収" + pct(aiRet, g.length * 400) + ")",
    "| 3連複の配当 中央値", med(paid) + "円", "1,000円以上", share(1000), "3,000円以上", share(3000), "10,000円以上", share(10000),
    "| 1番人気の3人のうち3着内 0人/1人/2人/3人", inF.join(" / "));
}
console.log("期間", FROM, "〜", TO, "/ 比べたレース", rows.length, "R(AI予想なし", noAi, "/ 確定オッズが無い・車立てが合わない", noOdds, ")");
console.log("AI予想を取った月:", [...new Set(Object.keys(AI).map((k) => k.slice(0, 6)))].sort().join(","));
const target = rows.filter((r) => r.lineFav);
show("★AIの4車にライン3車・それが1番人気", target);
show("  比べる: 1番人気がライン3車(AI問わず)", rows.filter((r) => r.favIsLine));
show("  比べる: 1番人気がライン3車・AIに入らない", rows.filter((r) => r.favIsLine && !r.lineFav));
show("  比べる: 全レース", rows);
// 分けて見る: ★ = AIの4車にライン3車・それが1番人気 / ☆ = 1番人気がライン3車なのに AI の4車に入らない
const other = rows.filter((r) => r.favIsLine && !r.lineFav);
for (const [mk, g] of [["★", target], ["☆", other]]) {
  console.log("");
  for (const [lab, f] of [["9車(8〜9車)", (r) => r.n >= 8], ["7車", (r) => r.n === 7], ["S級", (r) => r.klass === "s"], ["A級", (r) => r.klass !== "s"]]) show(mk + lab, g.filter(f));
  for (const y of [...new Set(g.map((r) => r.y))].sort()) show(mk + y + "年", g.filter((r) => r.y === y));
  // 1番人気の倍率ごと
  for (const [lab, lo, hi] of [["1番人気 3倍未満", 0, 3], ["3〜5倍", 3, 5], ["5〜8倍", 5, 8], ["8倍以上", 8, 1e9]]) show(mk + lab, g.filter((r) => r.favOdds >= lo && r.favOdds < hi));
}
