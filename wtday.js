// ============================================================
// wtday.js — 予想(races.json)が残っていない日を WINTICKET の当時の出走表から作り直して、history.json に結果を足す(hikitsugi §4-47)
//
// 2026-10-22 は朝から Kドリームスが止まっていて、races.json が1件も作られなかった(成績にその日が無い)。
// WINTICKET の過去の出走表は「そのレースの時点の成績」と同じ並び予想が残っているので、それで予想をし直す。
//   ・予想はふだんと同じ fetch.js(FETCH_DATE)。前回開催の得点の増減は、その日より前の scores.json だけを見る(prevMeetScore)
//   ・結果・3連複配当・確定オッズは results.js / gitfill.js と同じく WINTICKET の1レース1ページ
//   ・締切前の倍率の記録は無いので、期待値・モデルDは確定オッズで計算される(成績では出どころ "f")
//   ・作り直した記録には rb: 1 を付ける(後から作った予想。分析で外せるように)
//
// 使い方: node wtday.js --date=YYYY-MM-DD [--apply] [--dayraw=<pastcard ブランチのフォルダ>]
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");
const WT = require("./wt.js");
const { raceDate, normalizeResult, makeEntry, saveFinalOdds } = require("./results.js");

const arg = (k) => { const a = process.argv.find((x) => x.startsWith("--" + k + "=")); return a ? a.slice(k.length + 3) : ""; };
const DATE = arg("date"), APPLY = process.argv.includes("--apply"), DAYRAW = arg("dayraw");
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) { console.error("使い方: node wtday.js --date=YYYY-MM-DD [--apply] [--dayraw=<フォルダ>]"); process.exit(1); }
const d8 = DATE.replace(/-/g, "");

async function main() {
  const histPath = path.join(__dirname, "history.json");
  const hist = JSON.parse(fs.readFileSync(histPath, "utf8"));
  const before = hist.entries.length;
  const done = new Set(hist.entries.map((e) => e.id));

  // 1. その日の出走表を作り直す(fetch.js をそのまま使う。書き出しは一時ファイルだけ)
  const tmp = path.join(require("os").tmpdir(), "wtday-" + d8 + ".json");
  const r = spawnSync(process.execPath, [path.join(__dirname, "fetch.js")], { env: { ...process.env, FETCH_DATE: DATE, RACES_OUT: tmp }, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  console.log(r.stdout.split("\n").filter((l) => !/^\s+OK /.test(l)).join("\n"));
  if (r.status !== 0 || !fs.existsSync(tmp)) { console.error("出走表を作れませんでした"); process.exit(1); }
  const races = JSON.parse(fs.readFileSync(tmp, "utf8")).races.filter((x) => raceDate(x) === DATE);
  console.log("作り直した出走表:", races.length, "R / 🔥", races.filter((x) => x.plan && x.plan.hot).length, "R");

  // 2. 結果(まだ history に無いレースだけ)
  const want = races.filter((x) => !done.has(d8 + "_" + x.key));
  const got = want.length ? await WT.finishedRaces(want) : {};
  let added = 0, noRes = 0;
  const finalOdds = {};
  for (const x of want) {
    const g = got[x.place + "_" + x.raceNo];
    if (g && g.odds) finalOdds[d8 + "_" + x.key] = g.odds;
    if (!g || !g.res || !normalizeResult(g.res)) { noRes++; continue; }
    hist.entries.push({ ...makeEntry(x, g.res, d8), rb: 1 });
    done.add(d8 + "_" + x.key);
    added++;
  }
  console.log("追加:", added, "件 / 結果なし:", noRes, "件 / 既に有り:", races.length - want.length, "件");

  // 【安全装置】履歴を書くコードは必ず「消さないか」を確認すること(過去に5回消している)
  if (hist.entries.length < before) { console.error("件数が減っています。書き込まずに中止します。"); process.exit(1); }
  if (!APPLY) { console.log("点検のみのため書き込みませんでした。--apply を付けると書き込みます。"); return; }
  if (added) {
    hist.entries.sort((p, q) => (p.date === q.date ? (p.id < q.id ? -1 : 1) : p.date < q.date ? -1 : 1));
    fs.writeFileSync(histPath, JSON.stringify(hist));
    console.log("history.json を書き込みました:", before, "→", hist.entries.length, "件");
  }
  saveFinalOdds(__dirname, finalOdds);

  // 3. 成績で過去のレースを開くための出走表のテキスト(dayraw.js と同じ形)
  if (DAYRAW) {
    const f = path.join(DAYRAW, "dayraw-" + d8.slice(0, 6) + ".json.gz");
    let cur = {};
    try { cur = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString("utf8")); } catch (e) {}
    const n0 = Object.keys(cur).length;
    for (const x of races) if (x.raw) cur[d8 + "_" + x.place + "_" + x.raceNo] = x.raw;
    fs.writeFileSync(f, zlib.gzipSync(JSON.stringify(cur)));
    console.log(path.basename(f) + ":", n0, "→", Object.keys(cur).length, "レース");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
