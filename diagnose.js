// 評価値の妥当性診断: history.json から
//  1) 評価順位ごとの実際の1着率・3着内率(キャリブレーション)
//  2) 各評価要素が結果とどれだけ相関しているか(の代理指標)
// を出力する。node diagnose.js
const fs = require("fs");
const path = require("path");
const hist = JSON.parse(fs.readFileSync(path.join(__dirname, "history.json"), "utf8"));
const E = (hist.entries || []).filter((e) => Array.isArray(e.ranks) && e.ranks.length >= 5 && e.f);
console.log("診断対象:", E.length, "レース\n");

// 1) 評価順位 rank(1〜7) ごとの 1着率 / 2連対率 / 3着内率
const maxR = 9;
const rows = [];
for (let r = 0; r < maxR; r++) {
  let n = 0, win = 0, ren = 0, in3 = 0;
  for (const e of E) {
    const car = e.ranks[r];
    if (car == null) continue;
    n++;
    if (e.f === car) win++;
    if (e.f === car || e.s === car) ren++;
    if (e.f === car || e.s === car || e.t === car) in3++;
  }
  if (n === 0) continue;
  rows.push({ rank: r + 1, n, win: (win/n*100).toFixed(1), ren: (ren/n*100).toFixed(1), in3: (in3/n*100).toFixed(1) });
}
console.log("=== 評価順位ごとの実測着順率 ===");
console.log("評価順位  1着率  2連対率  3着内率  (n)");
for (const x of rows) {
  console.log(
    "  " + x.rank + "位   " +
    String(x.win).padStart(5) + "%  " +
    String(x.ren).padStart(5) + "%  " +
    String(x.in3).padStart(5) + "%   " + x.n
  );
}
console.log("\n※ 理想は 1位>2位>3位>… と単調に下がること。");
console.log("  隣接順位で逆転(例:2位より3位が高い)があれば、その辺りの評価は機能していない。");

// 2) クラス別に1位の1着率(評価がどのクラスで効いているか)
console.log("\n=== クラス別 評価1位の1着率 ===");
const byK = {};
for (const e of E) {
  const k = e.klass || "?";
  (byK[k] = byK[k] || { n: 0, win: 0 });
  byK[k].n++;
  if (e.f === e.ranks[0]) byK[k].win++;
}
for (const [k, v] of Object.entries(byK)) {
  console.log("  " + k.padEnd(10) + " 1着率 " + (v.win/v.n*100).toFixed(1) + "%  (n=" + v.n + ")");
}

// 3) 評価1位と2位が「隣接ライン(スジ)」だった場合の1-2着的中率(ライン評価の妥当性)
console.log("\n=== 評価1-2位の決着形 ===");
let both12 = 0, top1st = 0, top2in = 0;
for (const e of E) {
  const a = e.ranks[0], b = e.ranks[1];
  if (e.f === a && e.s === b) both12++;
  if (e.f === a) top1st++;
  if (e.s === a || e.f === a) top2in++;
}
console.log("  評価1位が1着: " + (top1st/E.length*100).toFixed(1) + "%");
console.log("  評価1-2位で1-2着(その順): " + (both12/E.length*100).toFixed(1) + "%");
