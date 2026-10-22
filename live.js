// ============================================================
// live.js — 今日のレース結果(着順・配当)を日中に取り込み、results-today.json に書く
//
// これまで結果は夜の results.yml(1日1回)でしか取っておらず、しかも GitHub の定時実行が
// 数時間遅れて日付をまたぐと「今日の結果」が空になっていた。アプリで当日のうちに
// 当たったか・配当いくらかを出すため、軽い別ファイルに当日分だけを書く。
//
// ・history.json には触らない(夜の results.yml の仕事)
// ・2026-10-23 から WINTICKET(wt.js)。発走から1分たったレースだけ、1レース1ページの倍率ページの払戻を読む
//   (確定すると3連単・3連複・2車単の当たり組に払戻が付く)。結果がそろったレースは取り直さない(hikitsugi §4-47)
// ・races.json の「レース日」のページだけを見る。別日の同場・同レース番号の結果を
//   取り違えないため(results.js と同じ考え方)
// ・取得に失敗したら何も書かない。同じ日の結果は減らさない(足すだけ)
//
// 使い方: node live.js          … 取得して results-today.json を更新
//         node live.js --dry    … 取得して表示するだけ(書き込まない)
// ============================================================
const fs = require("fs");
const path = require("path");
const { raceDate } = require("./results.js");
const WT = require("./wt.js");

const OUT = path.join(__dirname, "results-today.json");

// 払戻一覧の1レース分を、アプリで使う形にそろえる。着順が確定していなければ null
function toResult(v) {
  if (!v) return null;
  let f = v.first, s = v.second, t = v.third;
  if (f == null && v.p2first != null) { f = v.p2first; s = v.p2second; t = null; }  // 3連単が無くても2車単で1-2着は分かる
  if (f == null) return null;
  const r = { f, s, t: t != null ? t : null,
    p3fpay: v.p3fpay != null ? v.p3fpay : null, p3pay: v.p3pay != null ? v.p3pay : null, p2pay: v.p2pay != null ? v.p2pay : null };
  // 3連複の組が着順と合わないときは、どちらかが読み違い。配当を出さない(誤った的中表示を避ける)
  if (r.t != null && v.f3 && [f, s, r.t].sort((a, b) => a - b).join("=") !== v.f3.join("=")) {
    console.error("  3連複の組と着順が合わない:", f + "-" + s + "-" + r.t, "vs", v.f3.join("="));
    r.p3fpay = null;
  }
  return r;
}

function merge(prev, day, found) {
  // 同じ日なら既存の結果を残して足す(取り直しで減らさない)。日が変わったら作り直す
  const races = prev && prev.date === day ? { ...prev.races } : {};
  let added = 0, updated = 0;
  for (const [k, r] of Object.entries(found)) {
    const old = races[k];
    if (!old) { races[k] = r; added++; continue; }
    // 後から配当が埋まる(3連複・3着)ことがあるので、空いている項目だけ埋める
    const m = { ...old };
    for (const f of ["t", "p3fpay", "p3pay", "p2pay"]) if (m[f] == null && r[f] != null) m[f] = r[f];
    if (JSON.stringify(m) !== JSON.stringify(old)) { races[k] = m; updated++; }
  }
  return { races, added, updated };
}

async function main() {
  const DRY = process.argv.includes("--dry");
  const rj = require("./datafile.js").read(path.join(__dirname, "races.json"));
  const list = rj.races || [];
  const days = [...new Set(list.map(raceDate).filter(Boolean))].sort();
  if (!days.length) { console.error("races.json からレース日が取れません"); process.exit(1); }
  const day = days[days.length - 1];
  const keys = new Set(list.filter((x) => raceDate(x) === day).map((x) => x.place + "_" + x.raceNo));

  // 発走から1分たって、まだ結果(3着と3連複の配当まで)がそろっていないレースだけ取りに行く
  const prev0 = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
  const have = prev0 && prev0.date === day ? prev0.races || {} : {};
  const nowMin = (Date.now() + 9 * 3600e3) / 60000;
  const startMin = (hhmm) => { const [h, mi] = String(hhmm || "").split(":").map(Number); return Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), h, mi) / 60000; };
  const todo = list.filter((x) => raceDate(x) === day && WT.parseUrl(x.url) && /^\d{1,2}:\d{2}$/.test(x.startTime || "") && nowMin - startMin(x.startTime) >= 1)
    .filter((x) => { const r = have[x.place + "_" + x.raceNo]; return !r || r.t == null || r.p3fpay == null; });
  const page = {};
  let fails = 0;
  for (const x of todo) {
    const u = WT.parseUrl(x.url);
    try {
      const { O } = await WT.raceOdds(u.slug, u.cupId, u.index, u.no);
      const v = WT.resultOf(O);
      if (v) page[x.place + "_" + x.raceNo] = v;
    } catch (e) { fails++; console.error("  取得失敗:", x.key, e.message); if (fails >= 5) { console.error("失敗が続くので打ち切り"); break; } }
    await WT.sleep(700);
  }
  const found = {};
  for (const [k, v] of Object.entries(page)) {
    if (!keys.has(k)) continue;              // races.json に無いレース(ガールズ等の対象外)は載せない
    const r = toResult(v);
    if (r) found[k] = r;
  }
  console.log(`レース日 ${day} / races.json ${keys.size}R / 見に行った ${todo.length}R / 確定して対応がとれた ${Object.keys(found).length}R`);

  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
  const { races, added, updated } = merge(prev, day, found);
  console.log(`追加 ${added} / 配当の追記 ${updated} / 合計 ${Object.keys(races).length}R`);
  for (const [k, r] of Object.entries(found).slice(0, 5)) console.log("  ", k, `${r.f}-${r.s}-${r.t}`, "3複", r.p3fpay, "3単", r.p3pay);
  if (DRY) { console.log("--dry のため書き込みません"); return; }
  if (prev && prev.date === day && !added && !updated) { console.log("変化なし"); return; }
  fs.writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), date: day, races }));
  console.log("results-today.json を書きました");
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { toResult, merge };
