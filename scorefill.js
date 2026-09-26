// ============================================================
// scorefill.js — 過去の出走表(Kドリームスのレース詳細ページ)から競走得点を読んで、scores.json の記録を埋める
//
// scores.json は 2026-08-28(取得元を Kドリームスに替えた日)からしか貯まっていない。期待値 v2 の
// 「得点の変化(今の得点 − 90日以上前の得点)」は90日分の記録が無いと出ない(11月末まで待つことになる)。
// 過去のレースのページには、その当時の得点が残っている(2026-06-10・2025-06-10 で furoito と全員一致を確認)。
// それを読んで記録を埋める。predict の scoreDiff(前回開催からの増減)もこの記録を使うので、そちらも正しくなる。
//
// 使い方:
//   node scorefill.js --from 2026-05-01 --to 2026-08-27            … 点検だけ(集めて件数を出す)
//   node scorefill.js --from 2026-05-01 --to 2026-08-27 --apply    … 集めて scores.json に足す
//   node scorefill.js --merge scorefill-out.json                    … 集めた分を scores.json に足すだけ(ワークフローの push 競合のやり直し用)
//   オプション: --conc=4 --wait=250
//
// ・集めた分は scorefill-out.json にも書く(push がぶつかったら、取り直した scores.json に足し直すため)
// ・既にある日の記録は足さない(同じ選手・同じ日は1件)。得点0(デビュー直後)は記録しない(scorelog.js と同じ)
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const { parseCard } = require("./engine.js");
const { TRACK_NAMES } = require("./bankdata.js");
const { htmlToText, withNarabiText } = require("./cardtext.js");
const SL = require("./scorelog.js");

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : null; };
const num = (k, d) => { const a = argv.find((x) => x.startsWith("--" + k + "=")); return a ? parseInt(a.split("=")[1], 10) : d; };
const APPLY = argv.includes("--apply");
const OUT = path.join(__dirname, "scorefill-out.json");
const CONC = Math.max(1, Math.min(6, num("conc", 4)));
const WAIT = Math.max(0, num("wait", 250));
const DEADLINE = Date.now() + 5 * 3600e3;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let a = 0; a < 3; a++) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 25000);
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: ctrl.signal });
      if (r.status === 429 || r.status === 503) { await sleep(3000 * (a + 1)); continue; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.text();
    } catch (e) { if (a === 2) throw e; await sleep(1500); }
    finally { clearTimeout(t); }
  }
  throw new Error("取れず");
}

// 集めた記録 { "<名前>|<期>": [["YYYYMMDD", 得点], ...] } を scores.json に足す
function mergeInto(store, rec) {
  let added = 0;
  for (const [key, list] of Object.entries(rec)) {
    const log = store.riders[key] || (store.riders[key] = []);
    for (const [d, sc] of list) { if (log.some((r) => r[0] === d)) continue; log.push([d, sc]); added++; }
  }
  SL.finalize(store);
  return added;
}

async function main() {
  const mergeFile = opt("merge");
  if (mergeFile) {
    const rec = JSON.parse(fs.readFileSync(mergeFile, "utf8"));
    const store = SL.load();
    const n = mergeInto(store, rec);
    fs.writeFileSync(SL.SCORES, JSON.stringify(store));
    console.log("scores.json に足した:", n, "件 / 選手", Object.keys(store.riders).length, "人 / 日付", store.dates[0], "〜", store.dates[store.dates.length - 1]);
    return;
  }
  const from = opt("from"), to = opt("to");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "")) { console.log("使い方: node scorefill.js --from YYYY-MM-DD --to YYYY-MM-DD [--apply]"); process.exit(1); }
  const rec = {};
  let races = 0, fail = 0, riders = 0;
  for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += 86400e3) {
    if (Date.now() > DEADLINE) { console.log("時間切れ(ここまでの分を保存する)"); break; }
    const d = new Date(t).toISOString().slice(0, 10), d8 = d.replace(/-/g, "");
    let idx;
    try { idx = await get(`https://keirin.kdreams.jp/odds/${d.slice(0, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}/`); }
    catch (e) { console.log(d, "一覧を取れず:", e.message); continue; }
    const urls = [], seen = new Set();
    for (const m of idx.matchAll(/\/([a-z]+)\/racedetail\/(\d{16})\//g)) if (!seen.has(m[2])) { seen.add(m[2]); urls.push(`https://keirin.kdreams.jp/${m[1]}/racedetail/${m[2]}/`); }
    let i = 0, ok = 0;
    await Promise.all(Array.from({ length: Math.min(CONC, urls.length) }, async () => {
      while (i < urls.length) {
        const u = urls[i++];
        try {
          const p = parseCard(htmlToText(withNarabiText(await get(u))), TRACK_NAMES);
          for (const e of p.entries) {
            if (!e.name || !e.ki || !(e.score > 0)) continue;
            const key = e.name + "|" + String(e.ki).replace(/期$/, "");
            const list = rec[key] || (rec[key] = []);
            if (!list.some((r) => r[0] === d8)) { list.push([d8, e.score]); riders++; }
          }
          ok++;
        } catch (e) { fail++; }
        if (WAIT) await sleep(WAIT);
      }
    }));
    races += ok;
    console.log(d, "出走表", ok + "/" + urls.length, "レース");
    fs.writeFileSync(OUT, JSON.stringify(rec));       // 途中で止まっても、ここまでの分は残す
  }
  console.log("\n集めた: レース", races, "/ 選手×日", riders, "/ 読めなかった", fail, "→", OUT);
  if (!APPLY) { console.log("点検のみ(--apply で scores.json に足す)"); return; }
  const store = SL.load();
  const n = mergeInto(store, rec);
  fs.writeFileSync(SL.SCORES, JSON.stringify(store));
  console.log("scores.json に足した:", n, "件 / 選手", Object.keys(store.riders).length, "人");
}
main().catch((e) => { console.error(e); process.exit(1); });
