// ============================================================
// pastcard_probe.js — Kドリームスの過去のレース詳細ページから、並び予想と🔥が作れるかを点検する(読み取りのみ)
//
// history.json(並び・評価順位)は2025年からしか無いので、🔥の成績は2024年以前にさかのぼれない(hikitsugi §4-10)。
// 過去のページに並び予想が残っていれば、2022〜2024年の🔥も作り直せる。
//   1. 日付ごとに、並び予想が読めたレースの割合・選手数・得点が読めたか
//   2. 2025年以降の日付は history.json と突き合わせ(並び・本命・🔥の3人が同じか)
//      history の2025年〜2026年8月の並びは Gamboo 由来なので、Kドリームスの並び予想と食い違う可能性がある
//
// 使い方: node pastcard_probe.js 2022-03-15 2023-09-15 ...   (1日あたり PER 件まで。PER=0 なら全部)
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const { parseCard, predict, f3PlanFrom } = require("./engine.js");
const { T, TRACK_NAMES } = require("./bankdata.js");
const { htmlToText, withNarabiText, narabiFromHtml } = require("./cardtext.js");

const VENUE_PIDS = [11,12,13,21,22,23,24,25,26,27,28,31,32,34,35,36,37,38,42,43,44,45,46,47,48,51,53,54,55,56,61,62,63,71,73,74,75,81,83,84,85,86,87];
const PID2NAME = {};
TRACK_NAMES.forEach((n, i) => { PID2NAME[VENUE_PIDS[i]] = n; });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const PER = parseInt(process.env.PER || "40", 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let LEARN_W = null;
try { LEARN_W = JSON.parse(fs.readFileSync(path.join(__dirname, "weights.json"), "utf8")); } catch (e) {}
const H = {};
for (const e of JSON.parse(fs.readFileSync(path.join(__dirname, "history.json"), "utf8")).entries) H[e.id] = e;

async function get(url) {
  for (let a = 0; a < 3; a++) {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 25000);
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: c.signal });
      if (res.status === 429 || res.status === 503) { await sleep(3000 * (a + 1)); continue; }
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    } catch (e) { if (a === 2) throw e; await sleep(2000); } finally { clearTimeout(t); }
  }
  throw new Error("retry over");
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sortT = (t) => (t ? t.slice().sort((x, y) => x - y).join("=") : null);

(async () => {
  const dates = process.argv.slice(2);
  const all = { dates: {} };
  for (const d of dates) {
    const d8 = d.replace(/-/g, "");
    let list;
    try { list = dayIndex(await get(`https://keirin.kdreams.jp/odds/${d.slice(0, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}/`)); }
    catch (e) { console.log(d, "日別一覧が取れない:", e.message); all.dates[d] = { error: e.message }; continue; }
    if (PER > 0 && list.length > PER) { const step = list.length / PER; list = Array.from({ length: PER }, (_, i) => list[Math.floor(i * step)]); }
    const s = { races: list.length, ok: 0, narabi: 0, withScore: 0, girls: 0, hot: 0, cmp: 0, sameLines: 0, sameTop: 0, sameTrio: 0, sameHot: 0, examples: [] };
    for (const it of list) {
      try {
        const html = await get(it.url);
        const nb = narabiFromHtml(html);
        const p = parseCard(htmlToText(withNarabiText(html)), TRACK_NAMES);
        if (!p || !p.entries || p.entries.length < 5) { s.examples.push(`${it.place}${it.rno}R 選手が読めない`); continue; }
        s.ok++;
        if (nb) s.narabi++;
        if (p.entries.every((en) => en.score > 0)) s.withScore++;
        if (!p.lines || !p.lines.length) { s.girls++; continue; }
        p.place = p.place || it.place; p.raceNo = it.rno + "R";
        const r = predict(p, T[p.place], p.place, LEARN_W);
        const ranked = (r.scores || []).map((x) => x.car);
        const pl = f3PlanFrom(ranked, p.lines);
        if (pl && pl.hot) s.hot++;
        const h = H[d8 + "_" + it.place + "_" + it.rno + "R"];
        if (h && Array.isArray(h.lines) && Array.isArray(h.riders)) {
          s.cmp++;
          const hr = [...h.riders].sort((a, b) => (a[4] || 99) - (b[4] || 99)).map((x) => x[0]);
          const hp = f3PlanFrom(hr, h.lines);
          if (same(h.lines, p.lines)) s.sameLines++;
          if (hr[0] === ranked[0]) s.sameTop++;
          if (sortT(hp && hp.trio) === sortT(pl && pl.trio)) s.sameTrio++;
          if (!!(hp && hp.hot) === !!(pl && pl.hot)) s.sameHot++;
          if (!same(h.lines, p.lines) && s.examples.length < 4) s.examples.push(`${it.place}${it.rno}R 並び history=${JSON.stringify(h.lines)} kd=${JSON.stringify(p.lines)}`);
        } else if (s.examples.length < 2) s.examples.push(`${it.place}${it.rno}R 並び=${JSON.stringify(p.lines)} 本命=${ranked[0]} 🔥=${pl && pl.hot ? sortT(pl.trio) : "-"} 得点=${p.entries.map((en) => en.score).join(",")}`);
      } catch (e) { s.examples.push(`${it.place}${it.rno}R 失敗 ${e.message}`); }
      await sleep(300);
    }
    all.dates[d] = s;
    const pc = (a, b) => (b ? (100 * a / b).toFixed(0) + "%" : "-");
    console.log(`${d}: 見た${s.races}R 読めた${s.ok} 並び予想あり${pc(s.narabi, s.ok)} 全員の得点あり${pc(s.withScore, s.ok)} ガールズ等${s.girls} 🔥${s.hot}` +
      (s.cmp ? ` | history と比較${s.cmp}R 並び一致${pc(s.sameLines, s.cmp)} 本命一致${pc(s.sameTop, s.cmp)} 🔥の3人一致${pc(s.sameTrio, s.cmp)} 🔥かどうか一致${pc(s.sameHot, s.cmp)}` : ""));
    for (const x of s.examples) console.log("    " + x);
  }
  fs.writeFileSync(path.join(__dirname, "pastcard-probe.json"), JSON.stringify(all, null, 1));
})();
