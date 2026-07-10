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
const WAIT_MS = 400;            // 連続アクセスの間隔(サーバー負荷への配慮)
const MAX_RACES = 150;          // レース数上限
const MAX_QUEUE = 250;          // 巡回リンク総数の上限(暴走防止)
const FETCH_TIMEOUT = 10000;    // 1リクエスト10秒でタイムアウト
const DEADLINE_MS = 12 * 60 * 1000; // 全体12分で打ち切り(取得済み分は保存)
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

// HTML → パーサーが読めるテキストへ(コピペ相当に変換)
function htmlToText(html) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<img[^>]*>/gi, " ・ ")                 // 並びの区切り点対策
    .replace(/<(br|\/tr|\/td|\/th|\/p|\/div|\/li|\/h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const ent = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
  s = s.replace(/&[a-z#0-9]+;/gi, (m) => ent[m] || " ");
  return s;
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

async function main() {
  const seen = new Set();
  const queue = [];
  for (const idx of INDEX_URLS) {
    try {
      const html = await get(idx);
      collectLinks(html, idx).forEach((u) => { if (!seen.has(u)) { seen.add(u); queue.push(u); } });
      // 一覧ページから更に1階層(場別一覧など)たどる
      await sleep(WAIT_MS);
    } catch (e) { console.error("index skip:", idx, e.message); }
  }
  queue.sort((a, b) => (/yoso/.test(b) ? 1 : 0) - (/yoso/.test(a) ? 1 : 0));
  console.log("candidate links:", queue.length);

  const races = [];
  for (const url of queue) {
    if (races.length >= MAX_RACES) break;
    if (Date.now() - startedAt > DEADLINE_MS) { console.log("deadline reached — 取得済み分を保存して終了"); break; }
    try {
      await sleep(WAIT_MS);
      const html = await get(url);
      // 2階層目: このページが一覧なら、さらに出走データリンクを拾って後ろに足す
      if (!/基本出走データ/.test(html)) {
        collectLinks(html, url).forEach((u) => { if (!seen.has(u) && queue.length < MAX_QUEUE) { seen.add(u); queue.push(u); } });
        continue;
      }
      // レースページ内の「1R 2R…」タブ等も辿って全レースを回収
      collectLinks(html, url).forEach((u) => { if (!seen.has(u) && queue.length < MAX_QUEUE) { seen.add(u); queue.push(u); } });
      const text = htmlToText(html);
      const p = parseCard(text, TRACK_NAMES);
      // <title>タグ(例: 7/11 前橋7R 基本出走データ)から場名・R番号を補完
      const tm = html.match(/<title>[^<]*?(\d{1,2})\/(\d{1,2})\s*([぀-ヿ一-龥]{2,5}?)(\d{1,2})R/);
      if (tm) {
        if (!p.place || !TRACK_NAMES.includes(p.place)) p.place = tm[3];
        if (!p.raceNo) p.raceNo = tm[4] + "R";
      }
      // それでも無ければURLのpidをキーに使う(重複潰れ防止)
      if (!p.raceNo) {
        const pm2 = url.match(/pid=(\d+)/);
        p.raceNo = pm2 ? "pid" + pm2[1] : "R?";
      }
      const bank = T[p.place];
      const r = predict(p, bank, p.place);
      const sx = sujiExpect(p, r, bank ? bank[10] : null);
      const key = (p.place || "?") + "_" + (p.raceNo || "?");
      if (races.some((x) => x.key === key)) continue;
      races.push({
        key,
        place: p.place, raceNo: p.raceNo, grade: p.grade, date: p.date,
        klass: r.klass, fLabel: r.fLabel, pattern: r.linePattern,
        score: sx ? sx.score : null, verdict: sx ? sx.verdict : "対象外",
        reasons: sx ? sx.reasons : ["ガールズ(ライン無し)"],
        marks: r.marks.slice(0, 3).map((mk) => mk.mark + mk.car + " " + mk.name).join(" / "),
        raw: text,
        url,
      });
      console.log("OK:", p.place, p.raceNo, sx ? sx.score + "%" : "girls", "lines=" + JSON.stringify(p.lines));
    } catch (e) {
      console.error("race skip:", url, e.message);
    }
  }

  races.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const outPath = path.join(__dirname, "races.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ updatedAt: new Date().toISOString(), count: races.length, races }, null, 0));
  console.log("written:", outPath, races.length, "races");
  if (races.length === 0) process.exitCode = 1; // 0件は失敗扱い(構造変更の検知)
}

main().catch((e) => { console.error(e); process.exit(1); });
