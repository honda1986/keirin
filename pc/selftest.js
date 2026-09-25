#!/usr/bin/env node
// ============================================================
// pc/selftest.js — pc/runner.js の動きを、外(GitHub・Kドリームス)に触らずに確かめる
//
//   node pc/selftest.js
//
// 一時フォルダに「GitHub の代わりの空リポジトリ」と「PC の作業フォルダ」を作り、
// snap.js を「1行足すだけの偽物」に差し替えて runner.js を何度か動かす。確かめること:
//   1. 1回動くと odds-snap に記録のまとめと心拍(pc/heartbeat.json)が届く
//   2. 同じ時間に GitHub 側(snap.yml)も書いていた場合、両方の記録が足し合わされる(どちらも消えない)
//   3. ロックがあると何もしない(終了コード2)。古いロックは捨てて動く
//   4. 送れない(GitHub に届かない)ときも落ちず、記録は残り、次に届くようになったら送られる
//   5. コードを手で直しかけていたら、コードは取り込まず races.json だけ新しくなる
// ============================================================
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

const SRC = path.resolve(__dirname, "..");
const T = fs.mkdtempSync(path.join(os.tmpdir(), "keirin-selftest-"));
const ORIGIN = path.join(T, "origin.git");
const PC = path.join(T, "pc-repo");
const GH = path.join(T, "gh-side");
const LOGS = path.join(T, "logs");
const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let fails = 0;

function sh(cmd, args, cwd) {
  const p = spawnSync(cmd, args, { cwd, env, encoding: "utf8", windowsHide: true });
  if (p.status !== 0) throw new Error(cmd + " " + args.join(" ") + " → " + (p.stderr || p.stdout));
  return (p.stdout || "").trim();
}
const git = (args, cwd) => sh("git", args, cwd);
function check(name, ok, detail) {
  console.log((ok ? "  ○ " : "  × ") + name + (detail ? " — " + detail : ""));
  if (!ok) fails++;
}
function runner(extra = []) {
  // 毎回「前回から10分以上たった」ことにして、取り込みと送信を必ず動かす
  const st = path.join(PC, "snapwork", "runner.json");
  if (fs.existsSync(st)) fs.writeFileSync(st, "{}");
  const p = spawnSync(process.execPath, [path.join(PC, "pc", "runner.js"), "snap", "--log-dir", LOGS, ...extra], { cwd: PC, env, encoding: "utf8", windowsHide: true });
  return { code: p.status, out: (p.stdout || "") + (p.stderr || "") };
}
function remoteRows(date) {
  const buf = spawnSync("git", ["show", "odds-snap:snap/" + date + ".json.gz"], { cwd: ORIGIN, env });
  if (buf.status !== 0) return null;
  return JSON.parse(zlib.gunzipSync(buf.stdout).toString("utf8")).rows;
}
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "");

try {
  console.log("一時フォルダ:", T);
  // --- GitHub の代わり(main と odds-snap) ---
  git(["init", "-q", "--bare", "-b", "main", ORIGIN]);   // -b main が無いと clone が空になる(HEAD が master を指す)
  const seed = path.join(T, "seed");
  fs.mkdirSync(path.join(seed, "pc"), { recursive: true });
  for (const f of ["snap_pack.js", "pc/runner.js"]) fs.copyFileSync(path.join(SRC, f), path.join(seed, f));
  // 偽の snap.js: 呼ばれるたびに今日の記録を1行足すだけ(ネットに出ない)
  fs.writeFileSync(path.join(seed, "snap.js"), `
const fs=require("fs"),path=require("path");const d=path.join(__dirname,"snapwork");fs.mkdirSync(d,{recursive:true});
const t=new Date(Date.now()+9*3600e3).toISOString();const day=t.slice(0,10).replace(/-/g,"");
fs.appendFileSync(path.join(d,day+".jsonl"),JSON.stringify({t:t.slice(11,23),k:"テスト_1R",left:5,o:[1.5]})+"\\n");console.log("偽のsnap: 1行足した");`);
  fs.writeFileSync(path.join(seed, "races.json"), JSON.stringify({ races: [{ date: "2000年01月01日" }] }));
  fs.writeFileSync(path.join(seed, ".gitignore"), "snapwork/\nsnapbr/\n");
  git(["init", "-q", "-b", "main"], seed); git(["add", "-A"], seed); git(["commit", "-qm", "seed"], seed);
  git(["push", "-q", ORIGIN, "main"], seed);
  git(["checkout", "-q", "--orphan", "odds-snap"], seed); git(["rm", "-rqf", "."], seed);
  fs.writeFileSync(path.join(seed, "README.md"), "odds-snap\n"); git(["add", "README.md"], seed); git(["commit", "-qm", "start"], seed);
  git(["push", "-q", ORIGIN, "odds-snap"], seed);
  git(["clone", "-q", ORIGIN, PC]);

  console.log("\n0. 記録がまだ1件も無いとき(夜中など)");
  fs.writeFileSync(path.join(PC, "snap.js"), 'console.log("偽のsnap: レースなし")');   // 何も記録しない snap.js
  let r = runner();
  const hb0 = spawnSync("git", ["show", "odds-snap:pc/heartbeat.json"], { cwd: ORIGIN, env, encoding: "utf8" });
  check("記録が無くても心拍は届く", r.code === 0 && hb0.status === 0 && /"at"/.test(hb0.stdout), "code=" + r.code);
  git(["checkout", "--", "snap.js"], PC);

  console.log("\n1. 1回動かす");
  r = runner();
  check("終了コード0", r.code === 0, "code=" + r.code);
  let rows = remoteRows(today);
  check("odds-snap に今日の記録が届いた", rows && rows.length === 1, rows ? rows.length + "行" : "無し");
  const hb = spawnSync("git", ["show", "odds-snap:pc/heartbeat.json"], { cwd: ORIGIN, env, encoding: "utf8" });
  check("心拍(pc/heartbeat.json)が届いた", hb.status === 0 && /"at"/.test(hb.stdout));
  check("ログが残った", fs.existsSync(path.join(LOGS, "snap_" + today + ".log")));

  console.log("\n2. GitHub 側も同じ日に書いていた場合");
  git(["clone", "-q", "-b", "odds-snap", ORIGIN, GH]);
  const ghRows = (remoteRows(today) || []).concat([{ t: "00:00:01.000", k: "テスト_2R", left: 3, o: [2.5] }]);
  fs.mkdirSync(path.join(GH, "snap"), { recursive: true });
  fs.writeFileSync(path.join(GH, "snap", today + ".json.gz"), zlib.gzipSync(JSON.stringify({ date: today, rows: ghRows })));
  git(["add", "-A"], GH); git(["commit", "-qm", "gh"], GH); git(["push", "-q", "origin", "HEAD:refs/heads/odds-snap"], GH);
  r = runner();
  rows = remoteRows(today) || [];
  check("PC の記録(2回ぶん)と GitHub の記録(1行)が両方ある", rows.length === 3 && rows.some((x) => x.k === "テスト_2R"), rows.length + "行");

  console.log("\n3. ロック");
  fs.writeFileSync(path.join(LOGS, "snap.lock"), "x");
  r = runner();
  check("ロックがあると何もしない(終了コード2)", r.code === 2, "code=" + r.code);
  const old = new Date(Date.now() - 30 * 60000);
  fs.utimesSync(path.join(LOGS, "snap.lock"), old, old);
  r = runner();
  check("30分前のロックは捨てて動く", r.code === 0 && /古いロック/.test(r.out), "code=" + r.code);
  check("動いた後はロックが消えている", !fs.existsSync(path.join(LOGS, "snap.lock")));

  console.log("\n4. GitHub に届かないとき");
  const n0 = (remoteRows(today) || []).length;
  git(["remote", "set-url", "origin", path.join(T, "nowhere.git")], PC);
  r = runner();
  check("落ちない(終了コード0)", r.code === 0, "code=" + r.code);
  check("理由をログに出す", /取れず|取り込めず/.test(r.out));
  git(["remote", "set-url", "origin", ORIGIN], PC);
  r = runner();
  rows = remoteRows(today) || [];
  check("届くようになったら、届かなかった間の記録も送られる", rows.length === n0 + 2, n0 + " → " + rows.length + "行");

  console.log("\n5. コードを手で直しかけていたとき");
  const up = path.join(T, "upd");
  git(["clone", "-q", ORIGIN, up]);
  fs.writeFileSync(path.join(up, "races.json"), JSON.stringify({ races: [{ date: "2099年12月31日" }] }));
  fs.writeFileSync(path.join(up, "pc", "runner.js"), fs.readFileSync(path.join(up, "pc", "runner.js"), "utf8") + "\n// GitHub 側の変更\n");
  git(["commit", "-qam", "update"], up); git(["push", "-q", "origin", "main"], up);
  fs.appendFileSync(path.join(PC, "snap_pack.js"), "\n// 手で直しかけ\n");
  r = runner();
  check("races.json は新しくなる", /2099年12月31日/.test(fs.readFileSync(path.join(PC, "races.json"), "utf8")));
  check("手で直したファイルは残る", /手で直しかけ/.test(fs.readFileSync(path.join(PC, "snap_pack.js"), "utf8")));
  check("その旨をログに出す", /見送り/.test(r.out));
  spawnSync("git", ["checkout", "--", "snap_pack.js"], { cwd: PC, env });
  r = runner();
  const took = /GitHub 側の変更/.test(fs.readFileSync(path.join(PC, "pc", "runner.js"), "utf8")) && /取り込みました/.test(r.out);
  check("直しかけが無くなれば、コードも取り込む", took, took ? "" : r.out.split("\n").slice(0, 4).join(" / "));
} catch (e) {
  console.log("  × 途中で失敗: " + e.message);
  fails++;
}
console.log("\n" + (fails ? "★失敗 " + fails + " 件" : "すべて OK"));
try { fs.rmSync(T, { recursive: true, force: true }); } catch (e) {}
process.exitCode = fails ? 1 : 0;
