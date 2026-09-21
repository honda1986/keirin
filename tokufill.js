// ============================================================
// tokufill.js — history.json の riders に競走得点(7番目)を後付けする
//
// 【なぜ要るか】
//   riders は [車番, 年齢, 期, ライン内位置, 評価順位, 評価点] の6項目しか無く、
//   生の競走得点を持っていなかった。評価点は採点の総合点で、競走得点とは別物。
//   「得点の序列と並びの序列が食い違うラインは機能しないのでは」といった検証を
//   するには生の得点が要る。fetch.js は 2026-09-21 から保存するようにしたので、
//   それ以前のぶんをここで埋める。
//
// 【どこから取るか】
//   git履歴の races.json の raw を parseCard に通す。gitfill.js / scorelog.js と
//   同じ「レース日ごとの最良スナップショット」を使う。ネットワークには出ない。
//   ★取れるのは 2026-08-28 以降だけ。Gamboo 期の raw は残っていない。
//
// 【使い方】既定は読み取り専用。書き込むときだけ --apply。
//   node tokufill.js --from 2026-08-28 --to 2026-09-21
//   node tokufill.js --from 2026-08-28 --to 2026-09-21 --apply
//
// 【注意】git の全履歴が要る(actions/checkout の fetch-depth: 0)。
// ============================================================
const fs = require("fs");
const path = require("path");
const { parseCard } = require("./engine.js");
const { TRACK_NAMES } = require("./bankdata.js");
const { snapshots } = require("./gitfill.js");

const dir = __dirname;
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const argOf = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const FROM = argOf("--from"), TO = argOf("--to");
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
if (!isDate(FROM) || !isDate(TO) || FROM > TO) {
  console.error("使い方: node tokufill.js --from YYYY-MM-DD --to YYYY-MM-DD [--apply]");
  process.exit(1);
}

const histPath = path.join(dir, "history.json");
const hist = JSON.parse(fs.readFileSync(histPath, "utf8"));
const byId = new Map(hist.entries.map((e) => [e.id, e]));
const before = hist.entries.filter((e) => Array.isArray(e.riders) && e.riders.some((r) => r[6] != null)).length;
console.log("history:", hist.entries.length, "件 / うち既に競走得点あり:", before, "件");

const best = snapshots(FROM, TO);
const days = [...best.keys()].sort();
console.log("git履歴から", days.length, "日ぶんを読みます:", days[0], "〜", days[days.length - 1]);

let filled = 0, riders = 0, noEntry = 0, noCar = 0, badParse = 0;
for (const d of days) {
  const d8 = d.replace(/-/g, "");
  let day = 0;
  for (const x of best.get(d).races) {
    const e = byId.get(d8 + "_" + x.place + "_" + x.raceNo);
    if (!e || !Array.isArray(e.riders)) { noEntry++; continue; }
    let p;
    try { p = parseCard(x.raw, TRACK_NAMES); } catch (err) { badParse++; continue; }
    const tok = {};
    for (const en of p.entries) if (en.score > 0) tok[en.car] = Number(en.score.toFixed(2));
    let n = 0;
    for (const rd of e.riders) {
      if (rd[6] != null) continue;            // 既に入っているものは触らない
      if (tok[rd[0]] == null) { noCar++; continue; }
      rd[6] = tok[rd[0]];
      n++; riders++;
    }
    if (n) { filled++; day++; }
  }
  console.log("  " + d + ": " + day + "レースに付与");
}
console.log("----------------------------------------");
console.log("付与したレース:", filled, "/ 延べ選手:", riders);
console.log("履歴に無いレース:", noEntry, "/ 解析できず:", badParse, "/ 該当車番なし:", noCar);

const after = hist.entries.filter((e) => Array.isArray(e.riders) && e.riders.some((r) => r[6] != null)).length;
console.log("競走得点ありのレース:", before, "→", after);
// 【安全装置】履歴を書くコードは必ず「消さないか」を確認すること
if (hist.entries.length !== byId.size) { console.error("件数が変わっています。書き込まずに中止します。"); process.exit(1); }
if (after < before) { console.error("競走得点が減っています。書き込まずに中止します。"); process.exit(1); }
if (!APPLY) { console.log("\n点検のみのため書き込みませんでした。--apply を付けると書き込みます。"); process.exit(0); }
if (!riders) { console.log("\n付与が0件のため書き込みません。"); process.exit(0); }
fs.writeFileSync(histPath, JSON.stringify(hist));
console.log("\nhistory.json を書き込みました。");
