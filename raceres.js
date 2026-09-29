// ============================================================
// raceres.js — Kドリームスのレース詳細(終わったレース)から「結果の表」を集める(分析用)
//
// 表(table.result_table)の列: 予想印 / 着順 / 車番 / 選手名 / 着差 / 上り / 決まり手 / S・B / 勝敗因
//   S = スタートを取った選手(その選手のラインが初手の前受け)、B = 最終バックを先頭で通過した選手
//   ★並び予想のラインの前後(初手でどのラインが前か)は本番で入れ替わることがある。S で本番の前受けが分かる(hikitsugi §4-16)
//
// 保存先: raceres ブランチの res-YYYYMM.json(main には入れない)
//   { updatedAt, days: ["YYYYMMDD", ...(取り終えた日)], races: { "<id>": { S, B, rows: [[着順, 車番, 決まり手, 上り, 勝敗因], ...] } } }
//   id は pastcard・history と同じ「YYYYMMDD_場名_1R」。着順は失格・落車などは文字のまま
//
// 使い方: node raceres.js --month=2024-03 --out=resdir [--conc=2 --wait=250]
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
const strip = (s) => s.replace(/<br\s*\/?>/gi, "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
// 結果の表を読む。表が無ければ null(中止・まだ結果が出ていない)
function parseResult(html) {
  const i = html.indexOf('class="result_table"');
  if (i < 0) return null;
  const tb = html.slice(i, html.indexOf("</table>", i));
  const rows = [];
  let S = null, B = null;
  for (const tr of tb.matchAll(/<tr[\s\S]*?<\/tr>/g)) {
    const td = [...tr[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]));
    if (td.length < 9) continue;
    const car = parseInt(td[2], 10);
    if (!(car >= 1 && car <= 9)) continue;
    const sb = td[7];
    if (/S/.test(sb)) S = car;
    if (/B/.test(sb)) B = car;
    const rank = /^\d+$/.test(td[1]) ? parseInt(td[1], 10) : td[1];
    rows.push([rank, car, td[6] || "", td[5] || "", td[8] || ""]);
  }
  return rows.length ? { S, B, rows } : null;
}

async function main() {
  if (!/^\d{4}-\d{2}$/.test(MONTH)) { console.error("--month=YYYY-MM を指定"); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, "res-" + MONTH.replace("-", "") + ".json");
  let store = { updatedAt: null, days: [], races: {} };
  try { store = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {}
  const save = () => { store.updatedAt = new Date().toISOString(); store.days.sort(); fs.writeFileSync(file, JSON.stringify(store)); };
  const [y, m] = MONTH.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let pages = 0, fails = 0, none = 0, timeUp = false;
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
          const r = parseResult(await get(it.url));
          if (r) { store.races[d8 + "_" + it.place + "_" + it.rno + "R"] = r; pages++; } else none++;
        } catch (e) { dayFail++; console.log("  失敗", d8, it.place, it.rno + "R", e.message); }
        await sleep(WAIT);
      }
    }));
    fails += dayFail;
    if (!dayFail) store.days.push(d8);
    save();
    console.log(d8, list.length, "R 失敗", dayFail, "| 累計", pages, "件", ((Date.now() - t0) / 1000 / Math.max(1, pages)).toFixed(2), "秒/件");
  }
  save();
  const withS = Object.values(store.races).filter((r) => r.S).length;
  console.log(`\n${MONTH}: ${Object.keys(store.races).length}R(Sあり ${withS}) 結果なし ${none} 取り終えた日 ${store.days.length}/${last} 失敗 ${fails}` + (timeUp ? " 時間切れ" : ""));
}

if (require.main === module) main();

module.exports = { parseResult };
