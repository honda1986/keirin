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
  // 超タイト系(点数を絞って回収率を狙う)
  "1着1位/相手2-3位(2点)": (r) => perms3([r[0]], [r[1], r[2]], [r[1], r[2]]),
  "1着1位/2着2-3位/3着2-4位(4点)": (r) => perms3([r[0]], [r[1], r[2]], [r[1], r[2], r[3]]),
};

// フィルタ定義(どのレースを買うか)。e.score=期待度%, e.p3pay=3連単配当, e.verdict/klass/place
const FILTERS = {
  "全レース": () => true,
  "×除外": (e) => e.verdict !== "×荒れ含み",
  "◎○のみ": (e) => e.verdict === "◎スジ堅い" || e.verdict === "○スジ寄り",
  "◎のみ": (e) => e.verdict === "◎スジ堅い",
  // 期待度スコアの閾値(判定バケットより細かく)
  "スコア55+": (e) => (e.score || 0) >= 55,
  "スコア58+": (e) => (e.score || 0) >= 58,
  "スコア60+": (e) => (e.score || 0) >= 60,
  "スコア62+": (e) => (e.score || 0) >= 62,
  // 配当ゾーン(3連単配当。当たったレースの配当なので事前フィルタではないが傾向把握用)
  // ※注: p3payは結果配当。買う前には分からないが「どの配当帯が的中に寄与するか」を見る参考
  // クラス
  "S級のみ": (e) => e.klass === "s",
  "A級のみ": (e) => e.klass === "a12",
  "チャレンジのみ": (e) => e.klass === "challenge",
  "ガールズのみ": (e) => e.klass === "girls",
  "ガールズ除外": (e) => e.klass !== "girls",
  // 複合
  "◎のみ+ガ除外": (e) => e.verdict === "◎スジ堅い" && e.klass !== "girls",
  "スコア58+かつガ除外": (e) => (e.score || 0) >= 58 && e.klass !== "girls",
  "◎○+ガ除外": (e) => (e.verdict === "◎スジ堅い" || e.verdict === "○スジ寄り") && e.klass !== "girls",
  // 複合(診断結果より: S級は評価1位の1着率が低い=足を引っ張る)
  "スコア60+かつS級除外": (e) => (e.score || 0) >= 60 && e.klass !== "s",
  "スコア62+かつS級除外": (e) => (e.score || 0) >= 62 && e.klass !== "s",
  "スコア64+": (e) => (e.score || 0) >= 64,
  "スコア66+": (e) => (e.score || 0) >= 66,
  "A級のみスコア58+": (e) => e.klass === "a12" && (e.score || 0) >= 58,
  "チャレンジのみスコア58+": (e) => e.klass === "challenge" && (e.score || 0) >= 58,
  // 接戦度(評価1位と2位の点差)。gapフィールドがあるデータのみ対象
  "1位抜け(gap5+)": (e) => (e.gap || 0) >= 5,
  "1位抜け(gap8+)": (e) => (e.gap || 0) >= 8,
  "gap5+かつスコア58+": (e) => (e.gap || 0) >= 5 && (e.score || 0) >= 58,
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
    if (r.races < 15) continue; // サンプル過少は除外
    results.push({ pattern: pname, filter: fname, ...r });
  }
}

// 回収率の高い順
results.sort((a, b) => b.roi - a.roi);

console.log("\n===== 回収率トップ25 =====");
console.log("回収率  的中率  平均点  レース数  収支     | パターン × フィルタ");
for (const r of results.slice(0, 25)) {
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

// ---- アプリ用: 各構成に「機械可読な条件」と「買い目タイプ」を付与して勝ちパターンを抽出 ----
// パターン名→買い目タイプID(アプリ側で同じ関数を実装)
const PATTERN_ID = {
  "現行(1着1位固定/相手2-4位)": "p_1_234",
  "1着1位/相手2-5位": "p_1_2345",
  "1着1位/2着2-4位/3着2-5位": "p_1_234_2345",
  "1着1-2位/相手1-4位": "p_12_1234",
  "1-3位BOX(6点)": "p_box123",
  "1着1位/相手2-5位": "p_1_2345",
  "1着1位/相手2-3位(2点)": "p_1_23",
  "1着1位/2着2-3位/3着2-4位(4点)": "p_1_23_234",
  "1着1-2/2着1-3/3着1-5": "p_12_123_12345",
  "1-4位BOX(24点)": "p_box1234",
};
// フィルタ名→機械可読な条件(アプリ側で判定)
const FILTER_COND = {
  "全レース": {},
  "◎のみ": { verdict: "◎スジ堅い" },
  "スコア58+": { scoreMin: 58 },
  "スコア60+": { scoreMin: 60 },
  "スコア62+": { scoreMin: 62 },
  "スコア64+": { scoreMin: 64 },
  "スコア66+": { scoreMin: 66 },
  "スコア62+かつS級除外": { scoreMin: 62, notKlass: "s" },
  "スコア60+かつS級除外": { scoreMin: 60, notKlass: "s" },
  "スコア58+かつガ除外": { scoreMin: 58, notKlass: "girls" },
  "A級のみスコア58+": { klass: "a12", scoreMin: 58 },
  "チャレンジのみスコア58+": { klass: "challenge", scoreMin: 58 },
  "1位抜け(gap5+)": { gapMin: 5 },
  "1位抜け(gap8+)": { gapMin: 8 },
  "gap5+かつスコア58+": { gapMin: 5, scoreMin: 58 },
  "ガールズのみ": { klass: "girls" },
  "S級のみ": { klass: "s" },
  "A級のみ": { klass: "a12" },
  "チャレンジのみ": { klass: "challenge" },
  "ガールズ除外": { notKlass: "girls" },
  "◎○のみ": { verdictIn: ["◎スジ堅い", "○スジ寄り"] },
};
// 回収率100%超の構成を「勝ちパターン」として、条件・買い目・回収率つきで保存
const winners = results
  .filter((r) => r.roi >= 100 && PATTERN_ID[r.pattern] && FILTER_COND[r.filter])
  .map((r) => ({
    roi: r.roi, hitRate: r.hitRate, avgPoints: r.avgPoints, races: r.races,
    patternId: PATTERN_ID[r.pattern], patternName: r.pattern,
    filterName: r.filter, cond: FILTER_COND[r.filter],
  }))
  .sort((a, b) => b.roi - a.roi);

fs.writeFileSync(path.join(dir, "sim.json"), JSON.stringify({
  updatedAt: new Date().toISOString(),
  sampleRaces: ALL.length,
  winners,                    // 回収率100%超の勝ちパターン(アプリが使用)
  results: results.slice(0, 40),
}, null, 0));
console.log("\n回収率100%超の勝ちパターン:", winners.length, "件");
winners.forEach((w) => console.log("  " + w.roi + "% " + w.patternName + " × " + w.filterName + " (" + w.races + "R)"));
console.log("sim.json に保存しました。");
