#!/usr/bin/env node
// ============================================================
// betplan.js — 今日の🔥とモデルDについて「いま買いか」をアプリと同じ判定で出す(自動投票 bet/ が読む)
//
//   node betplan.js                  … JSON を1つ標準出力に出す
//   node betplan.js --pretty         … 人が読む形で並べる
//   オプション(テスト用): --now=2026-09-26T10:15:00+09:00 --races=file --snaps=file.jsonl --live=latest.json --no-remote
//
// ★判定はアプリ(index.html の evInfo)と同じ:
//     🔥(races.json の plan.hot)・3連複1点 plan.ticket
//     期待値 = ev.js(アプリと同じ式。node evcheck.js で突き合わせ済み)
//     7車立て(needOdds)は、その倍率が帯(bandLo〜bandHi)の中のときだけ
//     verdict: buy(買い) / skipEv(期待値1未満) / skipBand(帯の外) / thin(票が薄い) / noOdds(倍率なし) / noDelta(選手データ不足)
//     ev(期待値)・inBand(帯の中か)も返す。実際に買うかは bet/ の hot9_mode / hot7_mode(両方・期待値だけ・帯だけ・どちらか・全部・買わない)で決める
//   ★買い目を作り直さない。plan は fetch.js(engine.js の f3PlanFrom)が書いたものをそのまま使う
//   ★2026-09-27 の見直し(hikitsugi §4-12):
//     ・🔥の9車立て(8車以上)も帯 5〜15倍の中だけ(needOdds を立てて返す。5年とも100%超えだったのはここだけ)
//     ・🔥の7車立ては5年とも100%未満。判定はそのまま出すが、買うかは bet/ の buy_7car_hot(既定 false)で決める
//     ・モデルD(evd.js): 全レースの3連複全組から「期待値1.05以上・20倍以下」の組を全部(ふつう1点)。kind:"D"・tickets に全部、ticket は1点目
//       verdict: buy / none(該当なし) / thin(票が薄い) / noOdds / noDelta。🔥と同じ組なら sameAsHot:true
//
// ★倍率の取り方(新しいほうを使う)
//   1. 手元の snapwork/YYYYMMDD.jsonl(PC の snap.js が3分おきに書く)
//   2. odds-live ブランチの latest.json を git fetch で(PC が止まって GitHub の snap.yml が記録しているとき)
//      ・API は使わない(未ログインは1時間60回まで。アプリと取り合いになる)
//      ・手元に新しい倍率が無い🔥が締切20分以内にあるときだけ、40秒に1回まで
//      ・★FETCH_HEAD を書かない(--no-write-fetch-head)。pc/runner.js が「fetch main → merge FETCH_HEAD」を
//        しているので、その間に odds-live で FETCH_HEAD を上書きすると別の枝を取り込もうとする。取り置きは refs/betplan/*
//        --refmap= で origin/* も触らない(runner の fetch と同じ ref を取り合わない)
// ★出走表は races.json → snapwork/races-local.json → GitHub の main の races.json(10分に1回まで)の順で、今日の分を使う
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const EV = require("./ev.js");
const EVD = require("./evd.js");
const HOT9_BAND = [5, 15];         // 🔥の9車立ての帯(2026-09-27〜)

const argv = process.argv.slice(2);
const arg = (k) => { const a = argv.find((x) => x.startsWith("--" + k + "=")); return a ? a.slice(k.length + 3) : null; };
const has = (k) => argv.includes("--" + k);
const DIR = __dirname;
const WORK = path.join(DIR, "snapwork");
const CLOSE_BEFORE_START = 5;      // 締切 = 発走の5分前(アプリと同じ)
const REMOTE_ODDS_EVERY = 40e3;
const REMOTE_RACES_EVERY = 600e3;
const FRESH_MIN = 4;               // 手元の倍率がこれより古ければ GitHub 側も見る
const GIT_ENV = { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_ASKPASS: "", SSH_ASKPASS: "" };

// JST の時刻まわり。now は Date(絶対時刻)
const jst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString();   // "YYYY-MM-DDTHH:MM:SS.sssZ" の形で JST の数字
const day8Of = (d) => jst(d).slice(0, 10).replace(/-/g, "");
function jstDate(d8, hhmmss) {   // "20260926" と "14:03:12.345" → Date
  const m = String(hhmmss || "").match(/^(\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?/);
  if (!/^\d{8}$/.test(d8 || "") || !m) return null;
  return new Date(Date.UTC(+d8.slice(0, 4), +d8.slice(4, 6) - 1, +d8.slice(6, 8), +m[1] - 9, +m[2], +(m[3] || 0), Math.round(parseFloat(m[4] || 0) * 1000)));
}
function raceDay8(r) {
  const m = String((r && r.date) || "").match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  return m ? m[1] + m[2].padStart(2, "0") + m[3].padStart(2, "0") : null;
}
function git(args) {
  const p = spawnSync("git", args, { cwd: DIR, env: { ...process.env, ...GIT_ENV }, encoding: "utf8", timeout: 40000, windowsHide: true, maxBuffer: 64 << 20 });
  return { ok: !p.error && p.status === 0, out: p.stdout || "", err: (p.error ? p.error.message : p.stderr || "").trim() };
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; } };
const writeJson = (f, o) => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o)); } catch (e) {} };

// ---- 出走表 ----
function loadRaces(today, notes) {
  if (arg("races")) { const j = readJson(arg("races")); return { races: (j && j.races) || [], from: arg("races") }; }
  for (const [f, name] of [[path.join(DIR, "races.json"), "races.json"], [path.join(WORK, "races-local.json"), "races-local.json"]]) {
    const j = readJson(f);
    if (j && Array.isArray(j.races) && j.races.some((r) => raceDay8(r) === today)) return { races: j.races, from: name };
  }
  // 手元に今日の分が無い(PC の取り込みが止まっている)→ GitHub の main から取る。10分に1回まで
  const cache = path.join(WORK, "betplan-races.json");
  const st = readJson(path.join(WORK, "betplan-state.json")) || {};
  let j = readJson(cache);
  if (!has("no-remote") && !(j && j.races && j.races.some((r) => raceDay8(r) === today)) && Date.now() - (st.racesAt || 0) > REMOTE_RACES_EVERY) {
    st.racesAt = Date.now(); writeJson(path.join(WORK, "betplan-state.json"), st);
    const f = git(["fetch", "-q", "--no-write-fetch-head", "--refmap=", "origin", "+refs/heads/main:refs/betplan/main"]);
    const s = f.ok && git(["show", "refs/betplan/main:races.json"]);
    if (s && s.ok) { try { j = JSON.parse(s.out); writeJson(cache, j); } catch (e) {} }
    else notes.push("GitHub から races.json を取れず: " + ((s || f).err || "").split("\n").pop());
  }
  if (j && Array.isArray(j.races) && j.races.some((r) => raceDay8(r) === today)) return { races: j.races, from: "GitHub main" };
  return { races: [], from: "なし(今日の出走表がまだ無い)" };
}

// ---- 倍率(レースごとにいちばん新しい記録) ----
function localSnaps(today) {
  const f = arg("snaps") || path.join(WORK, today + ".jsonl");
  const out = {};
  let txt = "";
  try { txt = fs.readFileSync(f, "utf8"); } catch (e) { return out; }
  for (const l of txt.split("\n")) {
    if (!l.trim()) continue;
    let r; try { r = JSON.parse(l); } catch (e) { continue; }
    if (!r.k || !Array.isArray(r.o)) continue;
    const old = out[r.k];
    if (!old || r.t > old.t) out[r.k] = { t: r.t, left: r.left, upd: r.upd, n: r.n, o: r.o, src: "PC" };
  }
  return out;
}
function remoteSnaps(today, notes) {
  if (arg("live")) { const j = readJson(arg("live")); return j && j.date === today ? j : null; }
  if (has("no-remote")) return null;
  const cache = path.join(WORK, "betplan-live.json");
  const stf = path.join(WORK, "betplan-state.json");
  const st = readJson(stf) || {};
  if (Date.now() - (st.liveAt || 0) >= REMOTE_ODDS_EVERY) {
    st.liveAt = Date.now(); writeJson(stf, st);
    const f = git(["fetch", "-q", "--no-write-fetch-head", "--refmap=", "origin", "+refs/heads/odds-live:refs/betplan/odds-live"]);
    const s = f.ok && git(["show", "refs/betplan/odds-live:latest.json"]);
    if (s && s.ok) { try { writeJson(cache, JSON.parse(s.out)); } catch (e) {} }
    else notes.push("odds-live を取れず: " + ((s || f).err || "").split("\n").pop());
  }
  const j = readJson(cache);
  return j && j.date === today ? j : null;
}

// ---- 1レースの判定(index.html の evOfRow / evInfo と同じ) ----
// モデルD: そのレースの買う組(全部)
function judgeD(r, snap) {
  if (!snap || !Array.isArray(snap.o)) return { verdict: "noOdds" };
  const n = snap.n || (r.riders || []).length;
  if (!Array.isArray(r.riders) || r.riders.length !== n) return { verdict: "noOdds", why: "車立てが合わない" };
  if (r.riders.some((x) => !x[7])) return { verdict: "noDelta" };
  const all = EVD.evAll(r.riders, r.lines, r.place, snap.o, n, r.seri);
  if (!all) return { verdict: "thin" };
  // 買うのは条件(期待値≥1.05・20倍以下)を満たす組を全部(期待値の高い順)。ticket・ev・odds は1点目
  const ps = EVD.picks(all);
  if (!ps.length) {
    const best = all.reduce((a, b) => (b.ev > (a ? a.ev : -1) ? b : a), null);
    return { verdict: "none", bestEv: best ? Math.round(best.ev * 1000) / 1000 : null };
  }
  const tickets = ps.map((p) => ({ ticket: p.ticket, ev: Math.round(p.ev * 1000) / 1000, odds: p.odds }));
  return { verdict: "buy", ticket: tickets[0].ticket, ev: tickets[0].ev, odds: tickets[0].odds, tickets };
}

function judge(plan, delta, snap) {
  if (!snap || !Array.isArray(snap.o)) return { verdict: "noOdds" };
  const n = snap.n || plan.cars;
  const cs = EV.trioCombos(n);
  if (cs.length !== snap.o.length) return { verdict: "noOdds", why: "組の数が合わない" };
  const i = cs.findIndex((c) => c.join("=") === plan.ticket);
  const v = i >= 0 ? snap.o[i] : null;
  const odds = v > 0 && v < 9999 ? v : null;
  // inBand(帯の中か)は期待値が出せないときも返す。bet/ が 9車・7車ごとの買い方(帯だけ・期待値だけ・どちらか…)で使う
  const inBand = plan.needOdds ? odds != null && odds >= plan.bandLo && odds <= plan.bandHi : true;
  if (!delta) return { verdict: "noDelta", odds, inBand };
  const ev = EV.evOf(delta, plan.ticket, snap.o, n);
  if (ev == null) return { verdict: "thin", odds, inBand };
  return { verdict: !inBand ? "skipBand" : ev >= 1 ? "buy" : "skipEv", ev: Math.round(ev * 1000) / 1000, odds, inBand };
}

function main() {
  const now = arg("now") ? new Date(arg("now")) : new Date();
  const today = day8Of(now);
  const notes = [];
  const { races, from } = loadRaces(today, notes);
  const hot = races.filter((r) => r.plan && r.plan.hot && raceDay8(r) === today && r.plan.ticket);

  const local = localSnaps(today);
  const ageMin = (s) => { const d = s && jstDate(today, s.t); return d ? (now - d) / 60000 : null; };
  const closeOf = (r) => { const s = jstDate(today, r.startTime); return s ? new Date(s.getTime() - CLOSE_BEFORE_START * 60000) : null; };
  // 締切20分以内なのに手元の倍率が新しくないレースがあるときだけ GitHub(odds-live)も見る(モデルDは全レースを見るので全レース)
  // (全レースを見るのは締切6分前から。PC が動いていればその間は手元に1分おきの記録があるので、ふだんは取りに行かない)
  const needRemote = races.filter((r) => raceDay8(r) === today).some((r) => {
    const c = closeOf(r); if (!c) return false;
    const m = (c - now) / 60000, a = ageMin(local[r.key]);
    const near = r.plan && r.plan.hot ? 20 : 6;
    return m >= -1 && m <= near && (a == null || a > FRESH_MIN);
  });
  const remote = needRemote || arg("live") ? remoteSnaps(today, notes) : null;
  let oddsFrom = Object.keys(local).length ? "手元" : "";
  if (remote) oddsFrom += (oddsFrom ? "+" : "") + "odds-live(" + (remote.source || "?") + ")";

  const snapOf = (r) => {
    let s = local[r.key] || null;
    const rs = remote && remote.races && remote.races[r.key];
    if (rs && (!s || rs.t > s.t)) s = { ...rs, src: "odds-live" };
    return s;
  };
  const base = (r, c, s) => ({
    key: r.key, date: today, place: r.place, rno: parseInt(r.raceNo, 10) || null, raceNo: r.raceNo,
    startTime: r.startTime, close: c ? jst(c).slice(11, 16) : null,
    minutesToClose: c ? Math.round((c - now) / 6000) / 10 : null,
    snap: s ? { t: s.t, left: s.left, age: Math.round(ageMin(s) * 10) / 10, src: s.src } : null,
  });
  const hotOut = hot.map((r) => {
    const p = { ...r.plan }, c = closeOf(r), s = snapOf(r);
    if (p.cars >= 8) { p.needOdds = true; p.bandLo = HOT9_BAND[0]; p.bandHi = HOT9_BAND[1]; }
    const delta = EV.deltaFromRiders(r.riders, r.lines, r.place);
    const j = judge(p, delta, s);
    return { kind: "hot", ...base(r, c, s), cars: p.cars, ticket: p.ticket, needOdds: !!p.needOdds, bandLo: p.bandLo, bandHi: p.bandHi, ...j };
  });
  const hotTicket = {};
  for (const x of hotOut) hotTicket[x.key] = x.ticket;
  // モデルD: 締切20分以内(と締切直後)のレースだけ計算する(全レースを毎回計算しない)
  const dOut = [];
  for (const r of races) {
    if (raceDay8(r) !== today || !Array.isArray(r.riders) || r.riders.length < 5) continue;
    const c = closeOf(r);
    const m = c ? (c - now) / 60000 : null;
    if (m == null || m < -30 || m > 20) continue;
    const s = snapOf(r);
    const j = judgeD(r, s);
    dOut.push({ kind: "D", ...base(r, c, s), cars: r.riders.length, needOdds: false, bandLo: EVD.PICK.oddsLo, bandHi: EVD.PICK.oddsHi,
      ...j, ticket: j.ticket || null, sameAsHot: !!(j.ticket && hotTicket[r.key] === j.ticket),
      tickets: (j.tickets || []).map((t) => ({ ...t, sameAsHot: hotTicket[r.key] === t.ticket })) });
  }
  const out = hotOut.concat(dOut).sort((a, b) => (a.minutesToClose ?? 9e9) - (b.minutesToClose ?? 9e9));

  const res = { now: now.toISOString(), date: today, racesFrom: from, oddsFrom: oddsFrom || "なし", notes, races: out };
  if (!has("pretty")) { process.stdout.write(JSON.stringify(res) + "\n"); return; }
  console.log(`${today} 出走表:${from} 倍率:${res.oddsFrom}  🔥${hotOut.length} / モデルD(締切20分以内)${dOut.length}`);
  for (const n of notes) console.log("  (" + n + ")");
  for (const x of out) {
    if (x.kind === "D" && x.verdict !== "buy") continue;
    const tk = x.kind === "D" && x.tickets && x.tickets.length > 1
      ? x.tickets.map((t) => `${t.ticket}(期待値${t.ev.toFixed(2)} ${t.odds}倍)`).join(" ") + ` ${x.cars}車 ${x.verdict}`
      : `${x.ticket} ${x.cars}車 ${x.verdict}${x.ev != null ? " 期待値" + x.ev.toFixed(2) : ""}${x.odds != null ? " " + x.odds + "倍" : ""}`;
    console.log(`  ${x.kind === "D" ? "Ⓓ" : "🔥"} 締切${x.close}(あと${x.minutesToClose}分) ${x.key.padEnd(8, "　")} ${tk}` +
      (x.snap ? ` [倍率 締切${x.snap.left}分前・${x.snap.age}分前に取得・${x.snap.src}]` : ""));
  }
}

if (require.main === module) main();
module.exports = { judge, judgeD, jstDate, raceDay8 };
