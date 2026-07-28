// ============================================================
// trace.js — history.json の各コミット時点のエントリ数を出す
//
// git の履歴をたどって「どのコミットで件数が落ちたか」を特定する。
// コミットメッセージが出るので、犯人のワークフローがそのまま分かる。
//
// 読み取り専用。git にもファイルにも一切書き込まない。
// ※ ワークフロー側で fetch-depth: 0 が必須(既定の浅いclone では履歴が無い)
// ============================================================
const { execSync } = require("child_process");
const fs = require("fs");

const sh = (cmd) => execSync(cmd, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });

let log;
try {
  log = sh("git log --format=%H%x09%ad%x09%s --date=format:%Y-%m-%d_%H:%M -60 -- history.json").trim();
} catch (e) {
  console.error("git log に失敗:", e.message);
  process.exit(1);
}
if (!log) {
  console.error("history.json の履歴が取れませんでした。fetch-depth: 0 になっているか確認してください。");
  process.exit(1);
}

const rows = log.split("\n").map((l) => {
  const [hash, date, ...rest] = l.split("\t");
  return { hash, date, msg: rest.join("\t") };
});

console.log("history.json を変更したコミット(新しい順)\n");
console.log("  件数    3着あり  日時(UTC)          コミット");
console.log("  " + "-".repeat(74));

let prev = null;
const drops = [];
for (const r of rows) {
  let n = null, withT = null;
  try {
    sh(`git show ${r.hash}:history.json > /tmp/h.json`);
    const h = JSON.parse(fs.readFileSync("/tmp/h.json", "utf8"));
    const E = h.entries || h;
    n = E.length;
    withT = E.filter((e) => e.t != null).length;
  } catch (e) {
    console.log("  読めず                            " + r.date + "  " + r.msg);
    continue;
  }
  // prev は「1つ新しいコミット」。新しい側が減っていれば、そのコミットが減らした犯人。
  let mark = "";
  if (prev != null && prev.n < n) {
    mark = "   ← ここで " + (n - prev.n) + "件 減った";
    drops.push({ lost: n - prev.n, at: prev });
  }
  console.log(
    "  " + String(n).padStart(6) + "  " + String(withT).padStart(7) + "  " +
    r.date.padEnd(18) + "  " + r.msg.slice(0, 40)
  );
  if (mark) console.log("  " + " ".repeat(15) + mark + " → 犯人: " + prev.msg);
  prev = { n, msg: r.msg, date: r.date, hash: r.hash };
}

console.log("\n" + "=".repeat(76));
if (!drops.length) {
  console.log("減少は見つかりませんでした。表示範囲(直近60コミット)より前かもしれません。");
} else {
  console.log("件数が減ったコミット:");
  for (const d of drops) {
    console.log("  -" + String(d.lost).padStart(5) + "件  " + d.at.date + "  " + d.at.msg);
    console.log("           " + d.at.hash);
  }
  console.log("\n復旧に使うコミット(減る直前の状態)は、上の表で件数が多いほうの行です。");
}
