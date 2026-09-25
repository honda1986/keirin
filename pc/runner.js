#!/usr/bin/env node
// ============================================================
// pc/runner.js — PC(タスクスケジューラ)で締切前オッズを記録する入口
//
//   node pc/runner.js snap [--log-dir C:\keirin\logs] [--dry]
//
// タスクスケジューラから1分おきに呼ばれ、1回ぶんだけ動いて終わる(競艇 v24 の runner.py と同じ考え方)。
// 途中で落ちても失うのはその1分ぶんだけ。1回でやること:
//
//   1. 二重起動を防ぐ(ロック。古いロックは捨てる)
//   2. 10分おきに GitHub(main)を取り込む。出走表(races.json)とコードを新しくする
//      ・取り込めなければ何もしない(手元を壊さない)
//      ・コードを手で直しかけていたら、コードの取り込みは見送って races.json だけ新しくする
//   3. races.json が今日の分でなければ(GitHub の朝の更新が遅れた日)、自分で出走表を取る
//      (fetch.js。書き先は snapwork/races-local.json で、main のファイルには触らない)
//   4. snap.js を1回動かす(締切15〜2分前のレースの3連複を読んで snapwork/ に1行ずつ足す)
//   5. 10分おきに odds-snap ブランチへ送る: 記録のまとめ(snap/日付.json.gz)と心拍(pc/heartbeat.json)
//      ・リモートを土台に置き直してから足し合わせる(rebase も --force も使わない)
//      ・送れなくても何も消さない。次の回がまた送る
//      ・GitHub の snap.yml は心拍が25分以上古いと「PC が止まった」として代わりに記録を始める
//
// 終了コード: 0 正常 / 1 本体が失敗 / 2 前の回がまだ動いていたので何もしなかった / 3 フォルダが違う
// ============================================================
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const TASK = argv[0] || "snap";
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DRY = argv.includes("--dry");                       // 送らない(試し運転)
const LOGDIR = path.resolve(opt("log-dir", path.join(REPO, "..", "logs")));
const WORK = path.join(REPO, "snapwork");                 // snap.js の記録置き場(git に入れない)
const SNAPBR = path.join(REPO, "snapbr");                 // odds-snap ブランチを置く別の作業フォルダ(git に入れない)
const STATE = path.join(WORK, "runner.json");
const LOCK = path.join(LOGDIR, TASK + ".lock");
const LOCK_STALE_MIN = 20;       // これより古いロックは、強制終了で残ったものとみなして捨てる(タスクの打ち切り15分+5分)
const PULL_EVERY_MIN = 10;       // GitHub を取り込む間隔
const PUSH_EVERY_MIN = 10;       // odds-snap へ送る間隔(= 心拍の間隔。snap.yml は25分で PC 停止とみなす)
const LOCAL_FETCH_EVERY_MIN = 20;
const KEEP_DAYS = 14;            // snapwork の日別記録を残す日数(送り終わったものを掃除する)

// ★git に「人に聞く」をさせない(v24 で実機が固まった)。タスクスケジューラには画面が無いので、
//   認証を聞かれると入力窓を出せずに止まり、以後ずっとロックで「まだ動いています」になる。
//   聞かずに失敗させれば「送れず(次の回に持ち越し)」で済む。
const GIT_ENV = { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_ASKPASS: "", SSH_ASKPASS: "" };
const GIT_TIMEOUT_MS = 180 * 1000;

const jst = () => new Date(Date.now() + 9 * 3600e3);
const today8 = () => jst().toISOString().slice(0, 10).replace(/-/g, "");
const hhmmss = () => jst().toISOString().slice(11, 19);

// ---- ログ(logs/snap_YYYYMMDD.log に時刻つきで1行ずつ) ----
function log(msg) {
  const lines = String(msg).split(/\r?\n/).filter((l) => l.trim());
  const text = lines.map((l) => hhmmss() + " " + l).join("\n");
  if (!text) return;
  console.log(text);
  try { fs.mkdirSync(LOGDIR, { recursive: true }); fs.appendFileSync(path.join(LOGDIR, TASK + "_" + today8() + ".log"), text + "\n"); }
  catch (e) { console.log("(ログに書けません: " + e.message + ")"); }
}

function run(cmd, args, { cwd = REPO, env = {}, timeout = GIT_TIMEOUT_MS } = {}) {
  const p = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8", timeout, windowsHide: true });
  if (p.error) {
    const why = p.error.code === "ETIMEDOUT" ? (timeout / 1000) + "秒で戻ってこないので諦めました" : p.error.message;
    return { ok: false, out: cmd + " " + args.join(" ") + ": " + why };
  }
  return { ok: p.status === 0, out: ((p.stdout || "") + (p.stderr || "")).trim() };
}
const git = (args, o = {}) => run("git", args, { ...o, env: { ...GIT_ENV, ...(o.env || {}) } });
const node = (args, o = {}) => run(process.execPath, args, o);

function loadState() { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch (e) { return {}; } }
function saveState(st) { try { fs.mkdirSync(WORK, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(st)); } catch (e) {} }
const minsSince = (t) => (t ? (Date.now() - t) / 60000 : Infinity);

// ---- 1. ロック ----
function takeLock() {
  fs.mkdirSync(LOGDIR, { recursive: true });
  for (let a = 0; a < 2; a++) {
    try { const fd = fs.openSync(LOCK, "wx"); fs.writeSync(fd, String(process.pid) + " " + new Date().toISOString()); fs.closeSync(fd); return true; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      let age = 0;
      try { age = (Date.now() - fs.statSync(LOCK).mtimeMs) / 60000; } catch (e2) { continue; }
      if (age < LOCK_STALE_MIN) return false;
      log("古いロック(" + Math.round(age) + "分前)を捨てます。前の回が強制終了されたようです");
      try { fs.unlinkSync(LOCK); } catch (e3) {}
    }
  }
  return false;
}
const dropLock = () => { try { fs.unlinkSync(LOCK); } catch (e) {} };

// ---- 2. GitHub(main)の取り込み ----
function pullMain(st) {
  if (minsSince(st.lastPull) < PULL_EVERY_MIN) return;
  st.lastPull = Date.now();
  const f = git(["fetch", "-q", "origin", "main"]);
  if (!f.ok) { log("GitHub から取り込めず(手元のまま続ける): " + f.out.split("\n").pop()); return; }
  // races.json は GitHub のものが正。手元の差分は捨ててよい(PC は書かない)
  // (前回「races.json だけ新しくした」ときは index にも入っているので、HEAD から戻す)
  git(["checkout", "-q", "HEAD", "--", "races.json"]);
  const dirty = git(["status", "--porcelain", "--untracked-files=no"]).out.split("\n").filter((l) => l.trim() && !/races\.json$/.test(l));
  if (dirty.length) {
    // ★コードを手で直しかけていたら、上書きしない。races.json だけ新しくする
    const r = git(["checkout", "-q", "FETCH_HEAD", "--", "races.json"]);
    log("手で直しかけのファイルがあるので、コードの取り込みは見送り(races.json だけ新しくした" + (r.ok ? "" : "かったが失敗") + "): " + dirty.slice(0, 3).map((l) => l.trim()).join(", "));
    return;
  }
  const before = git(["rev-parse", "--short", "HEAD"]).out;
  const m = git(["merge", "--ff-only", "-q", "FETCH_HEAD"]);
  if (!m.ok) { log("取り込みに失敗(手元のまま続ける): " + m.out.split("\n").pop()); return; }
  const after = git(["rev-parse", "--short", "HEAD"]).out;
  if (before !== after) log("GitHub を取り込みました " + before + " → " + after);
}

// ---- 3. 出走表が今日の分でないときは自分で取る ----
function raceDayOf(file) {
  try {
    const rj = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const x of rj.races || []) {
      const j = String(x.date || "").match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
      if (j) return j[1] + j[2].padStart(2, "0") + j[3].padStart(2, "0");
    }
  } catch (e) {}
  return null;
}
function ensureRaces(st) {
  const t = today8();
  if (raceDayOf(path.join(REPO, "races.json")) === t) return;
  const local = path.join(WORK, "races-local.json");
  if (raceDayOf(local) === t) return;
  if (jst().getUTCHours() < 7) return;                               // 7時前は GitHub の朝の更新を待つ
  if (minsSince(st.lastLocalFetch) < LOCAL_FETCH_EVERY_MIN) return;
  st.lastLocalFetch = Date.now();
  saveState(st);
  log("races.json がまだ今日の分ではないので、PC で出走表を取ります(fetch.js)");
  fs.mkdirSync(WORK, { recursive: true });
  const r = node([path.join(REPO, "fetch.js")], { env: { RACES_OUT: local }, timeout: 8 * 60 * 1000 });
  const tail = r.out.split("\n").filter((l) => /書き出し|所要|失敗|Error|作れません/.test(l)).slice(-3).join(" / ");
  log((r.ok && raceDayOf(local) === t ? "出走表を取りました: " : "出走表を取れませんでした(" + LOCAL_FETCH_EVERY_MIN + "分後にまた試す): ") + tail);
}

// ---- 4. snap.js ----
function snapOnce() {
  const args = [path.join(REPO, "snap.js")];
  if (DRY) args.push("--dry");
  const r = node(args, { timeout: 120 * 1000 });
  if (r.out) log(r.out);
  if (!r.ok) log("snap.js が失敗: 終了コードが0でない");
  return r.ok;
}

// ---- 5. odds-snap ブランチへ送る(まとめ + 心拍) ----
function countToday() {
  try { return fs.readFileSync(path.join(WORK, today8() + ".jsonl"), "utf8").split("\n").filter((l) => l.trim()).length; } catch (e) { return 0; }
}
function pushSnap(st) {
  if (DRY) return;
  if (minsSince(st.lastPush) < PUSH_EVERY_MIN) return;
  st.lastPush = Date.now();
  for (let a = 1; a <= 3; a++) {
    const f = git(["fetch", "-q", "origin", "refs/heads/odds-snap"]);
    if (!f.ok) { log("odds-snap を取れず(次の回に持ち越し): " + f.out.split("\n").pop()); return; }
    if (!fs.existsSync(path.join(SNAPBR, ".git"))) {
      git(["worktree", "prune"]);
      const w = git(["worktree", "add", "-q", "--detach", SNAPBR, "FETCH_HEAD"]);
      if (!w.ok) { log("記録用の作業フォルダを作れず: " + w.out.split("\n").pop()); return; }
    }
    const f2 = git(["fetch", "-q", "origin", "refs/heads/odds-snap"], { cwd: SNAPBR });
    const rs = f2.ok && git(["reset", "-q", "--hard", "FETCH_HEAD"], { cwd: SNAPBR });
    if (!f2.ok || !rs.ok) { log("記録用の作業フォルダを最新にできず(次の回に持ち越し)"); return; }
    const pk = node([path.join(REPO, "snap_pack.js"), path.join(SNAPBR, "snap")]);
    if (!pk.ok) { log("まとめに失敗: " + pk.out.split("\n").pop()); return; }
    fs.mkdirSync(path.join(SNAPBR, "pc"), { recursive: true });
    fs.writeFileSync(path.join(SNAPBR, "pc", "heartbeat.json"), JSON.stringify({
      at: new Date().toISOString(), host: os.hostname(), races_day: raceDayOf(path.join(REPO, "races.json")),
      local_races_day: raceDayOf(path.join(WORK, "races-local.json")), snaps_today: countToday(),
    }, null, 1) + "\n");
    git(["add", "snap", "pc"], { cwd: SNAPBR });
    if (git(["diff", "--cached", "--quiet"], { cwd: SNAPBR }).ok) return;
    const c = git(["-c", "user.name=keirin-pc", "-c", "user.email=keirin-pc@users.noreply.github.com",
      "commit", "-q", "-m", "odds snap (PC) " + jst().toISOString().slice(0, 16).replace("T", " ")], { cwd: SNAPBR });
    if (!c.ok) { log("commit に失敗: " + c.out.split("\n").pop()); return; }
    const p = git(["push", "-q", "origin", "HEAD:refs/heads/odds-snap"], { cwd: SNAPBR });
    if (p.ok) { log("odds-snap に送りました(今日の記録 " + countToday() + "回ぶん)"); return; }
    log("送れず(" + a + "/3): " + p.out.split("\n").pop());
    if (/Authentication|could not read Username|terminal prompts disabled|403|401/i.test(p.out)) {
      log("★GitHub のログインが要ります。pc\\setup.bat をダブルクリックして、画面のある窓で1回ログインしてください");
      return;
    }
  }
}

// 送り終わった古い日の記録を掃除する(送った後なら、同じ中身が odds-snap にある)
function cleanup() {
  try {
    const cut = new Date(Date.now() + 9 * 3600e3 - KEEP_DAYS * 86400e3).toISOString().slice(0, 10).replace(/-/g, "");
    for (const f of fs.readdirSync(WORK)) if (/^\d{8}\.jsonl$/.test(f) && f.slice(0, 8) < cut) { fs.unlinkSync(path.join(WORK, f)); log("古い記録を消しました: " + f); }
  } catch (e) {}
}

function main() {
  if (TASK !== "snap") { console.log("使い方: node pc/runner.js snap [--log-dir DIR] [--dry]"); return 3; }
  if (!fs.existsSync(path.join(REPO, "snap.js")) || !fs.existsSync(path.join(REPO, ".git"))) {
    console.log("フォルダが違います(snap.js と .git がある競輪のリポジトリの pc から動かすこと): " + REPO);
    return 3;
  }
  if (!takeLock()) { log("前の回がまだ動いているので、今回は何もしません"); return 2; }
  let code = 0;
  try {
    const st = loadState();
    try { pullMain(st); } catch (e) { log("取り込みで例外: " + e.message); }
    saveState(st);
    try { ensureRaces(st); } catch (e) { log("出走表の予備取得で例外: " + e.message); }
    if (!snapOnce()) code = 1;
    try { pushSnap(st); } catch (e) { log("送る処理で例外: " + e.message); }
    saveState(st);
    cleanup();
  } catch (e) {
    log("失敗: " + (e.stack || e.message));
    code = 1;
  } finally {
    dropLock();
  }
  return code;
}

process.exitCode = main();
