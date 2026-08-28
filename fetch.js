// ============================================================
// fetch.js — 本日の全レースを取得して races.json に書き出す
//
// 【2026-08-28 取得元を変更】
//   Gamboo は AWS WAF のボット判定(JavaScript必須のチャレンジ)が入り、
//   プログラムからは一切取得できなくなった(全URLで HTTP 202 / server:awselb)。
//   そのため楽天Kドリームスへ切り替えた。odds.js と同じ経路・同じ作りにしてある。
//
//   日別一覧: https://keirin.kdreams.jp/odds/YYYY/MM/DD/   ← 1回でその日の全レースURLが取れる
//   レース  : https://keirin.kdreams.jp/{場名}/racedetail/{16桁ID}/
//
//   ページには出走表・競走得点・着度数・連対率・ギヤ・脚質・並び予想が
//   すべて最初から入っているので、1レース1リクエストで足りる。
//   ただし「前得点」だけは無い(得点差の補正が効かない)。
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const { parseCard, predict, sujiExpect } = require("./engine.js");
const { T, TRACK_NAMES } = require("./bankdata.js");

let LEARN_W = null;
try { LEARN_W = JSON.parse(fs.readFileSync(path.join(__dirname, "weights.json"), "utf8"));
  console.log("学習補正を適用:", LEARN_W.updatedAt || "(日付なし)"); } catch { console.log("学習補正なし"); }

const VENUE_PIDS = [11,12,13,21,22,23,24,25,26,27,28,31,32,34,35,36,37,38,42,43,44,45,46,47,48,51,53,54,55,56,61,62,63,71,73,74,75,81,83,84,85,86,87];
const PID2NAME = {};
if (TRACK_NAMES.length === VENUE_PIDS.length) TRACK_NAMES.forEach((n, i) => { PID2NAME[VENUE_PIDS[i]] = n; });

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CONCURRENCY = 4;
const WAIT_MS = 250;
const FETCH_TIMEOUT = 25000;
const MAX_RETRY = 2;
const DEADLINE_MS = 40 * 60 * 1000;      // 40分で打ち切り(通常は数分で終わる)
const startedAt = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getOnce(url) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: c.signal });
    if (res.status === 429 || res.status === 503) { const e = new Error(String(res.status)); e.retryable = true; throw e; }
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally { clearTimeout(t); }
}
async function get(url) {
  for (let a = 0; ; a++) {
    try { return await getOnce(url); }
    catch (e) { if (e.retryable && a < MAX_RETRY) { await sleep(2500 * (a + 1)); continue; } throw e; }
  }
}
async function pool(items, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) {
      if (Date.now() - startedAt > DEADLINE_MS) return;
      const idx = i++;
      try { await worker(items[idx]); } catch (e) { console.error("  取得失敗:", items[idx].place, items[idx].raceNo, e.message); }
      await sleep(WAIT_MS);
    }
  }));
}

// ---- HTML → テキスト ----
function htmlToText(html) {
  let s = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<img\b[^>]*\balt\s*=\s*["']([^"']*)["'][^>]*>/gi, (_, a) => {
    const v = a.replace(/\s+/g, " ").trim(); return /^[1-9]$/.test(v) ? v : " "; });
  s = s.replace(/<(br|\/tr|\/td|\/th|\/p|\/div|\/li|\/h[1-6]|\/option|\/a|\/span)\b[^>]*>/gi, "\n")
       .replace(/<[^>]+>/g, " ")
       .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
       .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return " "; } });
  // 空白は2個までは残す。並び予想は「空白2個」でラインを区切っているので、
  // 1個につぶすと 1 7 4  8 2  5 6 3 → 1 7 4 8 2 5 6 3 になり並びが消える。
  return s.replace(/\u00a0/g, " ").replace(/\t/g, " ").replace(/ {2,}/g, "  ");
}

// ---- 並び予想は「色付きの番号チップ」で書かれている ----
//   <div class="line_position">
//     <span class="icon_p"><span class="p001">1</span><span class="p201">先行</span></span>
//     <span class="icon_p"><span class="p007">7</span><span class="p105">追込</span></span>
//     <span class="icon_p space"></span>          ← ★ラインの切れ目(中身が空)
//     <span class="icon_p"><span class="p008">8</span><span class="p202">押え先</span></span>
//     ...
//   </div>
// 普通にタグを消すと空の span が消えて区切りが失われるので、
// HTML→テキストに渡す前に「← 1 7 4・8 2・5 6 3」という1行に置き換えておく。
function narabiFromHtml(html) {
  const m = String(html).match(/<div[^>]*class="[^"]*line_position[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return null;
  const parts = m[1].split(/<span[^>]*\bclass\s*=\s*"([^"]*icon_p[^"]*)"[^>]*>/i);
  const groups = []; let cur = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const cls = parts[i] || "", body = parts[i + 1] || "";
    if (/(^|[\s])space([\s]|$)/.test(cls)) { if (cur.length) { groups.push(cur); cur = []; } continue; }
    const d = body.replace(/<[^>]+>/g, " ").match(/[1-9]/);
    if (d) cur.push(d[0]);
  }
  if (cur.length) groups.push(cur);
  if (!groups.length) return null;
  return "← " + groups.map((g) => g.join(" ")).join("・");
}
function withNarabiText(html) {
  const s = narabiFromHtml(html);
  if (!s) return html;
  // <br> にしておくと HTML→テキストで必ず独立した1行になる
  return String(html).replace(/<div[^>]*class="[^"]*line_position[^"]*"[^>]*>[\s\S]*?<\/div>/i, "<br>" + s + "<br>");
}

// ---- ページは4万字あるので、予想に必要な部分だけ残す(races.json を太らせないため) ----
const PROF = /^[^\/\s]{1,6}[\s　]?[^\/\s]{0,6}\/\d{1,2}\/\d{1,3}$/;
function compactCard(text, place, raceNo) {
  const L = text.split("\n").map((x) => x.trim()).filter(Boolean);
  const out = [place + "競輪 レース詳細"];
  const dl = L.find((x) => /^\d{4}年\d{1,2}月\d{1,2}日/.test(x));
  out.push((dl ? dl.replace(/\s+/g, " ") : "") + " レース詳細 " + raceNo);
  const gl = L.find((x) => /[ＳＡＬSAL]級/.test(x) && x.length <= 24);
  if (gl) out.push(gl);
  const si = L.findIndex((x) => /^発走予定/.test(x));
  if (si >= 0) { out.push(L[si]); if (L[si + 1]) out.push(L[si + 1]); }
  const seen = new Set();
  for (let i = 2; i < L.length; i++) {
    if (!PROF.test(L[i])) continue;
    const car = parseInt(L[i - 2], 10);
    if (!(car >= 1 && car <= 9)) continue;
    if (seen.has(car)) break;                 // 2周目(別タブの繰り返し)に入ったら終わり
    seen.add(car);
    for (let j = Math.max(0, i - 3); j <= i + 18 && j < L.length; j++) out.push(L[j]);
  }
  const ni = L.findIndex((x) => /並び予想/.test(x) && x.length <= 40);
  if (ni >= 0) for (let j = ni; j < Math.min(L.length, ni + 45); j++) { out.push(L[j]); if (/^レース評/.test(L[j])) break; }
  return out.join("\n");
}

// ---- 日別一覧からレース一覧を作る ----
function parseDayIndex(html) {
  const seen = new Set(), out = [];
  for (const m of html.matchAll(/\/([a-z]+)\/racedetail\/(\d{16})\//g)) {
    const roma = m[1], rid = m[2];
    if (seen.has(rid)) continue; seen.add(rid);
    const pid = parseInt(rid.slice(0, 2), 10);
    const rno = parseInt(rid.slice(-4), 10);
    const place = PID2NAME[pid];
    if (!place || !(rno >= 1 && rno <= 12)) continue;
    out.push({ place, raceNo: rno + "R", rno, url: `https://keirin.kdreams.jp/${roma}/racedetail/${rid}/` });
  }
  return out;
}

function buildEntry(text, item) {
  const p = parseCard(text, TRACK_NAMES);
  if (!p || !Array.isArray(p.entries) || p.entries.length < 5) throw new Error("選手データ不足 " + (p?.entries?.length ?? 0));
  if (!p.place) p.place = item.place;
  p.raceNo = item.raceNo;                        // レース番号はURLの値を正とする
  const bank = T[p.place];
  if (!bank) console.warn("  バンクデータなし:", p.place);
  const r = predict(p, bank, p.place, LEARN_W);
  let sx = null;
  try { sx = sujiExpect(p, r, bank ? bank[10] : null); } catch (e) { console.error("  sujiExpect:", e.message); }

  const posOf = {};
  for (const line of p.lines || []) {
    if (line.length === 1) posOf[line[0]] = 3;
    else line.forEach((car, i) => { posOf[car] = Math.min(i, 2); });
  }
  const rankOf = {};
  (r.scores || []).forEach((s, i) => { rankOf[s.car] = i + 1; });
  const riders = p.entries.map((en) => {
    const sc = (r.scores || []).find((x) => x.car === en.car);
    return [en.car, en.age || 0, parseInt(en.ki, 10) || 0, posOf[en.car] ?? 3, rankOf[en.car] || 9, Number((sc?.total || 0).toFixed(1))];
  });
  return {
    key: (p.place || "?") + "_" + (p.raceNo || "?"),
    place: p.place, raceNo: p.raceNo, startTime: p.startTime || "", grade: p.grade, date: p.date,
    klass: r.klass, fLabel: r.fLabel, pattern: r.linePattern,
    score: sx ? sx.score : null, verdict: sx ? sx.verdict : "対象外",
    reasons: sx ? sx.reasons : ["ガールズ(ライン無し)"],
    marks: (r.marks || []).slice(0, 3).map((mk) => `${mk.mark}${mk.car} ${mk.name}`).join(" / "),
    lines: p.lines || [], marksCars: (r.marks || []).map((mk) => mk.car), riders,
    gap: r.scores && r.scores[1] ? Number((r.scores[0].total - r.scores[1].total).toFixed(1)) : null,
    nishatan: r.bets?.nishatan, sanrentan: r.bets?.sanrentan,
    raw: compactCard(text, p.place, p.raceNo), url: item.url,
  };
}

(async () => {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const d = jst.toISOString().slice(0, 10);
  console.log("========================================");
  console.log(" 全レース更新(取得元: 楽天Kドリームス)");
  console.log(" 対象日:", d);
  console.log("========================================");

  const idxUrl = `https://keirin.kdreams.jp/odds/${d.slice(0,4)}/${d.slice(5,7)}/${d.slice(8,10)}/`;
  let list = [];
  try { list = parseDayIndex(await get(idxUrl)); }
  catch (e) { console.error("日別一覧の取得に失敗:", e.message); process.exit(1); }
  console.log("日別一覧からレース:", list.length, "件");
  if (!list.length) { console.error("レースが1件も見つかりません。開催が無いか、ページ構造が変わっています。"); process.exit(1); }

  const races = [];
  await pool(list, async (item) => {
    const html = await get(item.url);
    const text = htmlToText(withNarabiText(html));   // 並びを先に1行テキストに直す
    const e = buildEntry(text, item);
    if (races.some((x) => x.key === e.key)) return;
    races.push(e);
    console.log("  OK", e.place, e.raceNo, (e.score != null ? e.score + "%" : "ガールズ"), "ライン=" + JSON.stringify(e.lines));
  });

  races.sort((a, b) => (a.startTime || "99:99").localeCompare(b.startTime || "99:99") || a.place.localeCompare(b.place));
  if (!races.length) {
    // 空で上書きするとアプリの一覧が消えるので、1件も作れなかったときは書かない
    console.error("1件も作れませんでした。races.json はそのままにします。");
    process.exit(1);
  }
  // アプリは { updatedAt, count, races } の形を期待している(配列そのままだと読めない)
  const outPath = path.join(__dirname, "races.json");
  fs.writeFileSync(outPath, JSON.stringify({
    updatedAt: new Date().toISOString(),
    count: races.length,
    races,
  }));
  console.log("\n========================================");
  console.log(" 書き出し:", races.length, "レース /", list.length, "件中");
  console.log(" 所要:", Math.round((Date.now() - startedAt) / 1000), "秒");
  console.log("========================================");
})();
