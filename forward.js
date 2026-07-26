// ============================================================
// forward.js — 「前向き検証(フォワードテスト)」
//
// 過去データで見つけた構成は、試した組み合わせが多いほど
// 偶然よく見えるものが混ざる。本物かどうかは
// 「仮説を決めた時点より後のレース」だけで確かめるしかない。
//
// このスクリプトは:
//   1. 検証したい構成を forward.json に登録する(登録日=起点)
//   2. 起点より後のレースだけを対象に、実測の的中率・回収率を集計する
//   3. 過去データでの数字と並べて表示し、乖離が見えるようにする
//
// 使い方:
//   node forward.js add <patternId> <filterName>   構成を登録(sim.jsonから条件を取得)
//   node forward.js addtop                          sim.jsonのTOP構成を登録
//   node forward.js                                 登録済み構成の成績を集計・表示
//   node forward.js list                            登録内容の確認
//   node forward.js remove <番号>                   登録の削除
// ============================================================
const fs = require("fs");
const path = require("path");
const dir = __dirname;

const load = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { return d; } };
const save = (f, o) => fs.writeFileSync(path.join(dir, f), JSON.stringify(o, null, 2));

const hist = load("history.json", { entries: [] });
const sim = load("sim.json", { allPatterns: [] });
const fw = load("forward.json", { items: [] });

// ---- 買い目の組み立て(simulate.js と同じ定義) ----
const p2 = (fsA, ssA) => { const o = new Set(); for (const a of fsA) for (const b of ssA) { if (a !== b) o.add(a + "-" + b); } return [...o]; };
const p3 = (fsA, ssA, tsA) => { const o = new Set(); for (const a of fsA) for (const b of ssA) for (const c of tsA) { if (a !== b && b !== c && a !== c) o.add(a + "-" + b + "-" + c); } return [...o]; };
const mates = (L, c) => { const l = (L || []).find((x) => x.includes(c)); if (!l || l.length < 2) return []; const i = l.indexOf(c); const o = []; if (i > 0) o.push(l[i - 1]); if (i < l.length - 1) o.push(l[i + 1]); return o; };
const BLD = {
  n2_1_23: (r) => p2([r[0]], [r[1], r[2]]),
  n2_1_234: (r) => p2([r[0]], [r[1], r[2], r[3]]),
  n2_box12: (r) => p2([r[0], r[1]], [r[0], r[1]]),
  n2_1_2: (r) => p2([r[0]], [r[1]]),
  n2_suji: (r, L) => { const m = mates(L, r[0]); return m.length ? p2([r[0]], m) : []; },
  n2_suji_both: (r, L) => { const m = mates(L, r[0]); if (!m.length) return []; return [...new Set([...p2([r[0]], m), ...p2(m, [r[0]])])]; },
  n2_ana_567: (r) => p2([r[0]], [r[4], r[5], r[6]].filter(Boolean)),
  n2_ana_4567: (r) => p2([r[0]], [r[3], r[4], r[5], r[6]].filter(Boolean)),
  n2_ana_nonsuji: (r, L) => { const m = mates(L, r[0]); const o = r.slice(1).filter((c) => !m.includes(c)); return o.length ? p2([r[0]], o) : []; },
  n2_ana_head456: (r) => p2([r[3], r[4], r[5]].filter(Boolean), [r[0], r[1]]),
  n2_ana_23_1: (r) => p2([r[1], r[2]], [r[0]]),
  p_1_234: (r) => p3([r[0]], [r[1], r[2], r[3]], [r[1], r[2], r[3]]),
  p_suji_main: (r, L) => { const m = mates(L, r[0]); return m.length ? p3([r[0]], m, [r[1], r[2], r[3]]) : []; },
};

// ---- 条件判定(results.js の condOk と同じ) ----
const condOk = (cond, e) => {
  if (!cond) return true;
  if (cond.scoreMin != null && !((e.score || 0) >= cond.scoreMin)) return false;
  if (cond.scoreMax != null && !((e.score || 0) < cond.scoreMax)) return false;
  if (cond.gapMin != null && !(e.gap != null && e.gap >= cond.gapMin)) return false;
  if (cond.gapMax != null && !(e.gap != null && e.gap < cond.gapMax)) return false;
  if (cond.klass && e.klass !== cond.klass) return false;
  if (cond.notKlass && e.klass === cond.notKlass) return false;
  if (cond.verdict && e.verdict !== cond.verdict) return false;
  if (cond.notVerdict && e.verdict === cond.notVerdict) return false;
  if (cond.verdictIn && !cond.verdictIn.includes(e.verdict)) return false;
  if (cond.patternRe && !(e.pattern && new RegExp(cond.patternRe).test(e.pattern))) return false;
  if (cond.gradeRe && !(e.grade && new RegExp(cond.gradeRe).test(e.grade))) return false;
  if (cond.notGradeRe && e.grade && new RegExp(cond.notGradeRe).test(e.grade)) return false;
  if (cond.lineSizeMin != null || cond.lineSizeEq != null || cond.topIsHead != null || cond.topNotTail != null) {
    const l0 = (e.lines || []).find((x) => x.includes((e.ranks || [])[0]));
    if (cond.lineSizeMin != null && !(l0 && l0.length >= cond.lineSizeMin)) return false;
    if (cond.lineSizeEq != null && !(l0 && l0.length === cond.lineSizeEq)) return false;
    if (cond.topIsHead != null) {
      const isHead = !!(l0 && l0.length >= 2 && l0[0] === e.ranks[0]);
      if (isHead !== cond.topIsHead) return false;
    }
    if (cond.topNotTail === true) {
      const isTail = !!(l0 && l0.length >= 2 && l0[l0.length - 1] === e.ranks[0]);
      if (isTail) return false;
    }
  }
  return true;
};

// ---- 集計 ----
function evaluate(item, fromDate) {
  const b = BLD[item.patternId];
  const isN2 = item.betType === "nishatan" || /^n2_/.test(item.patternId);
  let races = 0, bets = 0, hits = 0, ret = 0;
  const days = new Set();
  if (!b) return null;
  for (const e of hist.entries) {
    if (!e.date || (fromDate && e.date < fromDate)) continue;
    if (!Array.isArray(e.ranks) || e.ranks.length < 4) continue;
    if (isN2 ? e.p2pay == null : e.p3pay == null) continue;
    if (!condOk(item.cond, e)) continue;
    const t = b(e.ranks, e.lines);
    if (!t.length) continue;
    races++; bets += t.length; days.add(e.date);
    const hitTicket = isN2 ? (e.f + "-" + e.s) : (e.f + "-" + e.s + "-" + e.t);
    if (t.includes(hitTicket)) { hits++; ret += isN2 ? e.p2pay : e.p3pay; }
  }
  const cost = bets * 100;
  return {
    races, days: days.size, hitRate: races ? +(hits / races * 100).toFixed(1) : 0,
    roi: cost ? +(ret / cost * 100).toFixed(1) : 0, profit: Math.round(ret - cost),
    avgPoints: races ? +(bets / races).toFixed(1) : 0,
  };
}

// 判定に必要なレース数の目安(回収率の誤差が±10ポイント以内になる規模)
const NEED = 400;

const cmd = process.argv[2];
const todayD8 = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "");

if (cmd === "add" || cmd === "addtop") {
  let src;
  if (cmd === "addtop") {
    src = (sim.allPatterns || [])[0];
    if (!src) { console.log("sim.json に構成がありません。先にシミュレーターを実行してください。"); process.exit(1); }
  } else {
    const pid = process.argv[3], fname = process.argv.slice(4).join(" ");
    src = (sim.allPatterns || []).find((p) => p.patternId === pid && (!fname || p.filterName === fname));
    if (!src) { console.log("該当する構成が sim.json にありません:", pid, fname); process.exit(1); }
  }
  if (fw.items.some((x) => x.patternId === src.patternId && x.filterName === src.filterName)) {
    console.log("すでに登録済みです:", src.patternName, "×", src.filterName); process.exit(0);
  }
  fw.items.push({
    startDate: todayD8,                       // この日より後のレースだけで検証する
    patternId: src.patternId, patternName: src.patternName,
    filterName: src.filterName, betType: src.betType, cond: src.cond,
    pastRoi: src.roi, pastRaces: src.races, pastHitRate: src.hitRate,   // 過去データでの数字(比較用)
  });
  save("forward.json", fw);
  console.log("登録しました(検証開始日 " + todayD8 + "):");
  console.log("  " + src.patternName + " × " + src.filterName);
  console.log("  過去データでの成績: 回収率" + src.roi + "% (" + src.races + "R)");
  console.log("  → 明日以降のレースで、この数字が再現されるかを追跡します");
  process.exit(0);
}

if (cmd === "list") {
  console.log("登録されている検証対象:", fw.items.length, "件");
  fw.items.forEach((x, i) => console.log("  [" + (i + 1) + "] " + x.startDate + "〜 " + x.patternName + " × " + x.filterName));
  process.exit(0);
}

if (cmd === "remove") {
  const i = parseInt(process.argv[3], 10) - 1;
  if (!(i >= 0 && i < fw.items.length)) { console.log("番号が不正です"); process.exit(1); }
  const x = fw.items.splice(i, 1)[0];
  save("forward.json", fw);
  console.log("削除しました:", x.patternName, "×", x.filterName);
  process.exit(0);
}

// ---- 既定動作: 集計して表示 ----
if (!fw.items.length) {
  console.log("検証対象がまだ登録されていません。");
  console.log("  node forward.js addtop            … sim.jsonのTOP構成を登録");
  console.log("  node forward.js add <patternId> <条件名> … 指定の構成を登録");
  process.exit(0);
}

console.log("=== 前向き検証(登録後のレースだけで集計) ===");
console.log("※ 過去データで見つけた構成は、試した組み合わせが多いほど偶然よく見えるものが混ざります。");
console.log("   登録日より後のレースだけで同じ成績が出るかが、本物かどうかの分かれ目です。\n");

for (const x of fw.items) {
  const after = evaluate(x, x.startDate);
  const all = evaluate(x, null);
  console.log("■ " + x.patternName + " × " + x.filterName);
  console.log("   検証開始: " + x.startDate.slice(0, 4) + "/" + x.startDate.slice(4, 6) + "/" + x.startDate.slice(6, 8));
  console.log("   過去データ  : 回収率 " + x.pastRoi + "% / 的中 " + x.pastHitRate + "% / " + x.pastRaces + "R");
  if (!after || !after.races) {
    console.log("   登録後      : まだ対象レースがありません(明日以降のレースから集計されます)");
  } else {
    const diff = +(after.roi - x.pastRoi).toFixed(1);
    console.log("   登録後(実測): 回収率 " + after.roi + "% / 的中 " + after.hitRate + "% / " +
      after.races + "R(" + after.days + "日) / 収支 " + (after.profit >= 0 ? "+" : "") + after.profit.toLocaleString() + "円");
    console.log("   過去との差  : " + (diff >= 0 ? "+" : "") + diff + "ポイント");
    const pct = Math.min(100, Math.round(after.races / NEED * 100));
    const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));
    console.log("   判定の進捗  : " + bar + " " + after.races + "/" + NEED + "R (" + pct + "%)");
    if (after.races < NEED) {
      console.log("   → まだ判断できません。" + (NEED - after.races) + "レース必要です。");
    } else if (after.roi >= 100) {
      console.log("   → ✓ " + NEED + "レース超で100%を維持。本物の可能性が高まりました。");
    } else if (after.roi >= 85) {
      console.log("   → △ 100%には届きませんが、基準値(約76%)は上回っています。");
    } else {
      console.log("   → ✗ 過去データの数字は再現されませんでした(偶然だった可能性が高い)。");
    }
  }
  console.log("   (参考)全期間: 回収率 " + (all ? all.roi : 0) + "% / " + (all ? all.races : 0) + "R");
  console.log("");
}
console.log("※ 車券は余裕資金の範囲で。検証中は記録だけ取り、結論が出るまで賭け金を増やさないでください。");
