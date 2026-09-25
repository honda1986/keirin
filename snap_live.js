// ============================================================
// snap_live.js — いちばん新しい締切前オッズを odds-live ブランチの latest.json に置く(アプリが読む)
//
//   node snap_live.js --push --source PC      … 新しい記録があれば作って送る(pc/runner.js が毎分呼ぶ)
//   node snap_live.js --push --source GitHub  … 同上(snap.yml が PC の代わりに記録しているとき)
//   node snap_live.js                          … 作るだけ(snapwork/latest.json)
//
// ・中身: 今日の各レースの「いちばん新しい記録」1件ずつ
//     { updatedAt, date, source, races: { "熊本_7R": { t, left, upd, n, o:[3連複の倍率…] } } }
// ・odds-live ブランチは**履歴を残さない**(毎回1コミットだけの枝を作って上書き)。1分おきに送っても膨らまない。
//   記録の保存は odds-snap ブランチ(10分おき・履歴あり)の仕事で、こちらはアプリに今の倍率を見せるためだけ
// ・git の作業フォルダは使わない(hash-object → mktree → commit-tree → push)。本体の作業を邪魔しない
// ・アプリは raw.githubusercontent.com ではなく GitHub の API(contents)で読む。raw はブランチを
//   書き換えても3分以上古い中身を返した(2026-09-26 に確認)。API は書き換え直後から新しい
// ・新しい記録があれば送る。無くても5分おきに送る(= PC の心拍。snap.yml が見ている)
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DIR = path.join(__dirname, "snapwork");
const OUT = path.join(DIR, "latest.json");
const STATE = path.join(DIR, "live.json");
const argv = process.argv.slice(2);
const PUSH = argv.includes("--push");
const FORCE = argv.includes("--force");
const HEARTBEAT_MIN = 5;
const SOURCE = (() => { const i = argv.indexOf("--source"); return i >= 0 ? argv[i + 1] : "?"; })();
const GIT_ENV = { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_ASKPASS: "", SSH_ASKPASS: "",
  GIT_AUTHOR_NAME: "odds-live", GIT_AUTHOR_EMAIL: "odds-live@users.noreply.github.com",
  GIT_COMMITTER_NAME: "odds-live", GIT_COMMITTER_EMAIL: "odds-live@users.noreply.github.com" };

function git(args, input) {
  const p = spawnSync("git", args, { cwd: __dirname, env: { ...process.env, ...GIT_ENV }, encoding: "utf8", input, timeout: 60000, windowsHide: true });
  if (p.error) return { ok: false, out: p.error.message };
  return { ok: p.status === 0, out: ((p.stdout || "") + (p.stderr || "")).trim() };
}

function main() {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "");
  let lines = [];
  try { lines = fs.readFileSync(path.join(DIR, today + ".jsonl"), "utf8").split("\n").filter((l) => l.trim()); } catch (e) {}
  let st = {};
  try { st = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch (e) {}
  // 新しい記録が無くても5分おきには送る(= 心拍。GitHub の snap.yml は source=PC の updatedAt が
  // 15分以上古いと「PC が止まった」とみなして代わりに記録を始める)
  const fresh = st.date === today && st.count === lines.length;
  if (!FORCE && fresh && Date.now() - (st.at || 0) < HEARTBEAT_MIN * 60000) return;

  const races = {};
  for (const l of lines) {
    let r; try { r = JSON.parse(l); } catch (e) { continue; }
    const old = races[r.k];
    if (!old || r.t > old.t) races[r.k] = { t: r.t, left: r.left, upd: r.upd, n: r.n, o: r.o };
  }
  const body = JSON.stringify({ updatedAt: new Date().toISOString(), date: today, source: SOURCE, races });
  fs.writeFileSync(OUT, body);
  if (!PUSH) { console.log("latest.json を作りました(" + Object.keys(races).length + "レース)"); return; }

  const b = git(["hash-object", "-w", OUT]);
  const t = b.ok && git(["mktree"], "100644 blob " + b.out + "\tlatest.json\n");
  const c = t && t.ok && git(["commit-tree", t.out, "-m", "odds live " + today + " (" + SOURCE + ")"]);
  if (!c || !c.ok) { console.log("最新オッズを送る準備に失敗: " + ((c || t || b).out || "").split("\n").pop()); return; }
  const p = git(["push", "-q", "-f", "origin", c.out + ":refs/heads/odds-live"]);
  if (!p.ok) { console.log("最新オッズを送れず(次の回にまた送る): " + p.out.split("\n").pop()); return; }
  fs.writeFileSync(STATE, JSON.stringify({ date: today, count: lines.length, at: Date.now() }));
  if (!fresh) console.log("最新オッズを送りました(" + Object.keys(races).length + "レース)");
}

if (require.main === module) main();
