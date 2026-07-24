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

// 学習補正を読み込み、riders(素点付き)から「補正後の評価順」を再構築
let LW = null;
try { LW = JSON.parse(fs.readFileSync(path.join(dir, "weights.json"), "utf8")); } catch (e) {}
const kiBand = (ki) => ki >= 121 ? "期121+(若手)" : ki >= 111 ? "期111-120" : ki >= 100 ? "期100-110" : ki > 0 ? "期99以下(ベテラン)" : null;
const ageBand = (a) => a > 0 && a <= 23 ? "23歳以下" : a > 0 && a <= 27 ? "24-27歳" : a > 0 && a <= 35 ? "28-35歳" : a > 35 ? "36歳以上" : null;
let adjCount = 0;
if (LW) {
  for (const e of ALL) {
    if (!Array.isArray(e.riders) || e.riders.length < 5) continue;
    const adj = e.riders.map((rd) => {
      const [car, age, ki, pos, , total] = rd;
      let b = 0;
      const pk = ["head", "second", "third", "tanki"][pos];
      if (LW.posBonus && LW.posBonus[pk]) b += LW.posBonus[pk];
      const kb = kiBand(ki); if (kb && LW.kiBonus && LW.kiBonus[kb]) b += LW.kiBonus[kb];
      const ab = ageBand(age); if (ab && LW.ageBonus && LW.ageBonus[ab]) b += LW.ageBonus[ab];
      return { car, t: (total || 0) + b };
    }).sort((x, y) => y.t - x.t).map((x) => x.car);
    e.adjRanks = e.ranks; // 二重補正を廃止: 保存ranksが既に補正込み
  }
  console.log("注: 保存ランクが既に学習補正込みのため、二重補正[補正後]は生成しません (weights " + (LW ? LW.updatedAt : "なし") + ")");
}

// 3連単の順列を生成するヘルパ
function perms3(firsts, seconds, thirds) {
  const out = new Set();
  for (const a of firsts) for (const b of seconds) for (const c of thirds) {
    if (a === b || b === c || a === c) continue;
    out.add(a + "-" + b + "-" + c);
  }
  return [...out];
}

// ライン補助: 車番cの所属ラインと、その中の隣接車(スジ相手)を返す
function lineOf(lines, c) { return (lines || []).find((l) => l.includes(c)) || null; }
function sujiMates(lines, c) {
  const l = lineOf(lines, c);
  if (!l || l.length < 2) return [];
  const i = l.indexOf(c);
  const out = [];
  if (i > 0) out.push(l[i - 1]);          // 前(先頭側)
  if (i < l.length - 1) out.push(l[i + 1]); // 後(番手側)
  return out;
}
// 買い目パターン定義。(ranks, e) を受けて3連単の目リストを返す。eはレースエントリ(linesを含む)
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

  // ===== ライン(スジ)考慮パターン =====
  // スジ本線: 1着=評価1位, 2着=その同ライン隣接(スジ), 3着=評価2-4位
  "スジ本線(1位→同ライン→2-4位)": (r, e) => {
    const m = sujiMates(e.lines, r[0]);
    if (!m.length) return [];
    return perms3([r[0]], m, [r[1], r[2], r[3]]);
  },
  // スジ+評価: 1着=評価1位, 2着=同ライン隣接 or 評価2位, 3着=評価2-4位
  "スジ+評価2位(1位→スジ/2位→2-4位)": (r, e) => {
    const m = sujiMates(e.lines, r[0]);
    const seconds = [...new Set([...m, r[1]])];
    return perms3([r[0]], seconds, [r[1], r[2], r[3]]);
  },
  // ライン1-2着固め: 評価1位のライン内で1-2着(順不同)→3着は評価2-4位
  "本命ライン1-2着固め": (r, e) => {
    const l = lineOf(e.lines, r[0]);
    if (!l || l.length < 2) return [];
    const out = new Set();
    for (const a of l) for (const b of l) {
      if (a === b) continue;
      for (const c of [r[1], r[2], r[3]]) { if (c !== a && c !== b) out.add(a + "-" + b + "-" + c); }
    }
    return [...out];
  },
  // スジ2着固定・3着広め: 1着=1位, 2着=同ライン隣接, 3着=評価2-5位
  "スジ2着/3着2-5位": (r, e) => {
    const m = sujiMates(e.lines, r[0]);
    if (!m.length) return [];
    return perms3([r[0]], m, [r[1], r[2], r[3], r[4]]);
  },
  // 逆スジ: 同ライン隣接が1着、評価1位が2着(番手抜け・先頭残り)
  "逆スジ(スジ→1位→2-4位)": (r, e) => {
    const m = sujiMates(e.lines, r[0]);
    if (!m.length) return [];
    return perms3(m, [r[0]], [r[1], r[2], r[3]]);
  },
  // スジ表裏: 1-2着を評価1位と同ライン隣接の双方向、3着は評価2-4位
  "スジ表裏(1位⇔スジ)": (r, e) => {
    const m = sujiMates(e.lines, r[0]);
    if (!m.length) return [];
    const a = perms3([r[0]], m, [r[1], r[2], r[3]]);
    const b = perms3(m, [r[0]], [r[1], r[2], r[3]]);
    return [...new Set([...a, ...b])];
  },
};

// ===== 2車単パターン(1着-2着) =====
const perms2 = (fs, ss) => { const o = new Set(); for (const a of fs) for (const b of ss) { if (a === b) continue; o.add(a + "-" + b); } return [...o]; };
const N2_PATTERNS = {
  "2車単 1位→2-3位(2点)": (r) => perms2([r[0]], [r[1], r[2]]),
  "2車単 1位→2-4位(3点)": (r) => perms2([r[0]], [r[1], r[2], r[3]]),
  "2車単 1-2位BOX(2点)": (r) => perms2([r[0], r[1]], [r[0], r[1]]),
  "2車単 1位→スジ相手": (r, e) => { const m = sujiMates(e.lines, r[0]); return m.length ? perms2([r[0]], m) : []; },
  "2車単 スジ表裏(1位⇔スジ)": (r, e) => { const m = sujiMates(e.lines, r[0]); if (!m.length) return []; return [...new Set([...perms2([r[0]], m), ...perms2(m, [r[0]])])]; },
  "2車単 1位→2位(1点)": (r) => perms2([r[0]], [r[1]]),
};
const N2_PATTERN_ID = {
  "2車単 1位→2-3位(2点)": "n2_1_23",
  "2車単 1位→2-4位(3点)": "n2_1_234",
  "2車単 1-2位BOX(2点)": "n2_box12",
  "2車単 1位→スジ相手": "n2_suji",
  "2車単 スジ表裏(1位⇔スジ)": "n2_suji_both",
  "2車単 1位→2位(1点)": "n2_1_2",
};

// フィルタ定義(どのレースを買うか)。e.score=期待度%, e.p3pay=3連単配当, e.verdict/klass/place
const FILTERS_ANCHOR = true;
const FILTERS = {
  "全レース": () => true,
  "×除外": (e) => e.verdict !== "×荒れ含み",
  "◎○のみ": (e) => e.verdict === "◎スジ堅い" || e.verdict === "○スジ寄り",
  "予選のみ": (e) => /予選/.test(e.grade || ""),
  "決勝除外": (e) => !/決勝/.test((e.grade || "").replace(/準決勝?/, "")),
  "予選+一般のみ": (e) => /予選|一般/.test(e.grade || ""),
  "スコア60+かつ決勝除外": (e) => e.score >= 60 && !/決勝/.test((e.grade || "").replace(/準決勝?/, "")),
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

function evaluate(patternFn, filterFn, useAdj, isNishatan) {
  let races = 0, bets = 0, hits = 0, ret = 0;
  for (const e of ALL) {
    if (!filterFn(e)) continue;
    if (isNishatan && e.p2pay == null) continue; // 2車単配当が無いレースは対象外
    const rk = useAdj ? e.adjRanks : e.ranks;
    if (!rk) continue;
    const tickets = patternFn(rk, e);
    if (!tickets.length) continue;
    races++;
    bets += tickets.length;
    if (isNishatan) {
      const hitTicket = e.f + "-" + e.s;
      if (tickets.includes(hitTicket)) { hits++; ret += e.p2pay; }
    } else {
      const hitTicket = e.f + "-" + e.s + "-" + e.t;
      if (tickets.includes(hitTicket)) { hits++; ret += e.p3pay; }
    }
  }
  const cost = bets * 100;
  return {
    races, avgPoints: races ? +(bets / races).toFixed(1) : 0,
    hitRate: races ? +(hits / races * 100).toFixed(1) : 0,
    roi: cost ? +(ret / cost * 100).toFixed(1) : 0,
    profit: Math.round(ret - cost), breakEvenOdds: hits ? +((cost / hits) / 100).toFixed(1) : null,
  };
}

const results = [];
for (const [pname, pfn] of Object.entries(PATTERNS)) {
  for (const [fname, ffn] of Object.entries(FILTERS)) {
    const r = evaluate(pfn, ffn, false);
    if (r.races >= 15) results.push({ pattern: pname, filter: fname, adj: false, ...r });
    if (adjCount >= 100) {
      const r2 = evaluate(pfn, ffn, true);
      if (r2.races >= 15) results.push({ pattern: "[補正後]" + pname, filter: fname, adj: true, ...r2 });
    }
  }
}

// 2車単パターンのバックテスト(配当があるレースのみ対象)
for (const [pname, pfn] of Object.entries(N2_PATTERNS)) {
  for (const [fname, ffn] of Object.entries(FILTERS)) {
    const r = evaluate(pfn, ffn, false, true);
    if (r.races >= 15) results.push({ pattern: pname, filter: fname, adj: false, nishatan: true, ...r });
    if (adjCount >= 100) {
      const r2 = evaluate(pfn, ffn, true, true);
      if (r2.races >= 15) results.push({ pattern: "[補正後]" + pname, filter: fname, adj: true, nishatan: true, ...r2 });
    }
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
    (r.nishatan ? "[2車単]" : "") + r.pattern + " × " + r.filter
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
  "スジ本線(1位→同ライン→2-4位)": "p_suji_main",
  "スジ+評価2位(1位→スジ/2位→2-4位)": "p_suji_plus",
  "本命ライン1-2着固め": "p_line12",
  "スジ2着/3着2-5位": "p_suji_wide",
  "逆スジ(スジ→1位→2-4位)": "p_suji_rev",
  "スジ表裏(1位⇔スジ)": "p_suji_both",
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
  "×除外": { notVerdict: "×荒れ含み" },
  "◎のみ+ガ除外": { verdict: "◎スジ堅い", notKlass: "girls" },
  "◎○+ガ除外": { verdictIn: ["◎スジ堅い", "○スジ寄り"], notKlass: "girls" },
  "予選のみ": { gradeRe: "予選" },
  "決勝除外": { notGradeRe: "(?<!準)決勝" },
  "予選+一般のみ": { gradeRe: "予選|一般" },
  "スコア60+かつ決勝除外": { scoreMin: 60, notGradeRe: "(?<!準)決勝" },
};
// 回収率100%超の構成を「勝ちパターン」として、条件・買い目・回収率つきで保存
const stripAdj = (n) => n.replace(/^\[補正後\]/, "");
  const anyPatId = (n) => PATTERN_ID[stripAdj(n)] || N2_PATTERN_ID[stripAdj(n)];
const winners = results
  .filter((r) => r.roi >= 100 && (adjCount >= 100 ? r.adj : !r.adj) && anyPatId(r.pattern) && FILTER_COND[r.filter])
  .map((r) => ({
    roi: r.roi, hitRate: r.hitRate, avgPoints: r.avgPoints, races: r.races,
    patternId: anyPatId(r.pattern), patternName: r.pattern, betType: r.nishatan ? "nishatan" : "sanrentan", adj: !!r.adj,
    filterName: r.filter, cond: FILTER_COND[r.filter],
  }))
  .sort((a, b) => b.roi - a.roi);

// アプリ用: 条件付き全構成(100%未満も含む)を回収率降順で保存。
// アプリは各レースで「条件に合致する中で最も回収率が高い構成」の買い目を提示する
const allPatterns = results
  .filter((r) => (adjCount >= 100 ? r.adj : !r.adj) && anyPatId(r.pattern) && FILTER_COND[r.filter] && r.races >= 30)
  .map((r) => ({
    roi: r.roi, hitRate: r.hitRate, avgPoints: r.avgPoints, races: r.races,
    patternId: anyPatId(r.pattern), patternName: r.pattern, betType: r.nishatan ? "nishatan" : "sanrentan", adj: !!r.adj,
    filterName: r.filter, cond: FILTER_COND[r.filter],
  }))
  .sort((a, b) => b.roi - a.roi);

fs.writeFileSync(path.join(dir, "sim.json"), JSON.stringify({
  updatedAt: new Date().toISOString(),
  sampleRaces: ALL.length,
  winners,                    // 回収率100%超の勝ちパターン
  allPatterns,                // 全構成(アプリが最良構成を選ぶのに使用)
  results: results.slice(0, 40),
}, null, 0));
console.log("allPatterns:", allPatterns.length, "件を保存(条件付き・30R以上)");
console.log("\n回収率100%超の勝ちパターン:", winners.length, "件");
winners.forEach((w) => console.log("  " + w.roi + "% " + w.patternName + " × " + w.filterName + " (" + w.races + "R)"));
console.log("sim.json に保存しました。");
