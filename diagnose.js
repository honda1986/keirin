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

// 2.5) 評価1位の「ライン内位置」別の信頼度 ← 本命が先頭/番手/3番手/単騎で成績が違うか
const WITH_R = E.filter((e) => Array.isArray(e.riders) && e.riders.length >= 5);
if (WITH_R.length >= 100) {
  console.log("\n=== 評価1位のライン内位置別 信頼度(" + WITH_R.length + "レース) ===");
  const POS = ["先頭", "番手", "3番手+", "単騎"];
  const g = {};
  for (const e of WITH_R) {
    const top = e.ranks[0];
    const rd = e.riders.find((x) => x[0] === top);
    if (!rd) continue;
    const key = POS[rd[3]];
    (g[key] = g[key] || { n: 0, win: 0, ren: 0, in3: 0, pay: 0, hit3: 0, bet3: 0 });
    const v = g[key];
    v.n++;
    if (e.f === top) v.win++;
    if (e.f === top || e.s === top) v.ren++;
    if (e.f === top || e.s === top || e.t === top) v.in3++;
    // 現行6点(1着=1位固定/相手2-4位)での的中・回収
    if (Array.isArray(e.ranks) && e.ranks.length >= 4) {
      const t = [];
      for (const b of [e.ranks[1], e.ranks[2], e.ranks[3]]) for (const c of [e.ranks[1], e.ranks[2], e.ranks[3]]) {
        if (b !== c) t.push(top + "-" + b + "-" + c);
      }
      v.bet3 += t.length;
      if (t.includes(e.f + "-" + e.s + "-" + e.t)) { v.hit3++; v.pay += e.p3pay || 0; }
    }
  }
  console.log("位置      n      1着率   連対率  3着内   6点的中  6点回収率");
  for (const k of POS) {
    const v = g[k]; if (!v || !v.n) continue;
    const roi = v.bet3 ? (v.pay / (v.bet3 * 100) * 100).toFixed(1) : "—";
    console.log(
      "  " + k.padEnd(6) + String(v.n).padStart(6) + "  " +
      (v.win / v.n * 100).toFixed(1).padStart(5) + "%  " +
      (v.ren / v.n * 100).toFixed(1).padStart(5) + "%  " +
      (v.in3 / v.n * 100).toFixed(1).padStart(5) + "%  " +
      (v.hit3 / v.n * 100).toFixed(1).padStart(5) + "%  " +
      String(roi).padStart(6) + "%");
  }
  console.log("  ※1着率が高い位置ほど本命の信頼度が高い。回収率が高い位置だけ買う戦略も検討できる。");

  // クラス×位置のクロス集計(S級の番手は堅い等)
  console.log("\n=== クラス × 評価1位の位置(1着率) ===");
  const cx = {};
  for (const e of WITH_R) {
    const top = e.ranks[0];
    const rd = e.riders.find((x) => x[0] === top);
    if (!rd) continue;
    const key = (e.klass || "?") + "|" + POS[rd[3]];
    (cx[key] = cx[key] || { n: 0, win: 0 });
    cx[key].n++;
    if (e.f === top) cx[key].win++;
  }
  const klasses = [...new Set(WITH_R.map((e) => e.klass || "?"))];
  console.log("クラス      " + POS.map((p) => p.padStart(8)).join(""));
  for (const k of klasses) {
    let line = "  " + k.padEnd(10);
    for (const p of POS) {
      const v = cx[k + "|" + p];
      line += v && v.n >= 20 ? ((v.win / v.n * 100).toFixed(0) + "%(" + v.n + ")").padStart(8) : "     —  ";
    }
    console.log(line);
  }
}

// 2.7) レース種別(予選/準決勝/決勝など)別の荒れ具合と成績
{
  const typeOf = (g) => {
    if (!g) return null;
    if (/決勝/.test(g) && !/準決/.test(g)) return "決勝";
    if (/準決/.test(g)) return "準決勝";
    if (/予選/.test(g)) return "予選";
    if (/特選|優秀/.test(g)) return "特選・優秀";
    if (/一般/.test(g)) return "一般";
    return "その他";
  };
  const WITH_G = E.filter((e) => e.grade && typeOf(e.grade));
  if (WITH_G.length >= 100) {
    console.log("\n=== レース種別ごとの荒れ具合(" + WITH_G.length + "レース) ===");
    const g = {};
    for (const e of WITH_G) {
      const key = typeOf(e.grade);
      (g[key] = g[key] || { n: 0, suji: 0, hw: 0, pay: 0, payN: 0, hi: 0 });
      const v = g[key];
      v.n++;
      if (e.suji) v.suji++;
      if (e.honmeiWin) v.hw++;
      if (e.p3pay) { v.pay += e.p3pay; v.payN++; if (e.p3pay >= 10000) v.hi++; }
    }
    console.log("種別        n     スジ決着  ◎1着率  平均配当   万車率");
    for (const k of ["予選", "一般", "特選・優秀", "準決勝", "決勝", "その他"]) {
      const v = g[k]; if (!v || v.n < 30) continue;
      console.log("  " + k.padEnd(7) + String(v.n).padStart(5) + "  " +
        (v.suji / v.n * 100).toFixed(1).padStart(6) + "%  " +
        (v.hw / v.n * 100).toFixed(1).padStart(5) + "%  " +
        Math.round(v.pay / (v.payN || 1)).toLocaleString().padStart(7) + "円  " +
        (v.hi / (v.payN || 1) * 100).toFixed(1).padStart(5) + "%");
    }
    console.log("  ※スジ決着率・◎1着率が低く平均配当が高い種別ほど「荒れる」。");
    console.log("  ※種別はgrade文字列から判定(グレードレースの勝ち上がり構造は簡略化)。");
  } else {
    console.log("\n(レース種別分析: grade付きデータが" + WITH_G.length + "件のためスキップ。新規収集分から貯まります)");
  }
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
