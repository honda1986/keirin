// ============================================================
// バックテスト・シミュレーター
// history.json の全レースに様々な買い目パターンを適用し、
// 的中率・回収率・収支を比較して sim.json に出力する。
// 使い方: node simulate.js
// 前提: history.json の各エントリに ranks(評価順の全車番), f/s/t(着順), p3pay(3連単配当) が必要。
//        ranks が無い古いデータは自動でスキップします。
// ============================================================
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const hist = JSON.parse(fs.readFileSync(path.join(dir, "history.json"), "utf8"));
const ALL = (hist.entries || []).filter((e) => Array.isArray(e.ranks) && e.ranks.length >= 4 && e.p3pay);
console.log("シミュレーション対象:", ALL.length, "レース (ranks付き)");

// 3連単の順列を生成するヘルパ
function perms3(firsts, seconds, thirds) {
  const out = new Set();
  for (const a of firsts) for (const b of seconds) for (const c of thirds) {
    if (a === b || b === c || a === c) continue;
    out.add(a + "-" + b + "-" + c);
  }
  return [...out];
}

// 買い目パターン定義。ranks=[評価1位車, 2位, 3位, ...] を受けて3連単の目リストを返す
const PATTERNS = {
  // 現行: 1着=1位固定, 2-3着=2〜4位
  "現行(1着1位固定/相手2-4位)": (r) => perms3([r[0]], [r[1], r[2], r[3]], [r[1], r[2], r[3]]),
  // 1着=1〜2位, 2-3着=1〜4位
  "1着1-2位/相手1-4位": (r) => perms3([r[0], r[1]], [r[0], r[1], r[2], r[3]], [r[0], r[1], r[2], r[3]]),
  // 1着=1位, 2着=2〜4位, 3着=2〜5位(3着広め)
  "1着1位/2着2-4位/3着2-5位": (r) => perms3([r[0]], [r[1], r[2], r[3]], [r[1], r[2], r[3], r[4]]),
  // ◎を1-2着に流す: (1位-2〜4位-2〜4位)+(2〜4位-1位-2〜4位)
  "◎1-2着流し(1・2位軸)": (r) => {
    const a = perms3([r[0]], [r[1], r[2], r[3]], [r[1], r[2], r[3]]);
    const b = perms3([r[1], r[2], r[3]], [r[0]], [r[1], r[2], r[3]]);
    return [...new Set([...a, ...b])];
  },
  // 1-3位ボックス(6点)
  "1-3位BOX(6点)": (r) => perms3([r[0], r[1], r[2]], [r[0], r[1], r[2]], [r[0], r[1], r[2]]),
  // 1着=1位, 2-3着=2〜5位
  "1着1位/相手2-5位": (r) => perms3([r[0]], [r[1], r[2], r[3], r[4]], [r[1], r[2], r[3], r[4]]),
  // 1-4位ボックス(24点)
  "1-4位BOX(24点)": (r) => perms3([r[0], r[1], r[2], r[3]], [r[0], r[1], r[2], r[3]], [r[0], r[1], r[2], r[3]]),
  // 1着=1〜2位, 2着=1〜3位, 3着=1〜5位(手広く)
  "1着1-2/2着1-3/3着1-5": (r) => perms3([r[0], r[1]], [r[0], r[1], r[2]], [r[0], r[1], r[2], r[3], r[4]]),
};

// フィルタ定義(どのレースを買うか)
const FILTERS = {
  "全レース": () => true,
  "×除外(◎○△のみ)": (e) => e.verdict !== "×荒れ含み",
  "◎○のみ(スジ寄り以上)": (e) => e.verdict === "◎スジ堅い" || e.verdict === "○スジ寄り",
  "◎のみ": (e) => e.verdict === "◎スジ堅い",
  "S級除外": (e) => e.klass !== "s",
  "×除外+S級除外": (e) => e.verdict !== "×荒れ含み" && e.klass !== "s",
};

function evaluate(patternFn, filterFn) {
  let races = 0, bets = 0, hits = 0, ret = 0;
  for (const e of ALL) {
    if (!filterFn(e)) continue;
    const tickets = patternFn(e.ranks);
    if (!tickets.length) continue;
    races++;
    bets += tickets.length;
    const hitTicket = e.f + "-" + e.s + "-" + e.t;
    if (tickets.includes(hitTicket)) { hits++; ret += e.p3pay; }
  }
  const cost = bets * 100;
  return {
    races, avgPoints: races ? +(bets / races).toFixed(1) : 0,
    hitRate: races ? +(hits / races * 100).toFixed(1) : 0,
    roi: cost ? +(ret / cost * 100).toFixed(1) : 0,
    profit: ret - cost, // 100円/点での収支(円)
  };
}

const results = [];
for (const [pname, pfn] of Object.entries(PATTERNS)) {
  for (const [fname, ffn] of Object.entries(FILTERS)) {
    const r = evaluate(pfn, ffn);
    if (r.races < 20) continue; // サンプル過少は除外
    results.push({ pattern: pname, filter: fname, ...r });
  }
}

// 回収率の高い順
results.sort((a, b) => b.roi - a.roi);

console.log("\n===== 回収率トップ15 =====");
console.log("回収率  的中率  平均点  レース数  収支     | パターン × フィルタ");
for (const r of results.slice(0, 15)) {
  console.log(
    String(r.roi).padStart(5) + "%  " +
    String(r.hitRate).padStart(5) + "%  " +
    String(r.avgPoints).padStart(5) + "  " +
    String(r.races).padStart(6) + "  " +
    (r.profit >= 0 ? "+" : "") + String(r.profit).padStart(6) + "円 | " +
    r.pattern + " × " + r.filter
  );
}

// 現行構成の位置づけ
const cur = results.find((r) => r.pattern.startsWith("現行") && r.filter === "全レース");
if (cur) console.log("\n【現行(全レース)】 回収率" + cur.roi + "% 的中" + cur.hitRate + "% 平均" + cur.avgPoints + "点 収支" + cur.profit + "円");

fs.writeFileSync(path.join(dir, "sim.json"), JSON.stringify({
  updatedAt: new Date().toISOString(),
  sampleRaces: ALL.length,
  results: results.slice(0, 40),
}, null, 0));
console.log("\nsim.json に上位40件を保存しました。");
