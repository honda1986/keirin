// ============================================================
// dayraw.js — その日(races.json)の出走表のテキスト(raw)を、pastcard ブランチの dayraw-YYYYMM.json.gz に足す
//
// アプリの成績タブで過去のレースを押すと、その日の出走表から詳細(展開予想など)を開く(hikitsugi §4-33)。
//   2022-01〜2026-09 は pastcard ブランチの pcraw-YYYYMM.json.gz(pastcard.js が作った分)、
//   それより後は毎晩 results.yml がこれで足す。形は pcraw と同じ { "YYYYMMDD_場名_1R": テキスト }
//   ★出走表の文字だけ(予想・買い目は入れない)。races.json は合言葉で暗号化してあるので KEIRIN_PASS が要る
//
// 使い方: node dayraw.js <pastcard ブランチを出したフォルダ>
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const DF = require("./datafile.js");
const { raceDate } = require("./results.js");

const OUT = process.argv[2];
if (!OUT || !fs.existsSync(OUT)) { console.error("使い方: node dayraw.js <pastcard ブランチのフォルダ>"); process.exit(1); }
const races = DF.read(path.join(__dirname, "races.json")).races || [];
const byMonth = {};
for (const x of races) {
  const d = raceDate(x);
  if (!d || !x.raw || !x.place || !x.raceNo) continue;
  const d8 = d.replace(/-/g, "");
  (byMonth[d8.slice(0, 6)] = byMonth[d8.slice(0, 6)] || {})[d8 + "_" + x.place + "_" + x.raceNo] = x.raw;
}
for (const [ym, add] of Object.entries(byMonth)) {
  const f = path.join(OUT, "dayraw-" + ym + ".json.gz");
  let cur = {};
  try { cur = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString("utf8")); } catch (e) {}
  const before = Object.keys(cur).length;
  Object.assign(cur, add);
  fs.writeFileSync(f, zlib.gzipSync(JSON.stringify(cur)));
  console.log("dayraw-" + ym + ".json.gz:", before, "→", Object.keys(cur).length, "レース");
}
if (!Object.keys(byMonth).length) console.log("races.json に出走表のテキストがありません");
