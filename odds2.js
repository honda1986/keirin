// ============================================================
// odds2.js — 2車単・2車複の確定オッズを取り込む(検証用)
//
// odds.js(3連複)と同じく、楽天Kドリームスのレース詳細のオッズ画面から読む。
//   レース別 : https://keirin.kdreams.jp/{場名}/racedetail/{16桁ID}/?pageType=odds&kakeshikiType={種別}
//
// 保存先: odds2 ブランチの o2t-YYYYMM.json(2車単)/ o2f-YYYYMM.json(2車複)
//   ★main には入れない(GitHub Pages に載る main を膨らませないため。分析にしか使わない)
//   { updatedAt, races: { "<id>": { cars: 7, o: [倍率, ...] } } }
//   2車単: 1-2, 1-3, …, 1-n, 2-1, 2-3, … の順(1着→2着。n×(n-1) 個)
//   2車複: 1=2, 1=3, …, (n-1)=n の順(n×(n-1)/2 個)
//   id は history.json と同じ「YYYYMMDD_場名_1R」
//
// 使い方:
//   node odds2.js --probe 2026-09-20            … 1レースだけ取って、画面の形を見る(書き込まない)
//   node odds2.js 2026-09-20                    … その日を点検(書き込まない)
//   node odds2.js 2025-01-01 2026-09-25 --apply --out=odds2dir   … 期間を取り込む
//   オプション: --kinds=2t,2f  --conc=6 --wait=150  --all(history.json に無いレースも)
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const { TRACK_NAMES } = require("./bankdata.js");

const VENUE_PIDS = [11,12,13,21,22,23,24,25,26,27,28,31,32,34,35,36,37,38,42,43,44,45,46,47,48,51,53,54,55,56,61,62,63,71,73,74,75,81,83,84,85,86,87];
const PID2NAME = {};
if (TRACK_NAMES.length === VENUE_PIDS.length) TRACK_NAMES.forEach((n, i) => { PID2NAME[VENUE_PIDS[i]] = n; });

const argv = process.argv.slice(2);
const opt = (k, d) => { const a = argv.find((x) => x.startsWith("--" + k + "=")); return a ? a.slice(k.length + 3) : d; };
const APPLY = argv.includes("--apply");
const PROBE = argv.includes("--probe");
const ALL = argv.includes("--all");
const OUT = path.resolve(opt("out", "odds2dir"));
const KINDS = opt("kinds", "2t,2f").split(",").filter(Boolean);
const CONCURRENCY = Math.max(1, Math.min(10, parseInt(opt("conc", "6"), 10)));
const WAIT_MS = Math.max(0, parseInt(opt("wait", "150"), 10));
const DEADLINE_MS = 5 * 60 * 60 * 1000 + 20 * 60 * 1000;   // 5時間20分で打ち切り(Actions の上限6時間に余裕)
const startedAt = Date.now();
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

// 種別: Kドリームスの kakeshikiType と、組の並べ方
const KIND = {
  "2t": { param: "2shatan", label: "2車単", ordered: true },
  "2f": { param: "2shahuku", label: "2車複", ordered: false },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let a = 0; ; a++) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: ctrl.signal });
      if ((res.status === 429 || res.status === 503) && a < 2) { await sleep(3000 * (a + 1)); continue; }
      if (!res.ok) throw new Error(String(res.status));
      return await res.text();
    } catch (e) { if (a >= 2) throw e; await sleep(1500); }
    finally { clearTimeout(t); }
  }
}
async function pool(items, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) {
      if (Date.now() - startedAt > DEADLINE_MS) return;
      const idx = i++;
      try { await worker(items[idx]); } catch (e) {}
      if (WAIT_MS) await sleep(WAIT_MS);
    }
  }));
}

const toText = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&gt;/g, ">").replace(/\s+/g, " ");

// 組の並び(保存する配列の順)
function combos(kind, n) {
  const o = [];
  for (let a = 1; a <= n; a++) for (let b = 1; b <= n; b++) {
    if (a === b) continue;
    if (KIND[kind].ordered) o.push(a + "-" + b);
    else if (a < b) o.push(a + "=" + b);
  }
  return o;
}

// 「1 - 2 12.3」「1 → 2 12.3」「1 = 2 12.3」の並びを拾う。3連の「1=2=3」は拾わない
function parseOdds(kind, html) {
  const text = toText(html);
  const out = new Map();
  const sep = KIND[kind].ordered ? "(?:-|－|→|>)" : "(?:=|＝)";
  const re = new RegExp("(?<![=＝\\-－→>]\\s*)(?<![\\d.,])(\\d)\\s*" + sep + "\\s*(\\d)(?!\\s*[=＝\\-－→>]\\s*\\d)[^\\d]{0,24}?([\\d,]+(?:\\.\\d+)?)", "g");
  let m;
  while ((m = re.exec(text))) {
    const a = +m[1], b = +m[2];
    if (a === b || a < 1 || b < 1) continue;
    const v = parseFloat(m[3].replace(/,/g, ""));
    if (!isFinite(v) || v <= 0) continue;
    const key = KIND[kind].ordered ? a + "-" + b : Math.min(a, b) + "=" + Math.max(a, b);
    if (!out.has(key)) out.set(key, v);
  }
  return out;
}

function parseDayIndex(html, d8) {
  const seen = new Set(), out = [];
  const re = /\/([a-z]+)\/racedetail\/(\d{16})\//g;
  let m;
  while ((m = re.exec(html))) {
    const roma = m[1], rid = m[2];
    if (seen.has(rid)) continue; seen.add(rid);
    const place = PID2NAME[parseInt(rid.slice(0, 2), 10)], rno = parseInt(rid.slice(-4), 10);
    if (!place || !(rno >= 1 && rno <= 12)) continue;
    out.push({ rid, roma, place, rno, id: d8 + "_" + place + "_" + rno + "R" });
  }
  return out;
}
const urlOf = (r, kind) => "https://keirin.kdreams.jp/" + r.roma + "/racedetail/" + r.rid + "/?pageType=odds&kakeshikiType=" + KIND[kind].param;

function buildDates(args) {
  const a = args.filter((x) => !x.startsWith("--"));
  const out = [];
  if (a.length >= 2) {
    for (let d = new Date(a[0] + "T00:00:00Z"); d <= new Date(a[1] + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  } else if (a.length === 1) out.push(a[0]);
  else { const d = new Date(Date.now() + 9 * 3600e3 - 86400e3); out.push(d.toISOString().slice(0, 10)); }
  return out;
}

const cache = new Map();
const fileOf = (kind, d8) => path.join(OUT, "o" + kind + "-" + d8.slice(0, 6) + ".json");
function loadMonth(kind, d8) {
  const f = fileOf(kind, d8);
  if (cache.has(f)) return cache.get(f);
  let o = { updatedAt: null, races: {} };
  try { o = JSON.parse(fs.readFileSync(f, "utf8")); if (!o.races) o.races = {}; } catch (e) {}
  cache.set(f, o);
  return o;
}
function saveAll() {
  if (!APPLY) return;
  fs.mkdirSync(OUT, { recursive: true });
  for (const [f, o] of cache) { o.updatedAt = new Date().toISOString(); fs.writeFileSync(f, JSON.stringify(o)); }
}

async function probe(dH) {
  const [y, mo, dd] = dH.split("-");
  const idx = parseDayIndex(await get(`https://keirin.kdreams.jp/odds/${y}/${mo}/${dd}/`), dH.replace(/-/g, ""));
  console.log(dH, "レース", idx.length);
  const r = idx.find((x) => x.rno >= 5) || idx[0];
  if (!r) return;
  for (const kind of KINDS) {
    const html = await get(urlOf(r, kind));
    const t = toText(html);
    const map = parseOdds(kind, html);
    console.log("\n==== " + KIND[kind].label + " " + urlOf(r, kind));
    console.log("HTML長", html.length, "/ 読めた組", map.size, "/ 例", [...map].slice(0, 8).map(([k, v]) => k + ":" + v).join(" "));
    const i = t.search(/\d\s*(?:-|－|→|=|＝)\s*\d/);
    console.log("本文(最初の組のあたり): " + t.slice(Math.max(0, i - 300), i + 1500));
    const tabs = (html.match(/<table[^>]*>/g) || []).slice(0, 12);
    console.log("table タグ:", tabs.join(" "));
    const j = html.search(/オッズ/);
    console.log("HTML(オッズのあたり): " + html.slice(Math.max(0, j - 200), j + 2500).replace(/\s+/g, " "));
  }
}

(async () => {
  if (!Object.keys(PID2NAME).length) { console.log("場コードの対応表が作れません"); process.exit(1); }
  const dates = buildDates(argv);
  if (PROBE) { await probe(dates[0]); return; }
  console.log(APPLY ? "※ apply: " + OUT + " に書き込みます" : "※ 点検のみ(--apply で書き込み)", "/ 種別", KINDS.map((k) => KIND[k].label).join("・"),
    "/ 同時" + CONCURRENCY + "本・間隔" + WAIT_MS + "ms");
  let HIST = {};
  try { for (const e of JSON.parse(fs.readFileSync(path.join(__dirname, "history.json"), "utf8")).entries || []) HIST[e.id] = e; } catch (e) {}
  console.log("対象:", dates[0], "〜", dates[dates.length - 1], "(" + dates.length + "日)");
  const stat = {};
  for (const k of KINDS) stat[k] = { ok: 0, none: 0, err: 0, part: 0, vOk: 0, vNg: 0, ng: [] };
  for (const dH of dates) {
    if (Date.now() - startedAt > DEADLINE_MS) { console.log("時間切れで終了(続きは同じ期間でもう一度動かせば、取得済みを飛ばして続きから)"); break; }
    const d8 = dH.replace(/-/g, ""), [y, mo, dd] = dH.split("-");
    let idx;
    try { idx = parseDayIndex(await get(`https://keirin.kdreams.jp/odds/${y}/${mo}/${dd}/`), d8); }
    catch (e) { console.log(dH, "一覧の取得に失敗:", e.message); continue; }
    const known = Object.keys(HIST).length > 0 && !ALL;
    const jobs = [];
    for (const r of idx) {
      if (known && !HIST[r.id]) continue;
      for (const kind of KINDS) if (!loadMonth(kind, d8).races[r.id]) jobs.push({ r, kind });
    }
    if (!jobs.length) { console.log(dH, idx.length ? "すべて取得済み" : "開催なし"); continue; }
    await pool(jobs, async ({ r, kind }) => {
      const s = stat[kind];
      let html;
      try { html = await get(urlOf(r, kind)); } catch (e) { s.err++; return; }
      const map = parseOdds(kind, html);
      if (!map.size) { s.none++; return; }
      let n = 0;
      for (const k of map.keys()) for (const c of k.split(/[-=]/)) n = Math.max(n, +c);
      const order = combos(kind, n);
      const arr = order.map((k) => (map.has(k) ? map.get(k) : null));
      if (arr.some((x) => x == null)) s.part++;
      // 検算: 2車単は history.json の p2pay(払戻金)と、来た組のオッズ×100 が合うか
      const e = HIST[r.id];
      if (kind === "2t" && e && e.f && e.s && e.p2pay) {
        const v = map.get(e.f + "-" + e.s);
        if (v != null && Math.abs(v * 100 - e.p2pay) / e.p2pay <= 0.05) s.vOk++;
        else { s.vNg++; if (s.ng.length < 8) s.ng.push(r.id + " ページ" + v + " / 払戻" + e.p2pay); }
      }
      if (APPLY) loadMonth(kind, d8).races[r.id] = { cars: n, o: arr };
      s.ok++;
    });
    console.log(dH, KINDS.map((k) => KIND[k].label + " " + stat[k].ok).join(" / "), "経過" + Math.round((Date.now() - startedAt) / 1000) + "秒");
    saveAll();
  }
  console.log("\n============ 結果 ============");
  for (const k of KINDS) {
    const s = stat[k];
    console.log(KIND[k].label + ": 取得", s.ok, "/ オッズ読めず", s.none, "/ 失敗", s.err, "/ 組が欠けた", s.part,
      k === "2t" ? "/ 検算 一致" + s.vOk + " 不一致" + s.vNg : "");
    s.ng.forEach((x) => console.log("   ", x));
  }
})();
