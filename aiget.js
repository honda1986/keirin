#!/usr/bin/env node
// ============================================================
// aiget.js — 今日のS級レースの WINTICKET の AI予想(4車)を取って、手元のファイルに足す(PC 用。hikitsugi §4-58)
//
//   node aiget.js --out snapwork/ai/YYYYMMDD.json [--day=YYYYMMDD] [--dry]
//
// ・2026-11-15 から WINTICKET は海外からのアクセスを止めた(§4-57)。GitHub(アメリカ)では AI予想が取れないので、
//   日本の PC がこれで取り、pc/runner.js が暗号化して odds-snap ブランチの ai/日付.json に送る。
//   GitHub の aimerge.js がそれを races.json の ai に足す(アプリ・夜の成績の記録・自動投票のⒶが使う)。
// ・対象は Ⓐ(aifav.js)が見る S級のレースだけ。出走表は races.json → snapwork/races-local.json の順で、今日の分。
// ・もう取れたレース(races.json に ai がある・ファイルにある)と、発走から5分すぎたレースは取りに行かない。
// ・トップページ(1回)→ 場ごとに1Rの出走表(開催の全レースと今日の日目)→ 足りないレースの出走表。1ページずつ0.7秒あける。
// ・書くファイルは { date, updatedAt, ai: { "場_nR": [4車] } }(手元・git に入らない snapwork の中なので暗号化しない)
// ・ログに出すのは件数だけ(どのレースを買うかは出さない)
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const WT = require("./wt.js");
const DF = require("./datafile.js");
const { TRACK_NAMES } = require("./bankdata.js");

const argv = process.argv.slice(2);
const opt = (k) => { const a = argv.find((x) => x.startsWith("--" + k + "=")); if (a) return a.slice(k.length + 3); const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes("--dry");
const jst = () => new Date(Date.now() + 9 * 3600e3);
const today = opt("day") || jst().toISOString().slice(0, 10).replace(/-/g, "");
const OUT = path.resolve(opt("out") || path.join(__dirname, "snapwork", "ai", today + ".json"));

function raceDay(x) {
  const j = String(x.date || "").match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  return j ? j[1] + j[2].padStart(2, "0") + j[3].padStart(2, "0") : null;
}
const minsSinceStart = (hhmm) => {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm || "")) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return (jst().getTime() - Date.UTC(+today.slice(0, 4), +today.slice(4, 6) - 1, +today.slice(6, 8), h, m)) / 60000;
};

function loadRaces() {
  for (const f of [path.join(__dirname, "races.json"), path.join(__dirname, "snapwork", "races-local.json")]) {
    try {
      const rs = (DF.read(f).races || []).filter((x) => raceDay(x) === today);
      if (rs.length) return rs;
    } catch (e) { if (/合言葉/.test(e.message)) console.log(e.message); }
  }
  return [];
}

async function main() {
  let cur = { date: today, ai: {} };
  try { const j = JSON.parse(fs.readFileSync(OUT, "utf8")); if (j && j.date === today && j.ai) cur = j; } catch (e) {}
  const races = loadRaces();
  if (!races.length) { console.log("AI予想: 今日(" + today + ")の出走表がありません"); return; }
  const MAX = +opt("max") || Infinity;   // 1回に取るレース数の上限(pc/runner.js が 15。発走の早い順)
  const want = races.filter((x) => x.klass === "s" && !(Array.isArray(x.ai) && x.ai.length === 4) && !cur.ai[x.key])
    .filter((x) => { const m = minsSinceStart(x.startTime); return m == null || m < 5; })
    .sort((a, b) => String(a.startTime || "99:99").localeCompare(String(b.startTime || "99:99"))).slice(0, MAX);
  const have = races.filter((x) => x.klass === "s").length;
  if (!want.length) { console.log("AI予想: 取りに行くレースなし(今日のS級 " + have + "R・手元 " + Object.keys(cur.ai).length + "R)"); return; }

  const byPlace = {};
  for (const x of want) (byPlace[x.place] = byPlace[x.place] || []).push(parseInt(x.raceNo, 10));
  let cups;
  try { cups = await WT.todayCups(); }
  catch (e) { console.log("AI予想: WINTICKET のトップページを取れず(" + e.message + ")"); process.exitCode = 1; return; }
  let got = 0, none = 0, fails = 0;
  for (const c of cups) {
    const i = WT.SLUGS.indexOf(c.slug);
    const place = i >= 0 ? TRACK_NAMES[i] : null;
    if (!place || !byPlace[place]) continue;
    try {
      const html1 = await WT.get(WT.urlOf("racecard", c.slug, c.cupId, c.index, 1));
      const S1 = WT.stateOf(html1);
      const CR = WT.query(S1, "FETCH_KEIRIN_CUP_RACES");
      const sch = CR && (CR.schedules || []).find((s) => String(s.date) === today);
      if (!sch || WT.placeOf(CR.cup && CR.cup.venueId) !== place) { await WT.sleep(700); continue; }
      for (const no of byPlace[place]) {
        let R;
        if (no === 1 && +sch.index === +c.index) R = WT.query(S1, "FETCH_KEIRIN_RACE");
        else { await WT.sleep(700); R = WT.query(WT.stateOf(await WT.get(WT.urlOf("racecard", c.slug, c.cupId, sch.index, no))), "FETCH_KEIRIN_RACE"); }
        if (!R || !R.race || +R.race.number !== no) { none++; continue; }
        const ai = WT.aiCars(R);
        if (ai.length === 4) { cur.ai[place + "_" + no + "R"] = ai; got++; } else none++;
      }
    } catch (e) { fails++; console.log("AI予想: " + place + " を取れず(" + e.message + ")"); if (fails >= 3) break; }
    await WT.sleep(700);
  }
  console.log("AI予想: 取れた " + got + "R / まだ出ていない " + none + "R / 手元の合計 " + Object.keys(cur.ai).length + "R(今日のS級 " + have + "R)");
  if (DRY || !got) return;
  cur.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(cur));
}

if (require.main === module) main().catch((e) => { console.log("aiget.js 失敗:", e.message); process.exitCode = 1; });
module.exports = { raceDay };
