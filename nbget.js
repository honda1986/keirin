// ============================================================
// nbget.js — Kドリームスの過去のレース詳細から「並び予想」を競り(カッコ)付きで集める(分析用)
//
// 並び予想の HTML(div.line_position):
//   <span class="icon_p"><span class="p003">3</span><span class="p202">押え先</span></span>
//   <span class="icon_p bracket_open">(</span>
//   <span class="icon_p"><span class="p005">5</span><span class="p113">競り</span></span>
//   <span class="icon_p"><span class="p004">4</span><span class="p113">競り</span></span>
//   <span class="icon_p bracket_close">)</span>
//   <span class="icon_p space"></span>   ← ラインの切れ目
//   ( ) の中の2人が同じ位置(番手など)を競る。防府 2026-09-30 4R「3 (5 4) (6 2)」= 3の番手を5と4、3番手を6と2が競る
//   ★cardtext.js の narabiFromHtml はカッコを捨てていた(ラインが 3-5-4-6-2 の5人になっていた)
//
// 保存先: raceres ブランチの nb-YYYYMM.json(main には入れない)
//   { updatedAt, days: [...], races: { "<id>": { nb: "1|3(54)(62)|7", k: { "1": "追上", "3": "押え先", ... } } } }
//   id は pastcard・raceres と同じ「YYYYMMDD_場名_1R」
//
// 使い方: node nbget.js --month=2024-03 --out=resdir [--conc=2 --wait=250]
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const { TRACK_NAMES } = require("./bankdata.js");

const argv = process.argv.slice(2);
const opt = (k, d) => { const a = argv.find((x) => x.startsWith("--" + k + "=")); return a ? a.slice(k.length + 3) : d; };
const MONTH = opt("month", "");
const OUT = path.resolve(opt("out", "resdir"));
const CONC = Math.max(1, Math.min(6, parseInt(opt("conc", "2"), 10)));
const WAIT = Math.max(0, parseInt(opt("wait", "250"), 10));
const DEADLINE = Date.now() + 5 * 3600e3 + 20 * 60e3;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const VENUE_PIDS = [11,12,13,21,22,23,24,25,26,27,28,31,32,34,35,36,37,38,42,43,44,45,46,47,48,51,53,54,55,56,61,62,63,71,73,74,75,81,83,84,85,86,87];
const PID2NAME = {};
if (TRACK_NAMES.length !== VENUE_PIDS.length) { console.error("場名と場コードの数が合わない"); process.exit(1); }
TRACK_NAMES.forEach((n, i) => { PID2NAME[VENUE_PIDS[i]] = n; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let a = 0; ; a++) {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 25000);
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: c.signal });
      if (res.status === 429 || res.status === 503) throw Object.assign(new Error(String(res.status)), { retry: true });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    } catch (e) {
      if (a >= 3) throw e;
      await sleep((e.retry ? 5000 : 2000) * (a + 1));
    } finally { clearTimeout(t); }
  }
}
function dayIndex(html) {
  const seen = new Set(), out = [];
  for (const m of html.matchAll(/\/([a-z]+)\/racedetail\/(\d{16})\//g)) {
    const rid = m[2]; if (seen.has(rid)) continue; seen.add(rid);
    const place = PID2NAME[parseInt(rid.slice(0, 2), 10)], rno = parseInt(rid.slice(-4), 10);
    if (place && rno >= 1 && rno <= 12) out.push({ place, rno, url: `https://keirin.kdreams.jp/${m[1]}/racedetail/${rid}/` });
  }
  return out;
}
// 並び予想を「1|3(54)(62)|7」と脚質ラベルにする。並び予想が無ければ null
function parseNarabi(html) {
  const m = String(html).match(/<div[^>]*class="[^"]*line_position[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return null;
  const parts = m[1].split(/<span[^>]*\bclass\s*=\s*"([^"]*icon_p[^"]*)"[^>]*>/i);
  let s = "", open = false; const k = {};
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const cls = parts[i] || "", body = parts[i + 1] || "";
    if (/(^|\s)space(\s|$)/.test(cls)) { if (s && !s.endsWith("|")) s += "|"; continue; }
    if (/bracket_open/.test(cls)) { s += "("; open = true; continue; }
    if (/bracket_close/.test(cls)) { s += ")"; open = false; continue; }
    const txt = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const d = txt.match(/^([1-9])\s*(.*)$/);
    if (d) { s += d[1]; if (d[2]) k[d[1]] = d[2]; }
  }
  s = s.replace(/\|+$/, "");
  return /\d/.test(s) ? { nb: s, k } : null;
}

async function main() {
  if (!/^\d{4}-\d{2}$/.test(MONTH)) { console.error("--month=YYYY-MM を指定"); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, "nb-" + MONTH.replace("-", "") + ".json");
  let store = { updatedAt: null, days: [], races: {} };
  try { store = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {}
  const save = () => { store.updatedAt = new Date().toISOString(); store.days.sort(); fs.writeFileSync(file, JSON.stringify(store)); };
  const [y, m] = MONTH.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let pages = 0, fails = 0, none = 0, seri = 0, timeUp = false;
  const t0 = Date.now();
  for (let d = 1; d <= last; d++) {
    const d8 = `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
    if (store.days.includes(d8)) continue;
    if (Date.now() > DEADLINE) { timeUp = true; break; }
    let list;
    try { list = dayIndex(await get(`https://keirin.kdreams.jp/odds/${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/`)); }
    catch (e) { console.log(d8, "日別一覧が取れない:", e.message); fails++; continue; }
    list = list.filter((it) => !store.races[d8 + "_" + it.place + "_" + it.rno + "R"]);
    let i = 0, dayFail = 0;
    await Promise.all(Array.from({ length: Math.min(CONC, list.length) }, async () => {
      while (i < list.length) {
        const it = list[i++];
        try {
          const r = parseNarabi(await get(it.url));
          if (r) { store.races[d8 + "_" + it.place + "_" + it.rno + "R"] = r; pages++; if (r.nb.includes("(")) seri++; } else none++;
        } catch (e) { dayFail++; console.log("  失敗", d8, it.place, it.rno + "R", e.message); }
        await sleep(WAIT);
      }
    }));
    fails += dayFail;
    if (!dayFail) store.days.push(d8);
    save();
    console.log(d8, list.length, "R 失敗", dayFail, "| 累計", pages, "件 競りあり", seri, ((Date.now() - t0) / 1000 / Math.max(1, pages)).toFixed(2), "秒/件");
  }
  save();
  const withSeri = Object.values(store.races).filter((r) => r.nb.includes("(")).length;
  console.log(`\n${MONTH}: ${Object.keys(store.races).length}R(競りあり ${withSeri}) 並びなし ${none} 取り終えた日 ${store.days.length}/${last} 失敗 ${fails}` + (timeUp ? " 時間切れ" : ""));
}

if (require.main === module) main();

module.exports = { parseNarabi };
