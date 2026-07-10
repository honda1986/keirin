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
  let debugDumped = false;
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
      if (!debugDumped) {
        const ni = html.indexOf("並び予想");
        if (ni !== -1) {
          console.log("=== 並び周辺の生HTML(構造診断・最初の1件のみ) ===");
          console.log(html.slice(ni, ni + 700).replace(/\s+/g, " "));
          console.log("=== ここまで ===");
          debugDumped = true;
        }
      }
      const text = htmlToText(html);
      const p = parseCard(text, TRACK_NAMES);
      // 並びは生HTMLのalt列から確実に上書き(数字画像対応)
      const nb = extractNarabi(html, p.entries.map((e2) => e2.car));
      if (nb) { p.lines = nb; p.narabi = nb.flat(); }
      // <title>タグ(例: 7/11 前橋7R 基本出走データ)から場名・R番号を補完(全角数字対応)
      const titleRaw = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
      const tm = zenToHan(titleRaw).match(/(\d{1,2})\/(\d{1,2})\s*([぀-ヿ一-龥]{2,5}?)(\d{1,2})R/);
      if (tm) {
        if (!p.place || !TRACK_NAMES.includes(p.place)) p.place = tm[3];
        if (!p.raceNo) p.raceNo = tm[4] + "R";
      }
      // それでも無ければURLのpidをキーに使う(重複潰れ防止)
      if (!p.raceNo) {
        const pm2 = url.match(/pid=(\d+)/);
        p.raceNo = pm2 ? "pid" + pm2[1] : "R?";
      }
      // ライン再構築: パーサーが全員単騎にした場合、HTMLから直接抽出した並びで上書き
      const allSingle = p.lines.every((l) => l.length === 1);
      if (allSingle && p.entries.length >= 5) {
        const groups = extractNarabi(html);
        if (groups) {
          const cars = p.entries.map((e) => e.car);
          const flat = groups.join("");
          const uniq = new Set(flat.split("").map(Number));
          const maxLen = Math.max(...groups.map((g) => g.length));
          if (flat.length === cars.length && uniq.size === cars.length && maxLen <= 4 && groups.length >= 2) {
            p.lines = groups.map((g) => g.split("").map(Number));
            console.log("  narabi rebuilt:", groups.join("・"));
          } else {
            console.log("  narabi raw(診断用):", JSON.stringify(groups));
          }
        } else {
          console.log("  narabi not found in HTML(診断用)");
        }
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
