// ============================================================
// 学習スクリプト: history.json の選手詳細(riders)から
//  1) ライン内位置別(先頭/番手/3番手/単騎)の実測成績とモデル期待値のズレ
//  2) 年齢・期数(若手)別の同ズレ
//  3) 勝ちライン(1着選手の所属ライン)の傾向
// を算出し、採点補正値を weights.json に出力する。 node learn.js
// riders: [車番, 年齢, 期, 位置(0先頭/1番手/2三番手+/3単騎), 評価順位, 総合点, 競走得点]
//   ※競走得点(7番目)は2026-09-21以降のデータにしか無い
// ============================================================
const fs = require("fs");
const path = require("path");
const dir = __dirname;
const hist = JSON.parse(fs.readFileSync(path.join(dir, "history.json"), "utf8"));
const ALL = (hist.entries || []).filter((e) => Array.isArray(e.riders) && e.riders.length >= 5 && e.f);
console.log("学習対象:", ALL.length, "レース (選手詳細付き)\n");
if (ALL.length < 100) console.log("⚠ サンプルが少なめです。300レース以上を推奨。\n");

// --- 全体: 評価順位ごとの1着率(期待値のベースライン) ---
const rankWin = {}; // rank -> {n, win}
for (const e of ALL) for (const rd of e.riders) {
  const [car, , , , rank] = rd;
  (rankWin[rank] = rankWin[rank] || { n: 0, win: 0 });
  rankWin[rank].n++;
  if (e.f === car) rankWin[rank].win++;
}
const pWinByRank = {};
for (const [r, v] of Object.entries(rankWin)) pWinByRank[r] = v.n ? v.win / v.n : 0;

// --- グループ別の実測 vs 期待 ---
function groupStats(assignFn, labels) {
  const g = {};
  for (const e of ALL) for (const rd of e.riders) {
    const key = assignFn(rd, e);
    if (key == null) continue;
    (g[key] = g[key] || { n: 0, win: 0, ren: 0, in3: 0, expWin: 0 });
    const [car, , , , rank] = rd;
    g[key].n++;
    g[key].expWin += pWinByRank[rank] || 0;
    if (e.f === car) g[key].win++;
    if (e.f === car || e.s === car) g[key].ren++;
    if (e.f === car || e.s === car || e.t === car) g[key].in3++;
  }
  const out = [];
  for (const key of labels.filter((l) => g[l])) {
    const v = g[key];
    const act = v.win / v.n, exp = v.expWin / v.n;
    out.push({ key, n: v.n, win: +(act * 100).toFixed(1), exp: +(exp * 100).toFixed(1),
      ren: +(v.ren / v.n * 100).toFixed(1), in3: +(v.in3 / v.n * 100).toFixed(1),
      bias: +((act - exp) * 100).toFixed(1) });
  }
  return out;
}

const POS_LABELS = ["先頭", "番手", "3番手+", "単騎"];
const posStats = groupStats((rd) => POS_LABELS[rd[3]], POS_LABELS);
console.log("=== ライン内位置別(実測1着率 vs モデル期待値) ===");
console.log("位置      n      実測1着  期待1着  乖離   連対率  3着内");
for (const s of posStats) console.log(
  "  " + s.key.padEnd(6) + String(s.n).padStart(6) + "  " + String(s.win).padStart(5) + "%  " +
  String(s.exp).padStart(5) + "%  " + (s.bias >= 0 ? "+" : "") + s.bias + "pt  " + String(s.ren).padStart(5) + "%  " + s.in3 + "%");
console.log("  ※乖離+ = モデルの評価以上に実際は勝っている(=評価を上げるべき)\n");

const kiBand = (ki) => ki >= 121 ? "期121+(若手)" : ki >= 111 ? "期111-120" : ki >= 100 ? "期100-110" : ki > 0 ? "期99以下(ベテラン)" : null;
const KI_LABELS = ["期121+(若手)", "期111-120", "期100-110", "期99以下(ベテラン)"];
const kiStats = groupStats((rd) => kiBand(rd[2]), KI_LABELS);
console.log("=== 期数帯別(若手ほど数字が大きい) ===");
console.log("期数帯              n      実測1着  期待1着  乖離");
for (const s of kiStats) console.log(
  "  " + s.key.padEnd(14) + String(s.n).padStart(6) + "  " + String(s.win).padStart(5) + "%  " +
  String(s.exp).padStart(5) + "%  " + (s.bias >= 0 ? "+" : "") + s.bias + "pt");
console.log("");

const ageBand = (a) => a > 0 && a <= 23 ? "23歳以下" : a <= 27 ? "24-27歳" : a <= 35 ? "28-35歳" : a > 35 ? "36歳以上" : null;
const AGE_LABELS = ["23歳以下", "24-27歳", "28-35歳", "36歳以上"];
const ageStats = groupStats((rd) => ageBand(rd[1]), AGE_LABELS);
console.log("=== 年齢帯別 ===");
console.log("年齢帯        n      実測1着  期待1着  乖離");
for (const s of ageStats) console.log(
  "  " + s.key.padEnd(8) + String(s.n).padStart(6) + "  " + String(s.win).padStart(5) + "%  " +
  String(s.exp).padStart(5) + "%  " + (s.bias >= 0 ? "+" : "") + s.bias + "pt");
console.log("");

// --- 勝ちライン分析: 1着選手の位置と、勝ったラインの特徴 ---
console.log("=== 勝ちライン分析 ===");
let lineRaces = 0; const winnerPos = { 先頭: 0, 番手: 0, "3番手+": 0, 単騎: 0 };
const headRankWin = {}; // 勝ちライン先頭の評価順位分布
for (const e of ALL) {
  if (!Array.isArray(e.lines)) continue;
  const winLine = e.lines.find((l) => l.includes(e.f));
  if (!winLine) continue;
  lineRaces++;
  const idx = winLine.length === 1 ? 3 : Math.min(winLine.indexOf(e.f), 2);
  winnerPos[POS_LABELS[idx]]++;
  // 勝ちラインの先頭の評価順位
  const rd = e.riders.find((x) => x[0] === winLine[0]);
  if (rd) { const hr = rd[4]; headRankWin[hr] = (headRankWin[hr] || 0) + 1; }
}
console.log("1着選手の位置内訳(" + lineRaces + "レース):",
  POS_LABELS.map((l) => l + " " + (winnerPos[l] / lineRaces * 100).toFixed(1) + "%").join(" / "));
console.log("勝ちライン先頭の評価順位分布:",
  Object.entries(headRankWin).sort((a, b) => a[0] - b[0]).map(([r, n]) => r + "位:" + (n / lineRaces * 100).toFixed(0) + "%").join(" "));
console.log("");

// --- 位置×年齢 の交互作用(的は「3着以内率」) ---
// なぜ的を変えるか:
//   上の posBonus / ageBonus は「1着率」の乖離から作っている。ところがアプリが買うのは
//   三連複(本命ライン3人)で、当たるかどうかは「3人が揃って3着以内に入るか」で決まる。
//   実測では、1着率で学習した補正は三連複の成績をむしろ下げた(回収 104.3%→103.9%)。
//   的を3着以内率に変えると 104.3%→106.3% に改善したので、この項だけ的を変える。
// なぜ加法項では足りないか:
//   例: 単騎は年齢で真逆になる。28-35歳は3着内が期待より +2.5pt、50歳以上は -11.6pt。
//   位置と年齢を別々に足すだけでは、この差は表現できない。
const AGE6 = (a) => !(a > 0) ? null : a <= 23 ? "〜23" : a <= 27 ? "24-27" : a <= 35 ? "28-35" : a <= 43 ? "36-43" : a <= 49 ? "44-49" : "50〜";
const AGE6_LABELS = ["〜23", "24-27", "28-35", "36-43", "44-49", "50〜"];
const isIn3 = (e, car) => e.f === car || e.s === car || e.t === car;

// 3着以内率のベースライン(評価順位ごと)
const rankIn3 = {};
for (const e of ALL) for (const rd of e.riders) {
  const r = rd[4];
  (rankIn3[r] = rankIn3[r] || { n: 0, hit: 0 });
  rankIn3[r].n++;
  if (isIn3(e, rd[0])) rankIn3[r].hit++;
}
const pIn3ByRank = {};
for (const [r, v] of Object.entries(rankIn3)) pIn3ByRank[r] = v.n ? v.hit / v.n : 0;

// 3着以内率を的にしたグループ集計(上の groupStats と同じ作りで、的だけ違う)
function groupIn3(assignFn) {
  const g = {};
  for (const e of ALL) for (const rd of e.riders) {
    const key = assignFn(rd);
    if (key == null) continue;
    (g[key] = g[key] || { n: 0, hit: 0, exp: 0 });
    g[key].n++;
    g[key].exp += pIn3ByRank[rd[4]] || 0;
    if (isIn3(e, rd[0])) g[key].hit++;
  }
  const o = {};
  for (const [k, v] of Object.entries(g)) o[k] = { n: v.n, bias: +((v.hit / v.n - v.exp / v.n) * 100).toFixed(1) };
  return o;
}
const posIn3 = groupIn3((rd) => POS_LABELS[rd[3]]);
const ageIn3 = groupIn3((rd) => ageBand(rd[1]));
const cellIn3 = groupIn3((rd) => POS_LABELS[rd[3]] + "|" + AGE6(rd[1]));

// --- 補正値の算出(乖離ptを控えめな係数で採点ボーナスに変換、±5点でクリップ) ---
const toBonus = (bias) => Math.max(-5, Math.min(5, +(bias * 0.55).toFixed(1)));
const posBonus = {};
for (const s of posStats) posBonus[["head", "second", "third", "tanki"][POS_LABELS.indexOf(s.key)]] = s.n >= 200 ? toBonus(s.bias) : 0;
const kiBonus = {};
for (const s of kiStats) kiBonus[s.key] = s.n >= 200 ? toBonus(s.bias) : 0;
const ageBonus = {};
for (const s of ageStats) ageBonus[s.key] = s.n >= 200 ? toBonus(s.bias) : 0;

// 位置×年齢: セルの補正から「位置だけ」「年齢だけ」で説明できる分を引いた残り(=交互作用)。
// 引かないと、加法項と二重に効いてしまう。
const POS_KEY = { "先頭": "head", "番手": "second", "3番手+": "third", "単騎": "tanki" };
const AGE6_MID = { "〜23": 23, "24-27": 25, "28-35": 30, "36-43": 40, "44-49": 46, "50〜": 55 };
const posAgeBonus = {};
for (const p of POS_LABELS) for (const a of AGE6_LABELS) {
  const v = cellIn3[p + "|" + a];
  if (!v || v.n < 200) continue;                       // サンプル不足のセルは作らない
  const pb = (posIn3[p] && posIn3[p].n >= 200) ? toBonus(posIn3[p].bias) : 0;
  const ab0 = ageIn3[ageBand(AGE6_MID[a])];
  const ab = (ab0 && ab0.n >= 200) ? toBonus(ab0.bias) : 0;
  const d = +(toBonus(v.bias) - pb - ab).toFixed(2);
  if (d !== 0) posAgeBonus[POS_KEY[p] + "|" + a] = d;
}

const weights = {
  updatedAt: new Date().toISOString(), sample: ALL.length,
  posBonus,   // {head, second, third, tanki} 採点への加点
  kiBonus,    // 期数帯 → 加点
  ageBonus,   // 年齢帯 → 加点
  posAgeBonus, // "head|36-43" → 加点。位置×年齢の交互作用のみ(的は3着以内率)
  note: "実測1着率とモデル期待値の乖離から算出(係数0.55, ±5点クリップ, n>=200のみ)。" +
        "posAgeBonus だけは三連複の的中(3人が3着以内)に合わせ、3着以内率の乖離から算出している。",
};
fs.writeFileSync(path.join(dir, "weights.json"), JSON.stringify(weights, null, 0));
console.log("=== 学習した補正値(weights.json) ===");
console.log("位置ボーナス:", JSON.stringify(posBonus));
console.log("期数ボーナス:", JSON.stringify(kiBonus));
console.log("");
console.log("=== 位置×年齢の交互作用(的=3着以内率) ===");
console.log("位置      年齢      n      実測-期待  交互作用");
for (const p of POS_LABELS) for (const a of AGE6_LABELS) {
  const v = cellIn3[p + "|" + a]; if (!v) continue;
  const k = POS_KEY[p] + "|" + a;
  console.log("  " + p.padEnd(6) + a.padEnd(8) + String(v.n).padStart(6) + "  " +
    ((v.bias >= 0 ? "+" : "") + v.bias + "pt").padStart(8) + "  " +
    (v.n < 200 ? "(n不足)" : String(posAgeBonus[k] != null ? posAgeBonus[k] : 0).padStart(6)));
}
console.log("年齢ボーナス:", JSON.stringify(ageBonus));
console.log("\nエンジンがこの補正を採点に反映します(weights.json を読み込み)。");
