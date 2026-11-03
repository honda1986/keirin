// ============================================================
// wtai.js — WINTICKET の AI予想(4車の3連複ボックス)を過去のレースぶん取る(分析用・hikitsugi §4-49)
//
// 出走表ページの FETCH_KEIRIN_RACE の predictions に、isAi の予想が1つある。中身は4車の3連複ボックス(4組)と
// 3連単24組。2025-01〜2026-09 の各月で残っていることを確かめた(2026-11-03)。ここでは4車だけ残す。
//
// 対象は history.json のその月のレース。URL は wtrec の記録(wtrec-YYYYMM.json.gz の u)を使い、無ければ findCup で探す。
// 出力: <out>/wtai-YYYYMM.json.gz に { "YYYYMMDD_場_nR": [4車](AI予想が無いレースは []) } を足す(既にあるレースは取らない)
//
// 使い方: node wtai.js --month=2025-01 --out=<フォルダ> [--wtrec=<wtrec のフォルダ>] [--wait=300] [--limit=50]
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const WT = require("./wt.js");

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith("--" + k + "=")); return a ? a.slice(k.length + 3) : d; };
const MONTH = arg("month", ""), OUT = arg("out", ""), WREC = arg("wtrec", ""), WAIT = +arg("wait", "300"), LIMIT = +arg("limit", "0");
if (!/^\d{4}-\d{2}$/.test(MONTH) || !OUT) { console.error("使い方: node wtai.js --month=YYYY-MM --out=<フォルダ> [--wtrec=<フォルダ>]"); process.exit(1); }
const ym = MONTH.replace("-", "");
const gz = (f) => { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString("utf8")); } catch (e) { return null; } };

// AI予想の4車(3連複の組 "raceId:3:a.b.c" に出てくる車番)。AI予想が無ければ []
function aiCars(R) {
  const ai = (R.predictions || []).find((p) => p.isAi);
  const set = new Set();
  for (const id of (ai && ai.trioOddsIds) || []) for (const c of String(id).split(":")[2].split(".")) set.add(+c);
  return [...set].sort((a, b) => a - b);
}

async function main() {
  const hist = JSON.parse(fs.readFileSync(path.join(__dirname, "history.json"), "utf8")).entries;
  const races = hist.filter((e) => String(e.date).slice(0, 6) === ym);
  const rec = (WREC && gz(path.join(WREC, "wtrec-" + ym + ".json.gz"))) || {};
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, "wtai-" + ym + ".json.gz");
  const cur = gz(file) || {};
  const todo = races.filter((e) => !cur[e.date + "_" + e.place + "_" + e.raceNo]);
  console.log(MONTH, "history のレース", races.length, "件 / 取得済み", races.length - todo.length, "件 / これから", todo.length, "件 / wtrec の URL", Object.keys(rec).length, "件");
  const cache = {};
  let got = 0, miss = 0, noAi = 0, fails = 0;
  const t0 = Date.now();
  const save = () => fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(cur)));
  for (const e of LIMIT ? todo.slice(0, LIMIT) : todo) {
    const key = e.date + "_" + e.place + "_" + e.raceNo;
    let stop = false;
    try {
      let u = rec[key] && rec[key].u ? rec[key].u.split("/") : null;
      if (!u) { const c = await WT.findCup(e.place, String(e.date), cache); u = c ? [c.slug, c.cupId, c.index, parseInt(e.raceNo, 10)] : null; }
      const R = u ? WT.query(WT.stateOf(await WT.get(WT.urlOf("racecard", u[0], u[1], u[2], u[3]))), "FETCH_KEIRIN_RACE") : null;
      if (R && R.race) { cur[key] = aiCars(R); if (!cur[key].length) noAi++; got++; fails = 0; }
      else miss++;
    } catch (err) {
      if (/HTTP 404/.test(err.message)) miss++;
      else { fails++; console.log("  取得失敗:", key, err.message); stop = fails >= 10; }
    }
    if (stop) { console.log("失敗が続くので打ち切り(続きは同じコマンドで)"); break; }
    if ((got + miss) % 200 === 0) { save(); console.log("  ", got + miss, "/", todo.length, "件", Math.round((Date.now() - t0) / 1000) + "秒"); }
    await WT.sleep(WAIT);
  }
  save();
  console.log(MONTH, "取れた", got, "件(AI予想なし", noAi, ")/ 見つからない", miss, "件 / 合計", Object.keys(cur).length, "件", Math.round((Date.now() - t0) / 1000) + "秒");
}
main().catch((e) => { console.error(e); process.exit(1); });
