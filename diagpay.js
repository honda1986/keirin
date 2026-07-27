// ============================================================
// diagpay.js — 読み取り専用。history.json の着順・配当に複式が混ざっていないか点検する。
//
// 何も書き込まない。ネットにも繋がない。history.json を読むだけ。
// → concurrency 不要。いつ実行しても安全。
//
// 使い方: node diagpay.js
// ============================================================
const fs = require("fs");
const path = require("path");

const hist = JSON.parse(fs.readFileSync(path.join(__dirname, "history.json"), "utf8"));
const E = hist.entries || hist;
console.log("全エントリ:", E.length, "件\n");

// ------------------------------------------------------------
// ① 着順の並びパターン分布
//   3連複を3連単として誤読すると、着順が「車番の小さい順」になる。
//   きれいなデータなら6通りがだいたい均等に散る(車1が強いので昇順がやや多め、
//   目安18〜22%)。昇順だけが突出していたら誤読が残っている。
// ------------------------------------------------------------
// 配列で持つ。オブジェクトのキーにすると "102" 等が配列添字扱いされ並び順が狂う。
const LABEL = [["012", "昇順 ←誤読の型"], ["021", "小大中"], ["102", "中小大"], ["120", "中大小"], ["201", "大小中"], ["210", "降順"]];
function pat(f, s, t) {
  const a = [f, s, t];
  if (a.some((x) => x == null)) return null;
  if (new Set(a).size !== 3) return null;
  const sorted = a.slice().sort((x, y) => x - y);
  return a.map((x) => sorted.indexOf(x)).join("");
}

const cnt = {};
let with3 = 0;
for (const e of E) {
  const p = pat(e.f, e.s, e.t);
  if (!p) continue;
  with3++;
  cnt[p] = (cnt[p] || 0) + 1;
}
console.log("① 着順の並びパターン(3着まで揃っている", with3, "件)");
for (const [k, name] of LABEL) {
  const c = cnt[k] || 0;
  const pct = with3 ? ((c / with3) * 100).toFixed(1) : "0.0";
  const bar = "#".repeat(Math.round((c / Math.max(1, with3)) * 60));
  console.log(`   ${name.padEnd(14)} ${String(c).padStart(6)}件 ${pct.padStart(5)}%  ${bar}`);
}
const ascPct = with3 ? ((cnt["012"] || 0) / with3) * 100 : 0;
console.log(ascPct > 30
  ? `   → 昇順が ${ascPct.toFixed(1)}% は明らかに多すぎる。複式の誤読が残っている。`
  : `   → 昇順 ${ascPct.toFixed(1)}%。この項目だけ見れば異常なし。`);

// ------------------------------------------------------------
// ② 3連単配当 ÷ 2車単配当
//   本物の3連単は2車単に「3着を当てる」条件が乗るので、普通は3倍以上つく。
//   1〜2倍しかない行は、3連複が3連単の枠に入っている疑いが濃い。
// ------------------------------------------------------------
const BINS = [1, 1.5, 2, 3, 5, 10, 1e9];
const BNAME = ["1.0〜1.5倍 ←疑わしい", "1.5〜2.0倍 ←疑わしい", "2.0〜3.0倍", "3.0〜5.0倍", "5.0〜10倍", "10倍以上"];
const bin = new Array(BNAME.length).fill(0);
let ratioN = 0, under2 = 0;
const suspects = [];
for (const e of E) {
  if (!e.p3pay || !e.p2pay) continue;
  const r = e.p3pay / e.p2pay;
  ratioN++;
  for (let i = 0; i < BINS.length - 1; i++) {
    if (r >= BINS[i] && r < BINS[i + 1]) { bin[i]++; break; }
  }
  if (r < 2) {
    under2++;
    if (pat(e.f, e.s, e.t) === "012") suspects.push({ e, r });
  }
}
console.log("\n② 3連単配当 ÷ 2車単配当(両方ある", ratioN, "件)");
for (let i = 0; i < BNAME.length; i++) {
  const pct = ratioN ? ((bin[i] / ratioN) * 100).toFixed(1) : "0.0";
  console.log(`   ${BNAME[i].padEnd(22)} ${String(bin[i]).padStart(6)}件 ${pct.padStart(5)}%`);
}
console.log(`   → 2倍未満が ${under2}件 (${ratioN ? ((under2 / ratioN) * 100).toFixed(1) : 0}%)`);

// ------------------------------------------------------------
// ③ 両方に引っかかった本命容疑者(昇順 かつ 2倍未満)
// ------------------------------------------------------------
console.log("\n③ 昇順 かつ 2倍未満 =", suspects.length, "件");
suspects.slice(0, 15).forEach(({ e, r }) => {
  console.log(`   ${e.date} ${e.place} ${e.raceNo}  着順${e.f}-${e.s}-${e.t}  3連単${e.p3pay} / 2車単${e.p2pay} = ${r.toFixed(2)}倍`);
});
if (suspects.length > 15) console.log(`   …ほか ${suspects.length - 15}件`);

// ------------------------------------------------------------
// ④ 月別。3〜4月に偏っていれば、あのときの破損が残っているということ。
// ------------------------------------------------------------
const bym = {};
for (const e of E) {
  const m = String(e.date).slice(0, 6);
  const b = (bym[m] = bym[m] || { n: 0, asc: 0, low: 0, r: 0 });
  b.n++;
  if (pat(e.f, e.s, e.t) === "012") b.asc++;
  if (e.p3pay && e.p2pay) { b.r++; if (e.p3pay / e.p2pay < 2) b.low++; }
}
console.log("\n④ 月別");
console.log("   月       件数    昇順率   2倍未満率");
for (const m of Object.keys(bym).sort()) {
  const b = bym[m];
  const a = ((b.asc / Math.max(1, b.n)) * 100).toFixed(1);
  const l = b.r ? ((b.low / b.r) * 100).toFixed(1) : "  - ";
  console.log(`   ${m}  ${String(b.n).padStart(6)}  ${a.padStart(6)}%  ${String(l).padStart(6)}%`);
}

console.log("\n※ ①が30%超、または④で特定の月だけ跳ねていたら、3連複の検証前に fixpay をやり直すこと。");
