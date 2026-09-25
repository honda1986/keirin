// ============================================================
// live.js — 今日のレース結果(着順・配当)を日中に取り込み、results-today.json に書く
//
// これまで結果は夜の results.yml(1日1回)でしか取っておらず、しかも GitHub の定時実行が
// 数時間遅れて日付をまたぐと「今日の結果」が空になっていた。アプリで当日のうちに
// 当たったか・配当いくらかを出すため、軽い別ファイルに当日分だけを書く。
//
// ・history.json には触らない(夜の results.yml の仕事)
// ・払戻一覧は1日1ページ(3連単・2車単・3連複が全部載っている)。パーサーは sanpuku.js のもの
// ・races.json の「レース日」のページだけを見る。別日の同場・同レース番号の結果を
//   取り違えないため(results.js と同じ考え方)
// ・取得に失敗したら何も書かない。同じ日の結果は減らさない(足すだけ)
//
// 使い方: node live.js          … 取得して results-today.json を更新
//         node live.js --dry    … 取得して表示するだけ(書き込まない)
// ============================================================
const fs = require("fs");
const path = require("path");
const { get, raceDate } = require("./results.js");
const { parseHaraiList } = require("./sanpuku.js");

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
  const rj = JSON.parse(fs.readFileSync(path.join(__dirname, "races.json"), "utf8"));
  const list = rj.races || [];
  const days = [...new Set(list.map(raceDate).filter(Boolean))].sort();
  if (!days.length) { console.error("races.json からレース日が取れません"); process.exit(1); }
  const day = days[days.length - 1];
  const keys = new Set(list.filter((x) => raceDate(x) === day).map((x) => x.place + "_" + x.raceNo));

  const [y, m, d] = day.split("-");
  const url = `https://keirin.kdreams.jp/harailist/${y}/${m}/${d}/`;
  let html;
  try { html = await get(url); } catch (e) { console.error("払戻一覧の取得に失敗:", url, e.message, "→ 何も書きません"); process.exit(1); }
  const page = parseHaraiList(html);
  const found = {};
  for (const [k, v] of Object.entries(page)) {
    if (!keys.has(k)) continue;              // races.json に無いレース(ガールズ等の対象外)は載せない
    const r = toResult(v);
    if (r) found[k] = r;
  }
  console.log(`レース日 ${day} / races.json ${keys.size}R / 払戻一覧 ${Object.keys(page).length}R / 確定して対応がとれた ${Object.keys(found).length}R`);

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
