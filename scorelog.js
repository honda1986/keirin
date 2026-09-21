// ============================================================
// scorelog.js — 競走得点を日ごとに記録する
//
// 【なぜ要るか】
//   Gamboo には「現得点 / 前得点」が両方あり、engine.js はその差(scoreDiff)を
//   調子の指標として採点に使っている(predict の trend 項、±1.5でクリップ×0.6)。
//   楽天Kドリームスには現得点しか無いため、移行後は scoreDiff が常に0になっている。
//   毎日の得点を貯めておけば「前回出走時からの増減」で代用できる。
//
// 【どこから取るか】
//   ① git履歴の races.json (--from/--to)  … 2026-08-28以降のぶんを遡って作る
//   ② 当日の races.json (--today)          … fetch.js から毎回呼ぶ
//   どちらも raw を parseCard に通すだけで、ネットワークには出ない。
//
// 【使い方】既定は読み取り専用。書き込むときだけ --apply。
//   node scorelog.js --from 2026-08-28 --to 2026-09-21
//   node scorelog.js --from 2026-08-28 --to 2026-09-21 --apply
//   node scorelog.js --today --apply
//   node scorelog.js --stats                 … 溜まったデータの統計だけ見る
//
// 【scores.json の形】
//   { updatedAt, dates: ["YYYYMMDD", ...], riders: { "<名前>|<期>": [["YYYYMMDD", 得点], ...] } }
//   選手キーは 名前|期。期は選手ごとに一意で変わらないので、同姓別人を分けられる。
//
// 【注意】git履歴から作るときは全履歴が要る(actions/checkout の fetch-depth: 0)。
// ============================================================
const fs = require("fs");
const path = require("path");
const { parseCard } = require("./engine.js");
const { TRACK_NAMES } = require("./bankdata.js");

const dir = __dirname;
const SCORES = path.join(dir, "scores.json");

const load = () => {
  try { const j = JSON.parse(fs.readFileSync(SCORES, "utf8")); if (!j.riders) j.riders = {}; return j; }
  catch (e) { return { updatedAt: null, dates: [], riders: {} }; }
};

const d8of = (x) => {
  const j = String(x.date || "").match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  return j ? j[1] + j[2].padStart(2, "0") + j[3].padStart(2, "0") : null;
};

// races.json の races 配列から得点を取り出して store に足す。足した件数を返す。
// ★ネットワークには出ない。raw を parseCard に通すだけ。
function updateFromRaces(store, races) {
  let added = 0, skipped = 0, dates = new Set();
  for (const x of races || []) {
    const d = d8of(x);
    if (!d || !x.raw) { skipped++; continue; }
    let p;
    try { p = parseCard(x.raw, TRACK_NAMES); } catch (e) { skipped++; continue; }
    for (const e of p.entries) {
      // 得点0はデビュー直後で成績が無い選手。記録すると増減が嘘になるので除く。
      if (!e.name || !e.ki || !(e.score > 0)) continue;
      const key = e.name + "|" + String(e.ki).replace(/期$/, "");
      const log = store.riders[key] || (store.riders[key] = []);
      if (log.some((r) => r[0] === d)) continue;     // 同じ日は1回だけ(同日2走でも得点は同じ)
      log.push([d, e.score]);
      added++;
      dates.add(d);
    }
  }
  return { added, skipped, dates };
}

// 日付順に並べ直し、dates を作り直す
function finalize(store) {
  const all = new Set();
  for (const k of Object.keys(store.riders)) {
    store.riders[k].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    for (const r of store.riders[k]) all.add(r[0]);
  }
  store.dates = [...all].sort();
  store.updatedAt = new Date().toISOString();
}

function stats(store) {
  const riders = Object.keys(store.riders);
  let rows = 0, multi = 0;
  const deltas = [];
  for (const k of riders) {
    const l = store.riders[k];
    rows += l.length;
    if (l.length < 2) continue;
    multi++;
    for (let i = 1; i < l.length; i++) deltas.push(+(l[i][1] - l[i - 1][1]).toFixed(2));
  }
  console.log("選手:", riders.length, "人 / 延べ記録:", rows, "件 / 収録日:", store.dates.length, "日",
    store.dates.length ? "(" + store.dates[0] + "〜" + store.dates[store.dates.length - 1] + ")" : "");
  console.log("2日以上記録がある選手:", multi, "人");
  if (!deltas.length) return;
  deltas.sort((a, b) => a - b);
  const q = (p) => deltas[Math.floor(deltas.length * p)];
  const abs = deltas.map(Math.abs).sort((a, b) => a - b);
  console.log("前回出走からの増減: n=" + deltas.length,
    "5%", q(0.05), "25%", q(0.25), "中央", q(0.5), "75%", q(0.75), "95%", q(0.95));
  console.log("  |増減| 中央値:", abs[Math.floor(abs.length / 2)],
    "/ |増減|>=1.0 の割合:", (abs.filter((x) => x >= 1).length / abs.length * 100).toFixed(1) + "%");
  console.log("  ※engine.js の trend 項は scoreDiff を ±1.5 でクリップして ×0.6 するので、");
  console.log("    この増減をそのまま使うと採点への効き幅は概ね ±" + (Math.min(1.5, q(0.95)) * 0.6).toFixed(2) + "点。");
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const APPLY = argv.includes("--apply");
  const argOf = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const store = load();

  if (argv.includes("--stats")) { stats(store); process.exit(0); }

  const before = Object.values(store.riders).reduce((a, l) => a + l.length, 0);
  let res;
  if (argv.includes("--today")) {
    const races = JSON.parse(fs.readFileSync(path.join(dir, "races.json"), "utf8")).races || [];
    res = updateFromRaces(store, races);
    console.log("当日の races.json:", races.length, "レース");
  } else {
    const FROM = argOf("--from"), TO = argOf("--to");
    const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
    if (!isDate(FROM) || !isDate(TO) || FROM > TO) {
      console.error("使い方: node scorelog.js --from YYYY-MM-DD --to YYYY-MM-DD [--apply]");
      console.error("        node scorelog.js --today [--apply]");
      console.error("        node scorelog.js --stats");
      process.exit(1);
    }
    const { snapshots } = require("./gitfill.js");
    const best = snapshots(FROM, TO);
    const days = [...best.keys()].sort();
    console.log("git履歴から", days.length, "日ぶんを読みます:", days[0], "〜", days[days.length - 1]);
    res = { added: 0, skipped: 0, dates: new Set() };
    for (const d of days) {
      const r = updateFromRaces(store, best.get(d).races);
      res.added += r.added; res.skipped += r.skipped;
      for (const x of r.dates) res.dates.add(x);
    }
  }

  finalize(store);
  const after = Object.values(store.riders).reduce((a, l) => a + l.length, 0);
  console.log("追加:", res.added, "件 / 読めなかったレース:", res.skipped, "件 / 対象日:", res.dates.size, "日");
  console.log("記録の合計:", before, "→", after, "件");
  // 【安全装置】履歴を書くコードは必ず「消さないか」を確認すること
  if (after < before) { console.error("件数が減っています。書き込まずに中止します。"); process.exit(1); }
  console.log("");
  stats(store);
  if (!APPLY) { console.log("\n点検のみのため書き込みませんでした。--apply を付けると書き込みます。"); process.exit(0); }
  fs.writeFileSync(SCORES, JSON.stringify(store));
  console.log("\nscores.json を書き込みました。");
}

module.exports = { load, updateFromRaces, finalize, stats, SCORES };
