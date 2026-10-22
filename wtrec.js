// ============================================================
// wtrec.js — 過去のレースの「当時の成績」と「結果」を WINTICKET の出走表ページから取る(H の検証用・hikitsugi §4-48)
//
// Kドリームスの出走表には H(ホーム回数)が無く、engine.js は H に B を流用している。
// WINTICKET の過去の出走表は、そのレースの時点の成績(S・H・B・決まり手の回数・競走得点。2026-10-20 広島9R で
// 競走得点・3連対率が history.json と一致)と、結果(着順・決まり手・そのレースで S/H/B を取った選手・上がり)が1ページにそろう。
//
// 対象は history.json のその月のレース(結果のあるレース)。1レース1ページを順番に取る(並列にしない)。
// 出力: <out>/wtrec-YYYYMM.json.gz に { "YYYYMMDD_場_nR": { u, n, c, r } } を足す(既にあるレースは取らない)
//   u: "場名/cupId/日目/R"  n: 車立て(欠車を含む)
//   c: 出走表 [[車番, 欠車?1:0, S, H, B, 逃, 捲, 差, マ, 競走得点, 脚質, ギヤ, 1着, 2着, 3着, 着外], ...]
//   r: 結果 [[車番, 着順, 決まり手, そのレースのS?1:0, H?1:0, B?1:0, 上がり], ...](結果の各項目は先頭のレースのログに出す)
//   p: 払戻 [3連複, 3連単, 2車単](円。無ければ null)
//
// 使い方: node wtrec.js --month=2025-01 --out=<フォルダ> [--wait=300] [--limit=50]
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const WT = require("./wt.js");

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith("--" + k + "=")); return a ? a.slice(k.length + 3) : d; };
const MONTH = arg("month", ""), OUT = arg("out", ""), WAIT = +arg("wait", "300"), LIMIT = +arg("limit", "0");
if (!/^\d{4}-\d{2}$/.test(MONTH) || !OUT) { console.error("使い方: node wtrec.js --month=YYYY-MM --out=<フォルダ>"); process.exit(1); }
const ym = MONTH.replace("-", "");

function pack(R, O) {
  const byPid = {};
  for (const e of R.entries || []) byPid[e.playerId] = e;
  const REC = {};
  for (const r of R.records || []) REC[r.playerId] = r;
  const c = (R.entries || []).map((e) => {
    const r = REC[e.playerId] || {};
    const gear = r.hasModifiedGearRatio ? r.modifiedGearRatio : r.gearRatio;
    return [e.number, e.absent ? 1 : 0, r.standing, r.home, r.back, r.frontRunner, r.deepCloser, r.stalker, r.marker, r.racePoint,
      r.style || "", gear, r.first, r.second, r.third, r.others];
  });
  const res = (R.results || []).map((x) => {
    const e = byPid[x.playerId];
    return [e ? e.number : null, x.order, x.factor || "", x.standing ? 1 : 0, x.home ? 1 : 0, x.back ? 1 : 0, x.finalHalfRecord || ""];
  });
  const v = O ? WT.resultOf(O) : null;
  return { n: R.race ? R.race.entriesNumber : c.length, c, r: res, p: v ? [v.p3fpay ?? null, v.p3pay ?? null, v.p2pay ?? null] : null };
}

async function main() {
  const hist = JSON.parse(fs.readFileSync(path.join(__dirname, "history.json"), "utf8")).entries;
  const races = hist.filter((e) => String(e.date).slice(0, 6) === ym);
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, "wtrec-" + ym + ".json.gz");
  let cur = {};
  try { cur = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")); } catch (e) {}
  const todo = races.filter((e) => !cur[e.date + "_" + e.place + "_" + e.raceNo]);
  console.log(MONTH, "history のレース", races.length, "件 / 取得済み", races.length - todo.length, "件 / これから", todo.length, "件");
  const cache = {};
  let got = 0, miss = 0, fails = 0, shown = false;
  const t0 = Date.now();
  const save = () => fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(cur)));
  for (const e of LIMIT ? todo.slice(0, LIMIT) : todo) {
    const key = e.date + "_" + e.place + "_" + e.raceNo;
    let stop = false;
    try {
      const cup = await WT.findCup(e.place, String(e.date), cache);
      const no = parseInt(e.raceNo, 10);
      const S = cup && no ? WT.stateOf(await WT.get(WT.urlOf("racecard", cup.slug, cup.cupId, cup.index, no))) : null;
      const R = S ? WT.query(S, "FETCH_KEIRIN_RACE") : null;
      if (R && R.race) {
        if (!shown && (R.results || []).length) { console.log("結果の項目:", Object.keys(R.results[0]).join(",")); shown = true; }
        cur[key] = { u: [cup.slug, cup.cupId, cup.index, no].join("/"), ...pack(R, WT.query(S, "FETCH_KEIRIN_RACE_ODDS")) };
        got++; fails = 0;
      } else miss++;
    } catch (err) {
      if (/HTTP 404/.test(err.message)) miss++;
      else { fails++; console.log("  取得失敗:", key, err.message); stop = fails >= 10; }
    }
    if (stop) { console.log("失敗が続くので打ち切り(続きは同じコマンドで)"); break; }
    if ((got + miss) % 200 === 0) { save(); console.log("  ", got + miss, "/", todo.length, "件", Math.round((Date.now() - t0) / 1000) + "秒"); }
    await WT.sleep(WAIT);
  }
  save();
  console.log(MONTH, "取れた", got, "件 / 見つからない", miss, "件 / 合計", Object.keys(cur).length, "件", Math.round((Date.now() - t0) / 1000) + "秒");
}
main().catch((e) => { console.error(e); process.exit(1); });
