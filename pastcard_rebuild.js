// ============================================================
// pastcard_rebuild.js — pastcard.js で作り直した過去の出走表を、得点の記録を入れて予想し直し、furoito の着順・配当と結合する(分析用)
//
// pastcard.js は得点の記録が無いまま(scoreDiff=0)予想している。ここでは pastcard のデータ自身から
// 「名前|期 → 日付ごとの競走得点」の記録を作り、applyScoreLog(前回開催からの増減)と 得点の変化(riders[10]、期待値 v2 用)を入れ直す。
// 着順・3連複/3連単の配当は furoito/keirin-data の CSV から(★CSV はライセンス不明なのでリポジトリには入れない。手元で読むだけ)。
//
// 使い方: git fetch origin pastcard && mkdir -p /tmp/pc && git archive origin/pastcard | tar -x -C /tmp/pc
//         node pastcard_rebuild.js /tmp/pc <furoito の keirin_data ディレクトリ> /tmp/rb.json
//         node pastcard_eval.js /tmp/rb.json [odds2 のディレクトリ]
// ============================================================
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const K = __dirname, P = process.argv[2], FUR = process.argv[3], OUT = process.argv[4];
if (!P || !FUR || !OUT) { console.error("使い方: node pastcard_rebuild.js <pastcard dir> <furoito keirin_data dir> <out.json>"); process.exit(1); }
const { parseCard, predict, f3PlanFrom, applyScoreLog } = require(path.join(K, "engine.js"));
const { T, TRACK_NAMES } = require(path.join(K, "bankdata.js"));
const EV = require(path.join(K, "ev.js"));
let LEARN_W = null; try { LEARN_W = JSON.parse(fs.readFileSync(path.join(K, "weights.json"), "utf8")); } catch (e) {}
const VENUE_PIDS = [11,12,13,21,22,23,24,25,26,27,28,31,32,34,35,36,37,38,42,43,44,45,46,47,48,51,53,54,55,56,61,62,63,71,73,74,75,81,83,84,85,86,87];
const PID2NAME = {}; TRACK_NAMES.forEach((n, i) => { PID2NAME[VENUE_PIDS[i]] = n; });

// 1. 読む
const months = fs.readdirSync(P).filter((f) => /^pc-\d{6}\.json$/.test(f)).map((f) => f.slice(3, 9)).sort();
const races = {}, raws = {};
for (const ym of months) {
  Object.assign(races, JSON.parse(fs.readFileSync(path.join(P, "pc-" + ym + ".json"), "utf8")).races);
  try { Object.assign(raws, JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(P, "pcraw-" + ym + ".json.gz"))).toString("utf8"))); } catch (e) {}
}
console.log("月", months.length, months[0], "〜", months[months.length - 1], "レース", Object.keys(races).length, "テキスト", Object.keys(raws).length);

// 2. 得点の記録(scores.json と同じ形 riders[名前|期] = [[YYYYMMDD, 得点], ...])
const log = { riders: {} };
for (const id of Object.keys(races).sort()) {
  const r = races[id], d8 = id.slice(0, 8);
  r.names.forEach((nk, i) => {
    const sc = r.riders[i] && r.riders[i][6];
    if (!(sc > 0) || !nk || nk.startsWith("|")) return;
    const a = (log.riders[nk] = log.riders[nk] || []);
    if (!a.length || a[a.length - 1][0] !== d8) a.push([d8, sc]);
  });
}
for (const k in log.riders) log.riders[k].sort((a, b) => (a[0] < b[0] ? -1 : 1));

// 3. 予想し直す(pastcard.js の build と同じ + applyScoreLog + 得点の変化)
function repredict(id, raw) {
  const p = parseCard(raw, TRACK_NAMES);
  if (!p || !p.entries || p.entries.length < 5) return null;
  const cars = new Set(p.entries.map((e) => e.car));
  p.lines = (p.lines || []).map((l) => l.filter((c) => cars.has(c))).filter((l) => l.length);
  for (const e of p.entries) if (!e.seiseki) e.seiseki = { win1: 0, win2: 0, win3: 0, out: 0 };
  const d8 = id.slice(0, 8);
  if (!/\d{4}年\d{1,2}月\d{1,2}日/.test(String(p.date || ""))) p.date = `${d8.slice(0, 4)}年${+d8.slice(4, 6)}月${+d8.slice(6, 8)}日`;
  applyScoreLog(p, log);
  const place = id.split("_")[1];
  p.place = p.place || place; p.raceNo = id.split("_")[2];
  const r = predict(p, T[p.place], p.place, LEARN_W);
  const posOf = {}; for (const l of p.lines) { if (l.length === 1) posOf[l[0]] = 3; else l.forEach((c, i) => { posOf[c] = Math.min(i, 2); }); }
  const rankOf = {}; (r.scores || []).forEach((s, i) => { rankOf[s.car] = i + 1; });
  const riders = p.entries.map((en) => {
    const sc = (r.scores || []).find((x) => x.car === en.car);
    const nk = (en.name || "") + "|" + String(en.ki || "").replace(/期$/, "");
    return [en.car, en.age || 0, parseInt(en.ki, 10) || 0, posOf[en.car] ?? 3, rankOf[en.car] || 9,
            Number((sc?.total || 0).toFixed(1)), en.score > 0 ? Number(en.score.toFixed(2)) : null,
            en.pref ? String(en.pref).replace(/[\s　]/g, "") : null,
            en.rate && en.rate.sanren != null ? en.rate.sanren : null,
            en.seiseki ? (en.seiseki.win1 || 0) + (en.seiseki.win2 || 0) + (en.seiseki.win3 || 0) + (en.seiseki.out || 0) : 0,
            EV.scoreChange(log.riders[nk], d8, en.score)];
  });
  const ranked = (r.scores || []).map((s) => s.car);
  const pl = f3PlanFrom(ranked, p.lines);
  return { n: p.entries.length, lines: p.lines, riders, ranked, trio: pl && pl.trio, hot: !!(pl && pl.hot), rankSum: pl && pl.rankSum };
}

// 4. furoito の着順・配当(★引用符の中にカンマがある列があるので、ちゃんと CSV として読む)
function csvRows(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n") { row.push(f.replace(/\r$/, "")); rows.push(row); row = []; f = ""; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const res = {};
const yms = new Set(months);
for (const ym of yms) {
  const f = path.join(FUR, ym.slice(0, 4) + "_" + ym.slice(4, 6) + "_keirin.csv");
  if (!fs.existsSync(f)) continue;
  const lines = csvRows(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
  const hd = lines[0], ix = (k) => hd.indexOf(k);
  const iR = ix("race_id"), iN = ix("race_no"), iB = ix("banum"), iK = ix("rank"), iF = ix("san_ren_fuku"), iT = ix("san_ren_tan");
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i]; if (c.length < hd.length) continue;
    const rid = c[iR]; if (!rid || rid.length < 12) continue;
    const place = PID2NAME[parseInt(rid.slice(0, 2), 10)]; if (!place) continue;
    const dt = new Date(Date.UTC(+rid.slice(2, 6), +rid.slice(6, 8) - 1, +rid.slice(8, 10)) + (parseInt(rid.slice(10, 12), 10) - 1) * 86400000);
    const d8 = dt.toISOString().slice(0, 10).replace(/-/g, "");
    const id = d8 + "_" + place + "_" + parseInt(c[iN], 10) + "R";
    const o = (res[id] = res[id] || { fin: {}, p3f: null, p3t: null });
    const rk = parseInt(c[iK], 10); if (rk >= 1 && rk <= 3) o.fin[rk] = parseInt(c[iB], 10);
    const pm = String(c[iF] || "").match(/(\d+)=(\d+)=(\d+)\s+([\d,]+)円/); if (pm) o.p3f = [[+pm[1], +pm[2], +pm[3]].sort((a, b) => a - b).join("="), +pm[4].replace(/,/g, "")];
    const pt = String(c[iT] || "").match(/(\d+)-(\d+)-(\d+)\s+([\d,]+)円/); if (pt) o.p3t = [`${pt[1]}-${pt[2]}-${pt[3]}`, +pt[4].replace(/,/g, "")];
  }
}

// 4b. furoito に着順が無いレース(2026年5月以降は大半が空欄)は history.json の着順・3連複配当で補う
try {
  for (const e of JSON.parse(fs.readFileSync(path.join(K, "history.json"), "utf8")).entries) {
    if (!e.f || !e.s || !e.t) continue;
    const o = res[e.id];
    if (o && o.fin[1] && o.fin[2] && o.fin[3]) continue;
    const t = [e.f, e.s, e.t].sort((a, b) => a - b).join("=");
    res[e.id] = { fin: { 1: e.f, 2: e.s, 3: e.t }, p3f: e.p3fpay != null ? [t, e.p3fpay] : null, p3t: null };
  }
} catch (e) { console.log("history.json を読めず:", e.message); }

// 5. まとめる
const out = {};
let n = 0, ok = 0, withRes = 0, err = 0;
for (const id of Object.keys(races).sort()) {
  n++;
  const raw = raws[id]; if (!raw) continue;
  let r; try { r = repredict(id, raw); } catch (e) { err++; continue; }
  if (!r) continue; ok++;
  const x = res[id];
  const fin = x && x.fin[1] && x.fin[2] && x.fin[3] ? [x.fin[1], x.fin[2], x.fin[3]] : null;
  if (fin) withRes++;
  out[id] = { ...r, fin, p3f: x && x.p3f, p3t: x && x.p3t, hot0: races[id].hot, trio0: races[id].trio };
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log("レース", n, "予想し直し", ok, "失敗", err, "着順あり", withRes);
