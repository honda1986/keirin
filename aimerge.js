#!/usr/bin/env node
// ============================================================
// aimerge.js — PC が送った今日の AI予想(odds-snap ブランチの ai/日付.json)を races.json の ai に足す(GitHub 用。hikitsugi §4-58)
//
//   node aimerge.js [--file 手元のファイル] [--dry]
//
// ・2026-11-15 から WINTICKET は海外からのアクセスを止めたので、GitHub(アメリカ)では AI予想が取れない(§4-57)。
//   日本の PC が aiget.js で取り、pc/runner.js が合言葉で暗号化して odds-snap に送る。これを live.yml(10分おき)と
//   main.yml(出走表を取った直後)が races.json に足す。アプリのⒶ・夜の成績(history の ai)・PC の自動投票が読む。
// ・足すのは races.json の今日のレースで、まだ ai が無いものだけ(WINTICKET で取れた日の ai は触らない)。
// ・変わったときだけ races.json を書く(合言葉があれば暗号化。無ければ書かない = 暗号化していない races.json に足さない)。
// ・ログに出すのは件数だけ(どのレースかは出さない。Actions のログは公開)
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const DF = require("./datafile.js");

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const fileArg = (() => { const i = argv.indexOf("--file"); return i >= 0 ? argv[i + 1] : null; })();
const RACES = path.join(__dirname, "races.json");

function raceDay(x) {
  const j = String(x.date || "").match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  return j ? j[1] + j[2].padStart(2, "0") + j[3].padStart(2, "0") : null;
}
const git = (args) => { const p = spawnSync("git", args, { cwd: __dirname, encoding: "utf8", maxBuffer: 64 << 20 }); return { ok: p.status === 0, out: p.stdout || "", err: p.stderr || "" }; };

// PC が送った AI予想 → { "場_nR": [4車] }。無ければ null
function loadAi(d8) {
  let text = null;
  if (fileArg) { try { text = fs.readFileSync(fileArg, "utf8"); } catch (e) { return null; } }
  else {
    const f = git(["fetch", "-q", "--depth=1", "origin", "refs/heads/odds-snap"]);
    if (!f.ok) { console.log("AI予想: odds-snap を取れず"); return null; }
    const s = git(["show", "FETCH_HEAD:ai/" + d8 + ".json"]);
    if (!s.ok) return null;
    text = s.out;
  }
  const j = DF.parse(text);
  return j && j.date === d8 && j.ai && typeof j.ai === "object" ? j.ai : null;
}

function main() {
  if (!DF.hasKey()) { console.log("AI予想: 合言葉が無いので足さない"); return; }
  let rj;
  try { rj = DF.read(RACES); } catch (e) { console.log("AI予想: races.json を読めず(" + e.message + ")"); return; }
  const races = rj.races || [];
  const days = [...new Set(races.map(raceDay).filter(Boolean))].sort();
  const d8 = days[days.length - 1];
  if (!d8) { console.log("AI予想: races.json にレースが無い"); return; }
  let ai;
  try { ai = loadAi(d8); } catch (e) { console.log("AI予想: PC のファイルを解けず(" + e.message + ")"); return; }
  const sRaces = races.filter((x) => raceDay(x) === d8 && x.klass === "s");
  const lacking = sRaces.filter((x) => !(Array.isArray(x.ai) && x.ai.length === 4));
  if (!ai) { console.log("AI予想: PC から今日(" + d8 + ")の分が届いていない(S級 " + sRaces.length + "R・ai なし " + lacking.length + "R)"); return; }
  let added = 0;
  for (const x of lacking) {
    const a = ai[x.key];
    if (Array.isArray(a) && a.length === 4 && a.every((c) => Number.isInteger(c) && c >= 1 && c <= 9)) { x.ai = a.slice().sort((p, q) => p - q); added++; }
  }
  console.log("AI予想: 足した " + added + "R(S級 " + sRaces.length + "R・PC の分 " + Object.keys(ai).length + "R・まだ無い " + (lacking.length - added) + "R)");
  if (!added || DRY) return;
  rj.aiAt = new Date().toISOString();
  DF.write(RACES, rj, { updatedAt: rj.updatedAt });
}

if (require.main === module) main();
module.exports = { raceDay };
