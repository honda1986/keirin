// ============================================================
// restore.js — history.json を git の履歴から復旧する
//
// 単純な巻き戻しではなく「合体」させる:
//   土台 = 指定コミットの history.json(10,059件・検証済み・p3fpay入り)
//   追加 = 現在のファイルにしか無いレース(復旧地点より後に集めた7/27〜の分)
// これで、消えた古いレースを取り戻しつつ、新しいレースも失わない。
//
// 既存の値は上書きしません。土台側が null の項目だけ、現在のファイルから埋めます。
//
// 【安全装置】既定は点検のみ。--apply を付けたときだけ書き込みます。
//   合体後の件数が現在より減る場合は、--apply でも書き込みません。
//
// 使い方:
//   node restore.js                     … 候補を一覧表示して、何が起きるか報告(書き込まない)
//   node restore.js --apply             … 件数が最も多いコミットに合体して書き込む
//   node restore.js 3連複配当 --apply    … コミットメッセージで指定
//   node restore.js a1b2c3d --apply     … コミットハッシュで指定
//
// ※ ワークフローに fetch-depth: 0 が必須(既定の浅いcloneには履歴がありません)
// ============================================================
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const histPath = path.join(dir, "history.json");
const sh = (cmd) => execSync(cmd, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const TARGET = args.find((a) => !a.startsWith("--")) || null;

console.log(APPLY ? "※ applyモード: history.json を書き換えます\n" : "※ 点検のみ。history.json は書き換えません(--apply で書き込み)\n");

// ---- 履歴が取れているか ----
try {
  if (sh("git rev-parse --is-shallow-repository").trim() === "true") {
    console.error("浅いcloneです。ワークフローの checkout に fetch-depth: 0 を入れてください。");
    process.exit(1);
  }
} catch (e) { /* 古いgitでは判定不可。そのまま進む */ }

// ---- history.json を変更したコミットを列挙 ----
const log = sh("git log --format=%H%x09%ad%x09%s --date=format:%Y-%m-%d_%H:%M -60 -- history.json").trim();
if (!log) { console.error("history.json の履歴が取れませんでした。"); process.exit(1); }

const rows = log.split("\n").map((l) => {
  const [hash, date, ...rest] = l.split("\t");
  return { hash, date, msg: rest.join("\t") };
});

function statsAt(hash) {
  try {
    sh(`git show ${hash}:history.json > /tmp/restore_candidate.json`);
    const h = JSON.parse(fs.readFileSync("/tmp/restore_candidate.json", "utf8"));
    const E = h.entries || h;
    if (!Array.isArray(E)) return null;
    return { n: E.length, withT: E.filter((e) => e.t != null).length, withF3: E.filter((e) => e.p3fpay != null).length };
  } catch (e) { return null; }
}

console.log("history.json を変更したコミット(新しい順)\n");
console.log("  件数    3着あり  3連複あり  日時(UTC)          コミット");
console.log("  " + "-".repeat(80));
const cands = [];
for (const r of rows) {
  const s = statsAt(r.hash);
  if (!s) { console.log("  読めず                                 " + r.date + "  " + r.msg.slice(0, 36)); continue; }
  cands.push({ ...r, ...s });
  console.log(
    "  " + String(s.n).padStart(6) + "  " + String(s.withT).padStart(7) + "  " +
    String(s.withF3).padStart(9) + "  " + r.date.padEnd(18) + "  " + r.msg.slice(0, 36)
  );
}
if (!cands.length) { console.error("\n読めるコミットがありませんでした。"); process.exit(1); }

// ---- 復旧地点を選ぶ ----
let chosen;
if (TARGET) {
  chosen = cands.find((c) => c.hash.startsWith(TARGET)) || cands.find((c) => c.msg.includes(TARGET));
  if (!chosen) { console.error("\n指定に一致するコミットがありません:", TARGET); process.exit(1); }
} else {
  // 件数が最も多いもの。同数なら3着あり→3連複あり→新しい順
  chosen = cands.slice().sort((a, b) =>
    b.n - a.n || b.withT - a.withT || b.withF3 - a.withF3 || b.date.localeCompare(a.date)
  )[0];
}
console.log("\n復旧地点:", chosen.date, chosen.msg);
console.log("  ", chosen.hash);
console.log("   " + chosen.n + "件 / 3着あり" + chosen.withT + " / 3連複あり" + chosen.withF3);

// ---- 合体 ----
sh(`git show ${chosen.hash}:history.json > /tmp/restore_candidate.json`);
const baseHist = JSON.parse(fs.readFileSync("/tmp/restore_candidate.json", "utf8"));
const base = baseHist.entries || baseHist;

const cur = fs.existsSync(histPath) ? JSON.parse(fs.readFileSync(histPath, "utf8")) : { entries: [] };
const curE = cur.entries || [];
console.log("\n現在のファイル:", curE.length, "件");

const byId = new Map(base.map((e) => [e.id, e]));
let added = 0, dup = 0, filled = 0;
for (const e of curE) {
  const b = byId.get(e.id);
  if (!b) { byId.set(e.id, e); added++; continue; }   // 復旧地点より後に集めたレース
  dup++;
  for (const k of Object.keys(e)) {                    // 土台が空の項目だけ埋める
    if ((b[k] === null || b[k] === undefined) && e[k] !== null && e[k] !== undefined) { b[k] = e[k]; filled++; }
  }
}
const merged = [...byId.values()].sort((a, b) =>
  String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id))
);

console.log("\n============ 合体の結果 ============");
console.log("  土台(復旧地点)      :", base.length, "件");
console.log("  現在にしか無かった分  :", added, "件を追加");
console.log("  両方にあった分        :", dup, "件(土台を優先。空欄" + filled + "項目を現在から補完)");
console.log("  ------------------------------------");
console.log("  合体後                :", merged.length, "件");
console.log("    うち3着あり         :", merged.filter((e) => e.t != null).length);
console.log("    うち3連複配当あり   :", merged.filter((e) => e.p3fpay != null).length);
console.log("    うち2車単配当あり   :", merged.filter((e) => e.p2pay != null).length);

// ---- 安全確認 ----
if (merged.length < curE.length) {
  console.error("\n中止: 合体後(" + merged.length + ")が現在(" + curE.length + ")より少ないため書き込みません。");
  process.exit(1);
}
if (!merged.length) { console.error("\n中止: 合体結果が空です。"); process.exit(1); }

if (!APPLY) {
  console.log("\n→ 書き込んでいません。この内容でよければ --apply を付けて実行してください。");
  process.exit(0);
}

fs.writeFileSync(histPath, JSON.stringify({ ...cur, entries: merged }));
// 書けたものを読み直して壊れていないか確認する
const back = JSON.parse(fs.readFileSync(histPath, "utf8"));
if ((back.entries || []).length !== merged.length) { console.error("\n書き込み後の検証に失敗しました。"); process.exit(1); }
console.log("\n→ 書き込み完了:", merged.length, "件。verify.js / diagpay.js で確認してください。");
