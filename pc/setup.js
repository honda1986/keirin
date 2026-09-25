#!/usr/bin/env node
// ============================================================
// pc/setup.js — PC で締切前オッズの記録を始めるための下ごしらえ(pc\setup.bat から動く)
//
// 何度やり直しても壊れない(もうあるものは作り直さない)。途中で転んだら、直してからもう一度。
// ★GitHub のログインはここで済ませる。画面があるのは今だけで、タスクスケジューラには画面が無い
//   (そこで初めて聞かれると固まる。競艇 v24 で実機が止まった)
// ★タスクの登録はしない(管理者権限が要るので pc\tasks.bat に分けてある)
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const LOGS = path.resolve(REPO, "..", "logs");
const problems = [];
const say = (...a) => console.log(...a);
const step = (n, t) => say("\n--- " + n + " " + t + " " + "-".repeat(Math.max(0, 40 - t.length * 2)));
function ng(msg, how) { say("  × " + msg); if (how) for (const l of how.split("\n")) say("      " + l); problems.push(msg); }
function run(cmd, args, { live = false, env = {} } = {}) {
  const p = spawnSync(cmd, args, { cwd: REPO, env: { ...process.env, ...env }, encoding: "utf8", stdio: live ? "inherit" : "pipe", windowsHide: !live });
  if (p.error) return { ok: false, out: cmd + " を動かせません: " + p.error.message };
  return { ok: p.status === 0, out: ((p.stdout || "") + (p.stderr || "")).trim() };
}

say("競輪 締切前オッズの記録 — PC の準備");
say("リポジトリ: " + REPO);

step(1, "Git");
let r = run("git", ["--version"]);
if (!r.ok) ng("Git が見つかりません", "コマンドプロンプトに貼って入れてください:\n  winget install --id Git.Git -e\n入れたら、この setup.bat をもう一度ダブルクリック。");
else say("  ○ " + r.out);

step(2, "Node.js");
const major = parseInt(process.versions.node.split(".")[0], 10);
if (major < 18) ng("Node.js が古い(" + process.version + ")。18 以上が要ります", "winget install --id OpenJS.NodeJS.LTS -e");
else say("  ○ Node.js " + process.version);

step(3, "Git の改行の設定");
r = run("git", ["config", "--global", "core.autocrlf"]);
if (r.out === "true") ng("core.autocrlf が true です", "次を貼ってから、リポジトリを入れ直してください(競艇 v24 と同じ):\n  git config --global core.autocrlf false");
else say("  ○ core.autocrlf = " + (r.out || "(未設定)"));

step(4, "フォルダ");
if (!fs.existsSync(path.join(REPO, "snap.js")) || !fs.existsSync(path.join(REPO, ".git"))) ng("競輪のリポジトリの中ではありません: " + REPO);
else say("  ○ " + REPO);
try { fs.mkdirSync(LOGS, { recursive: true }); say("  ○ ログ置き場 " + LOGS); } catch (e) { ng("ログ置き場を作れません: " + LOGS + " (" + e.message + ")"); }

step(5, "GitHub から最新を取る");
r = run("git", ["pull", "--ff-only", "--quiet"]);
say(r.ok ? "  ○ 最新にしました" : "  ! 最新にできませんでした(このまま進みます): " + r.out.split("\n").pop());

step(6, "GitHub へ送れるか(ログイン)");
say("  記録を GitHub(odds-snap ブランチ)へ送るためのログインを確かめます。");
say("  ログインの窓が出たら、そこでログインしてください(競艇 v24 と同じトークンに keirin を足したもの)。");
r = run("git", ["fetch", "-q", "origin", "refs/heads/odds-snap"]);
if (!r.ok) ng("odds-snap ブランチを取れません(GitHub の snap.yml がまだ一度も動いていない?)", r.out.split("\n").pop());
else {
  // 実際には何も変えない送り方(--dry-run)。ログインだけ確かめる
  const p = run("git", ["push", "--dry-run", "origin", "FETCH_HEAD:refs/heads/odds-snap"], { live: true });
  if (p.ok) say("  ○ 送れます");
  else ng("GitHub へ送れません", "トークン(fine-grained)の対象に honda1986/keirin を足し、Contents を Read and write にしてください。\n" +
    "GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → いま使っているトークン → Edit\n" +
    "  → Repository access に keirin を追加 → Permissions の Contents を Read and write → Update\n" +
    "そのあと、この setup.bat をもう一度ダブルクリック。");
}

step(7, "自己テスト(外に触らない)");
r = run(process.execPath, [path.join(__dirname, "selftest.js")], { live: true });
if (!r.ok) ng("自己テストに失敗しました(上の × を見てください)");

step(8, "試し運転(送らない)");
r = run(process.execPath, [path.join(__dirname, "runner.js"), "snap", "--dry", "--log-dir", LOGS], { live: true });
if (!r.ok) ng("試し運転に失敗しました(上のログを見てください)");
else say("  ○ 試し運転できました(ログ: " + LOGS + ")");

say("\n==================================================");
if (problems.length) {
  say("  直すことが " + problems.length + " つあります:");
  for (const m of problems) say("   ・" + m);
  say("  直してから、もう一度 setup.bat をダブルクリックしてください。");
  process.exitCode = 1;
} else {
  say("  準備できました。");
  say("  次に pc\\tasks.bat を「右クリック → 管理者として実行」して、タスクを登録してください。");
}
say("==================================================");
