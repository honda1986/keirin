// ============================================================
// Gamboo 競輪予想情報を巡回し、本日の全レースのスジ期待度を算出して
// docs/races.json に書き出す(GitHub Actions から実行)
// 使い方: node scripts/fetch.js
// ============================================================
const fs = require("fs");
const path = require("path");
const { parseCard, predict, sujiExpect } = require("./engine.js");
const { T, TRACK_NAMES } = require("./bankdata.js");

// 巡回の起点(競輪予想情報のトップ・一覧ページ)。構造が変わったらここを調整
const INDEX_URLS = [
  "https://gamboo.jp/keirin/yosou/",
  "https://gamboo.jp/keirin/yoso/",
  "https://gamboo.jp/keirin/",
];
const UA = "keirin-local-app (personal use; contact: set-your-email)";
const WAIT_MS = 350;            // 連続アクセスの間隔(サーバー負荷への配慮)
const MAX_RACES = 150;          // レース数上限
const MAX_QUEUE = 400;          // 巡回リンク総数の上限(暴走防止)
const FETCH_TIMEOUT = 10000;    // 1リクエスト10秒でタイムアウト
const DEADLINE_MS = 15 * 60 * 1000; // 全体12分で打ち切り(取得済み分は保存)
const startedAt = Date.now();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(res.status + " " + url);
    return await res.text();
  } finally { clearTimeout(timer); }
}

// 全角英数字→半角(タイトルの「１２Ｒ」対策)
function zenToHan(s) {
  return s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
}

// 並び予想エリアをHTMLから直接抽出し「63・147・25」形式に正規化
// (テキスト変換だと数字間の区切りが失われ全員単騎扱いになるため)
function extractNarabi(html) {
  const i = html.indexOf("並び予想");
  if (i === -1) return null;
  let seg = html.slice(i, i + 3000);
  const stop = seg.search(/情報元|注目レース/);
  if (stop > 0) seg = seg.slice(0, stop);
  // 区切りらしき要素(クラス名にmiddle/point/sep/dot等、または画像)を「・」に
  seg = seg.replace(/<[^>]*(middle|point|sep|dot|arrow|santen)[^>]*>/gi, "・")
           .replace(/<img[^>]*>/gi, "・")
           .replace(/<[^>]+>/g, "");   // 残りのタグは詰めて消す(数字の連続を保つ)
  seg = zenToHan(seg).replace(/&[a-z#0-9]+;/gi, "・");
  const groups = seg.match(/[1-9]+/g);
  return groups && groups.length ? groups : null;
}

// HTML → パーサーが読めるテキストへ(コピペ相当に変換)
function htmlToText(html) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, (m, alt) => /^[1-9]$/.test(alt) ? alt : (/middle|nakaguro/i.test(alt) ? " ・ " : " "))
    .replace(/<img[^>]*>/gi, " ")
    .replace(/<(br|\/tr|\/td|\/th|\/p|\/div|\/li|\/h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const ent = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
  s = s.replace(/&[a-z#0-9]+;/gi, (m) => ent[m] || " ");
  return s;
}

// 並び予想を生HTMLのimg alt列から抽出(数字=車番, middle point=ライン区切り)
function extractNarabi(html, cars) {
  const ni = html.indexOf("並び予想");
  if (ni === -1) return null;
  const chunk = html.slice(ni, ni + 2500);
  const alts = [...chunk.matchAll(/alt="([^"]*)"/g)].map((m) => m[1]);
  const lines = [];
  let cur = [];
  let started = false;
  for (const a of alts) {
    if (/^[1-9]$/.test(a)) { cur.push(parseInt(a)); started = true; continue; }
    if (/middle|nakaguro/i.test(a)) { if (cur.length) { lines.push(cur); cur = []; } continue; }
    if (/←|→|arrow/i.test(a)) continue;         // 進行方向の矢印は無視
    if (started) break;                           // 車番列が終わったら以降のaltは無関係
  }
  if (cur.length) lines.push(cur);
  const flat = lines.flat();
  if (!flat.length) return null;
  // 検証: 全車番が過不足なく1回ずつ
  if (flat.length !== cars.length) return null;
  const set = new Set(flat);
  if (set.size !== cars.length || !cars.every((c) => set.has(c))) return null;
  return lines;
}

// ページ内から基本出走データらしきリンクを収集
function collectLinks(html, baseUrl) {
  const out = new Set();
  const re = /href="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) {
    let href = m[1];
    if (/^(javascript:|#|mailto:)/i.test(href)) continue;
    try { href = new URL(href, baseUrl).toString(); } catch { continue; }
    if (!/gamboo\.jp/.test(href)) continue;
    // 出走データ・レースページらしきURLのみ(構造変更時はここを調整)
    if (/(yoso|yosou|syussou|shussou|race)/i.test(href)) out.add(href.split("#")[0]);
  }
  return [...out];
}

// レースHTMLを解析して races へ格納(成功したら true)
function processRace(html, url, races) {
  if (!/基本出走データ/.test(html)) return false;
  const text = htmlToText(html);
  const p = parseCard(text, TRACK_NAMES);
  const nb = extractNarabi(html, p.entries.map((e2) => e2.car));
  if (nb) { p.lines = nb; p.narabi = nb.flat(); }
  const tm = html.match(/<title>[^<]*?(\d{1,2})\/(\d{1,2})\s*([぀-ヿ一-龥]{2,5}?)(\d{1,2})R/);
  if (tm) {
    if (!p.place || !TRACK_NAMES.includes(p.place)) p.place = tm[3];
    if (!p.raceNo) p.raceNo = tm[4] + "R";
  }
  if (!p.raceNo) { const pm2 = url.match(/pid=(\d+)/); p.raceNo = pm2 ? "pid" + pm2[1] : "R?"; }
  const key = (p.place || "?") + "_" + (p.raceNo || "?");
  if (races.some((x) => x.key === key)) return false;
  const bank = T[p.place];
  const r = predict(p, bank, p.place);
  const sx = sujiExpect(p, r, bank ? bank[10] : null);
  races.push({
    key, place: p.place, raceNo: p.raceNo, grade: p.grade, date: p.date,
    klass: r.klass, fLabel: r.fLabel, pattern: r.linePattern,
    score: sx ? sx.score : null, verdict: sx ? sx.verdict : "対象外",
    reasons: sx ? sx.reasons : ["ガールズ(ライン無し)"],
    marks: r.marks.slice(0, 3).map((mk) => mk.mark + mk.car + " " + mk.name).join(" / "),
    lines: p.lines, marksCars: r.marks.map((mk) => mk.car),
    nishatan: r.bets.nishatan, sanrentan: r.bets.sanrentan,
    raw: text, url,
  });
  console.log("OK:", p.place, p.raceNo, sx ? sx.score + "%" : "girls", "lines=" + JSON.stringify(p.lines));
  return true;
}
async function fetchRace(url, races) {
  const html = await get(url);
  return processRace(html, url, races);
}
// レースページ内の「1R 2R…」等、出走データへのリンクだけを厳選収集
function collectRaceLinks(html, baseUrl) {
  const out = new Set();
  const re = /href="([^"]*keirin\/yoso\/[^"]*rdt=[^"]*)"/gi;
  let m;
  while ((m = re.exec(html))) {
    let href = m[1].replace(/&amp;/g, "&");
    try { href = new URL(href, baseUrl).toString(); } catch { continue; }
    out.add(href.split("#")[0]);
  }
  return [...out];
}

async function main() {
  const races = [];

  // ---- 第1段: 全国共通の場コード(pid)×レース番号(rno)を直接指定して取得 ----
  // 検索で確認済みのURL仕様: /keirin/yoso/?rdt=YYYY-MM-DD&pid=場コード&rno=レース番号
  const VENUE_PIDS = [11,12,13,21,22,23,24,25,26,27,28,31,32,34,35,36,37,38,42,43,44,45,46,47,48,51,53,54,55,56,61,62,63,71,73,74,75,81,83,84,85,86,87];
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const rdt = jst.toISOString().slice(0, 10);
  console.log("phase1: 場コード×rno列挙", rdt);
  for (const pid of VENUE_PIDS) {
    if (races.length >= MAX_RACES) break;
    if (Date.now() - startedAt > DEADLINE_MS) { console.log("deadline"); break; }
    let venueMiss = 0;
    for (let rno = 1; rno <= 12; rno++) {
      if (Date.now() - startedAt > DEADLINE_MS) break;
      const url = `https://gamboo.jp/keirin/yoso/?rdt=${rdt}&pid=${pid}&rno=${rno}`;
      try {
        await sleep(WAIT_MS);
        const html = await get(url);
        const ok = processRace(html, url, races);
        if (ok) venueMiss = 0; else venueMiss++;
      } catch (e) { venueMiss++; }
      // rno=1,2と連続で無効ならこの場は非開催と判断して次の場へ
      if (rno <= 2 && venueMiss >= 2) break;
      if (venueMiss >= 3) break; // 途中で3連続無効=最終レースを越えた
    }
  }
  console.log("phase1 done:", races.length, "races");

  // ---- 第2段(予備): 取得が少ない場合のみ従来のリンク巡回 ----
  if (races.length < 30) {
  const seen = new Set();
  const queue = [];
  for (const idx of INDEX_URLS) {
    try {
      const html = await get(idx);
      collectLinks(html, idx).forEach((u) => { if (!seen.has(u)) { seen.add(u); queue.push(u); } });
      await sleep(WAIT_MS);
    } catch (e) { console.error("index skip:", idx, e.message); }
  }
  queue.sort((a, b) => (/yoso/.test(b) ? 1 : 0) - (/yoso/.test(a) ? 1 : 0));
  console.log("candidate links:", queue.length);

  let debugDumped = false;
  for (const url of queue) {
    if (races.length >= MAX_RACES) break;
    if (Date.now() - startedAt > DEADLINE_MS) { console.log("deadline reached"); break; }
    try {
      await sleep(WAIT_MS);
      const html0 = await get(url);
      if (!/基本出走データ/.test(html0)) {
        collectLinks(html0, url).forEach((u) => { if (!seen.has(u) && queue.length < MAX_QUEUE) { seen.add(u); queue.push(u); } });
        continue;
      }
      await fetchRace(url, races);
    } catch (e) { console.error("race skip:", url, e.message); }
  }
  } // 第2段ここまで

  races.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const outPath = path.join(__dirname, "races.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ updatedAt: new Date().toISOString(), count: races.length, races }, null, 0));
  console.log("written:", outPath, races.length, "races");
  if (races.length === 0) process.exitCode = 1; // 0件は失敗扱い(構造変更の検知)
}

main().catch((e) => { console.error(e); process.exit(1); });
