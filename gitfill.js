// ============================================================
// gitfill.js — git履歴に残っている過去の races.json から history.json の穴を埋める
//
// 【なぜ要るか】
//   2026-08-28 の楽天Kドリームス移行で results.js がレース日を取れなくなり
//   (url の rdt= が消えた)、8/26〜9/21 の約27日ぶんが history.json に入らなかった。
//   backfill.js は出走表を gamboo.jp から取るが、GambooはWAFで閉じているので使えない。
//
// 【なぜ「取り直し」ではなく git履歴か】
//   races.json のスナップショットには、その日に実際に出した予想
//   (score / verdict / marksCars / riders / lines) がそのまま入っている。
//   いま出走表を取り直して予想し直すと、現在の weights.json で過去を予想することになり、
//   バックテストに未来の情報が混ざる。アーカイブを使えばその汚染がない。
//
// 【使い方】既定は読み取り専用。書き込むときだけ --apply を付ける。
//   node gitfill.js --from 2026-08-28 --to 2026-09-20
//   node gitfill.js --from 2026-08-28 --to 2026-09-20 --apply
//
// 【注意】git の全履歴が要る。ワークフローの actions/checkout に
//   fetch-depth: 0 を付けること。既定の 1 だと1コミットしか無く何も拾えない。
//
// 【注意】払戻一覧は「そのレース日のページ」だけを見る。results.js が前日ページも
//   見ているのは、日付8桁をキーに含める前の名残で、今は一致しようがない(要検討)。
// ============================================================
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { get, parseHaraiList, raceDate, normalizeResult, makeEntry } = require("./results.js");

const dir = __dirname;
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const argOf = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const FROM = argOf("--from");
const TO = argOf("--to");
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
// 引数の検査は直接実行したときだけ。require されたときに落ちないようにする。
if (require.main === module && (!isDate(FROM) || !isDate(TO) || FROM > TO)) {
  console.error("使い方: node gitfill.js --from YYYY-MM-DD --to YYYY-MM-DD [--apply]");
  process.exit(1);
}

const git = (args) => execFileSync("git", args, { cwd: dir, maxBuffer: 256 * 1024 * 1024 });

// 対象日の前後に余裕をもたせてコミットを絞る。
// fetch.js は夜に「翌日ぶん」を取るので、レース日はコミット日の当日か翌日になる。
const shift = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// レース日ごとに「そのレース日のレースを最も多く含む races.json スナップショット」を返す。
// Map<"YYYY-MM-DD", {sha, races}>。scorelog.js からも使う。
function snapshots(FROM, TO) {
  let out;
  try {
    out = git(["log", "--format=%H", `--since=${shift(FROM, -2)}`, `--until=${shift(TO, 2)}`, "--", "races.json"]).toString();
  } catch (e) {
    console.error("git log に失敗しました:", e.message);
    console.error("★ checkout が浅い可能性があります。fetch-depth: 0 を付けてください。");
    process.exit(1);
  }
  const shas = out.split("\n").filter(Boolean);
  if (!shas.length) {
    console.error("races.json のコミットが1件も見つかりません。");
    console.error("★ checkout が浅い可能性があります。fetch-depth: 0 を付けてください。");
    process.exit(1);
  }
  console.log("走査するスナップショット:", shas.length, "件");
  // レース日ごとに「そのレース日のレースを最も多く含むスナップショット」を採用する。
  // 日中のスナップショットは開催が出そろっていないことがあるため、件数の多い方を取る。
  const best = new Map();
  let broken = 0;
  for (const sha of shas) {
    let races;
    try { races = JSON.parse(git(["show", sha + ":races.json"]).toString()).races || []; }
    catch (e) { broken++; continue; }
    const byDate = new Map();
    for (const x of races) {
      const d = raceDate(x);
      if (!d || d < FROM || d > TO) continue;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(x);
    }
    for (const [d, list] of byDate) {
      const cur = best.get(d);
      if (!cur || list.length > cur.races.length) best.set(d, { sha, races: list });
    }
  }
  if (broken) console.log("読めなかったスナップショット:", broken, "件(無視)");
  return best;
}

async function main() {
  const histPath = path.join(dir, "history.json");
  const hist = JSON.parse(fs.readFileSync(histPath, "utf8"));
  const before = hist.entries.length;
  const done = new Set(hist.entries.map((e) => e.id));
  console.log("history 現在:", before, "件");
  console.log("対象期間:", FROM, "〜", TO, APPLY ? "(書き込みます)" : "(点検のみ・書き込みません)");

  const best = snapshots(FROM, TO);
  const dates = [...best.keys()].sort();
  console.log("予想が残っている日:", dates.length, "日");
  const missing = [];
  for (let d = FROM; d <= TO; d = shift(d, 1)) if (!best.has(d)) missing.push(d);
  if (missing.length) console.log("★予想が残っていない日(復旧できません):", missing.join(", "));

  let added = 0, noResult = 0, already = 0;
  const failed = [];
  for (const d of dates) {
    const races = best.get(d).races;
    const [y, mo, dd] = d.split("-");
    let day;
    try { day = parseHaraiList(await get(`https://keirin.kdreams.jp/harailist/${y}/${mo}/${dd}/`)); }
    catch (e) { console.error("払戻一覧の取得に失敗:", d, e.message); failed.push(d); continue; }

    const d8 = d.replace(/-/g, "");
    let a = 0, n = 0, k = 0;
    for (const x of races) {
      const r = day[x.place + "_" + x.raceNo];
      if (!r || !normalizeResult(r)) { n++; continue; }
      const id = d8 + "_" + x.key;
      if (done.has(id)) { k++; continue; }
      hist.entries.push(makeEntry(x, r, d8));
      done.add(id);
      a++;
    }
    added += a; noResult += n; already += k;
    console.log(`${d}: 予想${races.length}R → 追加${a} / 結果なし${n} / 既存${k}`);
  }

  console.log("----------------------------------------");
  console.log("追加:", added, "件 / 結果が取れなかった:", noResult, "件 / 既に有り:", already, "件");
  if (failed.length) {
    console.log("★払戻一覧を取得できなかった日:", failed.join(", "));
    console.log("★このスクリプトは既存分を飛ばすので、同じコマンドをもう一度回せば続きから埋まります。");
  }
  if (missing.length) console.log("★予想が残っていないため復旧できない日:", missing.join(", "));
  if (!added && failed.length) { console.error("1件も追加できませんでした。"); process.exit(1); }

  // 【安全装置】履歴を書くコードは必ず「消さないか」を確認すること(過去に5回消している)。
  if (hist.entries.length < before) {
    console.error("件数が減っています(" + before + " → " + hist.entries.length + ")。書き込まずに中止します。");
    process.exit(1);
  }
  if (!APPLY) { console.log("点検のみのため書き込みませんでした。--apply を付けると書き込みます。"); return; }
  if (!added) { console.log("追加が0件のため書き込みません。"); return; }
  // 日付順に並べ直す(results.js は追記順のままだが、遡り分が末尾に来ると読みづらい)
  hist.entries.sort((p, q) => (p.date === q.date ? (p.id < q.id ? -1 : 1) : p.date < q.date ? -1 : 1));
  fs.writeFileSync(histPath, JSON.stringify(hist));
  console.log("history.json を書き込みました:", before, "→", hist.entries.length, "件");
  console.log("★このあと node sanpuku.js 40 --apply を回して3連複配当(p3fpay)を入れてください。");
}

// 直接実行したときだけ走らせる(scorelog.js から snapshots を使い回すため)
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { snapshots, raceDate, shift };
