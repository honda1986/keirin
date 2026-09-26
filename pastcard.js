// ============================================================
// pastcard.js — Kドリームスの過去のレース詳細ページから、出走表・並び予想・評価順位を作り直す(検証用)
//
// history.json(並び・評価順位)は2025年からしか無いので、🔥の成績は2024年以前にさかのぼれなかった。
// 過去のページにも並び予想と競走得点が残っている(2020年7月まで。pastcard_probe.js で確認・hikitsugi §4-11)。
// fetch.js と同じ読み方(parseCard → predict)で、history と同じ形の riders・lines を作る。
//   ★着順・配当は入れない(furoito・odds-*.json と結合して使う)
//   ★欠車: 並び予想には残るが出走表からは消えるので、並びから外してから予想する(外さないと predict が落ちる)
//   ★得点の変化(riders[10])はここでは null。名前・期(names)を残すので、後でこのデータ自身から計算できる
//
// 保存先: pastcard ブランチの pc-YYYYMM.json と pcraw-YYYYMM.json.gz(main には入れない)
//   pcraw は fetch.js の races.json の raw と同じ「予想に必要な部分だけのページのテキスト」{ id: text }。
//   得点の変化(前回開催からの増減 scoreDiff)を後から入れて predict をやり直すため(ここでは得点の記録が無く scoreDiff=0 で予想している)
//   { updatedAt, days: ["YYYYMMDD", ...(取り終えた日)], races: { "<id>": { place, raceNo, n, klass, lines, riders, names, trio, hot, rankSum, gap } } }
//   id は history.json と同じ「YYYYMMDD_場名_1R」。riders も history と同じ並び(fetch.js の説明参照)
//
// 使い方: node pastcard.js --month=2024-03 --out=pcdir [--conc=2 --wait=250]
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const { parseCard, predict, f3PlanFrom } = require("./engine.js");
const { T, TRACK_NAMES } = require("./bankdata.js");
const { htmlToText, withNarabiText, compactCard } = require("./cardtext.js");
const zlib = require("zlib");

const argv = process.argv.slice(2);
const opt = (k, d) => { const a = argv.find((x) => x.startsWith("--" + k + "=")); return a ? a.slice(k.length + 3) : d; };
const MONTH = opt("month", "");
if (!/^\d{4}-\d{2}$/.test(MONTH)) { console.error("--month=YYYY-MM を指定"); process.exit(1); }
const OUT = path.resolve(opt("out", "pcdir"));
const CONC = Math.max(1, Math.min(6, parseInt(opt("conc", "2"), 10)));
const WAIT = Math.max(0, parseInt(opt("wait", "250"), 10));
const DEADLINE = Date.now() + 5 * 3600e3 + 20 * 60e3;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const VENUE_PIDS = [11,12,13,21,22,23,24,25,26,27,28,31,32,34,35,36,37,38,42,43,44,45,46,47,48,51,53,54,55,56,61,62,63,71,73,74,75,81,83,84,85,86,87];
const PID2NAME = {};
if (TRACK_NAMES.length !== VENUE_PIDS.length) { console.error("場名と場コードの数が合わない"); process.exit(1); }
TRACK_NAMES.forEach((n, i) => { PID2NAME[VENUE_PIDS[i]] = n; });
let LEARN_W = null;
try { LEARN_W = JSON.parse(fs.readFileSync(path.join(__dirname, "weights.json"), "utf8")); } catch (e) {}
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

// 1レース分。fetch.js の buildEntry と同じ作り(得点の変化だけ null)
function build(html, it) {
  const text = htmlToText(withNarabiText(html));
  const p = parseCard(text, TRACK_NAMES);
  if (!p || !Array.isArray(p.entries) || p.entries.length < 5) throw new Error("選手データ不足 " + (p?.entries?.length ?? 0));
  const cars = new Set(p.entries.map((e) => e.car));
  const lines = (p.lines || []).map((l) => l.filter((c) => cars.has(c))).filter((l) => l.length);   // 欠車を外す
  p.lines = lines;
  for (const e of p.entries) if (!e.seiseki) e.seiseki = { win1: 0, win2: 0, win3: 0, out: 0 };
  p.place = p.place || it.place; p.raceNo = it.rno + "R";
  const r = predict(p, T[p.place], p.place, LEARN_W);
  const posOf = {};
  for (const l of lines) { if (l.length === 1) posOf[l[0]] = 3; else l.forEach((c, i) => { posOf[c] = Math.min(i, 2); }); }
  const rankOf = {};
  (r.scores || []).forEach((s, i) => { rankOf[s.car] = i + 1; });
  const riders = p.entries.map((en) => {
    const sc = (r.scores || []).find((x) => x.car === en.car);
    return [en.car, en.age || 0, parseInt(en.ki, 10) || 0, posOf[en.car] ?? 3, rankOf[en.car] || 9,
            Number((sc?.total || 0).toFixed(1)), en.score > 0 ? Number(en.score.toFixed(2)) : null,
            en.pref ? String(en.pref).replace(/[\s　]/g, "") : null,
            en.rate && en.rate.sanren != null ? en.rate.sanren : null,
            en.seiseki ? (en.seiseki.win1 || 0) + (en.seiseki.win2 || 0) + (en.seiseki.win3 || 0) + (en.seiseki.out || 0) : 0,
            null];
  });
  const pl = f3PlanFrom((r.scores || []).map((s) => s.car), lines);
  return {
    place: p.place, raceNo: p.raceNo, n: p.entries.length, klass: r.klass, grade: p.grade || null, lines, riders,
    names: p.entries.map((en) => (en.name || "") + "|" + String(en.ki || "").replace(/期$/, "")),
    trio: pl ? pl.trio : null, hot: !!(pl && pl.hot), rankSum: pl ? pl.rankSum ?? null : null,
    gap: r.scores && r.scores[1] ? Number((r.scores[0].total - r.scores[1].total).toFixed(1)) : null,
    raw: compactCard(text, p.place, p.raceNo),
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, "pc-" + MONTH.replace("-", "") + ".json");
  const rawFile = path.join(OUT, "pcraw-" + MONTH.replace("-", "") + ".json.gz");
  let store = { updatedAt: null, days: [], races: {} }, raws = {};
  try { store = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {}
  try { raws = JSON.parse(zlib.gunzipSync(fs.readFileSync(rawFile)).toString("utf8")); } catch (e) {}
  const save = () => {
    store.updatedAt = new Date().toISOString(); store.days.sort();
    fs.writeFileSync(file, JSON.stringify(store));
    fs.writeFileSync(rawFile, zlib.gzipSync(JSON.stringify(raws)));
  };
  const [y, m] = MONTH.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let pages = 0, fails = 0, timeUp = false;
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
          const id = d8 + "_" + it.place + "_" + it.rno + "R", e = build(await get(it.url), it);
          raws[id] = e.raw; delete e.raw; store.races[id] = e; pages++;
        }
        catch (e) { dayFail++; console.log("  失敗", d8, it.place, it.rno + "R", e.message); }
        await sleep(WAIT);
      }
    }));
    fails += dayFail;
    if (!dayFail) store.days.push(d8);          // 1件でも落ちた日は「取り終えた」にしない(次の起動で落ちた分だけ取り直す)
    save();
    console.log(d8, list.length, "R 失敗", dayFail, "| 累計", pages, "ページ", ((Date.now() - t0) / 1000 / Math.max(1, pages)).toFixed(2), "秒/ページ");
  }
  save();
  const hot = Object.values(store.races).filter((r) => r.hot).length;
  console.log(`\n${MONTH}: ${Object.keys(store.races).length}R(🔥${hot}) 取り終えた日 ${store.days.length}/${last} 失敗 ${fails}` + (timeUp ? " 時間切れ" : ""));
})();
