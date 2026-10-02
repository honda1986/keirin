#!/usr/bin/env node
// ============================================================
// pc/set_pass.js — 合言葉を PC に置く(pc\set_pass.bat から動く。hikitsugi §4-22)
//
// ・races.json・latest.json は合言葉で暗号化してある(datafile.js)。PC の記録・自動投票が読めるように、
//   GitHub の Secrets の KEIRIN_PASS と同じ合言葉をここで入れる → リポジトリ直下の .keirin_pass に保存
// ・.keirin_pass は .gitignore 済み(git には入らない)。入力は画面に出さない(* だけ出す)
// ・合言葉を変えたら、GitHub の KEIRIN_PASS とここの両方を変える
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const DF = require("../datafile.js");

const REPO = path.resolve(__dirname, "..");
const say = (...a) => console.log(...a);

// 画面に出さずに1行読む(* を出す)
function ask(q) {
  return new Promise((resolve) => {
    const si = process.stdin;
    process.stdout.write(q);
    if (!si.isTTY) {            // テスト用: 標準入力から1行
      let s = "";
      si.setEncoding("utf8");
      si.on("data", (d) => { s += d; const i = s.search(/\r?\n/); if (i >= 0) { si.pause(); resolve(s.slice(0, i)); } });
      si.on("end", () => resolve(s));
      return;
    }
    let s = "";
    si.setRawMode(true); si.resume(); si.setEncoding("utf8");
    const on = (d) => {
      for (const ch of d) {
        if (ch === "\r" || ch === "\n") { si.setRawMode(false); si.pause(); si.removeListener("data", on); process.stdout.write("\n"); return resolve(s); }
        if (ch === "\u0003") { process.stdout.write("\n"); process.exit(1); }          // Ctrl+C
        if (ch === "\b" || ch === "\u007f") { if (s.length) { s = s.slice(0, -1); process.stdout.write("\b \b"); } continue; }
        if (ch < " ") continue;
        s += ch; process.stdout.write("*");
      }
    };
    si.on("data", on);
  });
}

async function main() {
  say("競輪 合言葉の設定(PC)");
  say("GitHub の Settings → Secrets and variables → Actions の KEIRIN_PASS と同じ合言葉を入れてください。");
  say("(入力した文字は * で表示されます。やめるときは Ctrl+C)\n");
  const a = (await ask("合言葉: ")).trim();
  if (a.length < 8) { say("× 8文字以上にしてください(短いと当てられやすい)"); return 1; }
  const b = process.stdin.isTTY ? (await ask("もう一度: ")).trim() : a;
  if (a !== b) { say("× 1回目と2回目が違います。もう一度やり直してください"); return 1; }

  fs.writeFileSync(DF.PASS_FILE, a + "\n", { mode: 0o600 });
  say("\n○ 保存しました: " + DF.PASS_FILE);
  const ig = spawnSync("git", ["check-ignore", "-q", DF.PASS_FILE], { cwd: REPO });
  if (ig.status !== 0) say("★注意: .keirin_pass が git の対象外になっていません。pull してからもう一度動かしてください(git に入れないこと)");

  // 今の races.json が暗号化済みなら、解けるか確かめる
  process.env.KEIRIN_PASS = "";
  try {
    const j = JSON.parse(fs.readFileSync(path.join(REPO, "races.json"), "utf8"));
    if (!DF.isSealed(j)) say("  (今の races.json はまだ暗号化されていません。GitHub に KEIRIN_PASS を入れると、次の出走表の取得から暗号化されます)");
    else { DF.open(j); say("○ 今の races.json を解けました(GitHub の合言葉と一致)"); }
  } catch (e) {
    if (/合言葉|解けません/.test(e.message)) { say("× " + e.message); return 1; }
  }
  return 0;
}

main().then((c) => process.exit(c || 0), (e) => { console.log("× " + e.message); process.exit(1); });
