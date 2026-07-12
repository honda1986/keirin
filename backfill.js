// ============================================================
// 過去レースをまとめて収集して history.json に蓄積する(学習用データ作成)
// 各過去日について「出走データ取得→予想→払戻一覧で答え合わせ」を実行。
// 使い方:
//   node backfill.js 30         … 昨日から過去30日ぶんを収集
//   node backfill.js 2026-06-01 2026-06-30  … 期間指定
// GitHub Actions(手動 workflow_dispatch)からの実行を想定。
// ============================================================
const fs = require("fs");
const path = require("path");
const { parseCard, predict, sujiExpect } = require("./engine.js");
const { T, TRACK_NAMES } = require("./bankdata.js");

const UA = "keirin-local-app (personal use; backfill)";
const WAIT_MS = 350;
const FETCH_TIMEOUT = 15000;
const DEADLINE_MS = 5.5 * 60 * 60 * 1000; // 5.5時間(Actions上限6時間の手前)で打ち切り
const startedAt = Date.now();
const VENUE_PIDS = [11,12,13,21,22,23,24,25,26,27,28,31,32,34,35,36,37,38,42,43,44,45,46,47,48,51,53,54,55,56,61,62,63,71,73,74,75,81,83,84,85,86,87];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(res.status);
    return await res.text();
  } finally { clearTimeout(t); }
}

// ---- 出走データHTML → 並び抽出(fetch.jsと同ロジック) ----
function htmlToText(html) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, (m, alt) => /^[1-9]$/.test(alt) ? alt : (/middle|nakaguro/i.test(alt) ? " ・ " : " "))
    .replace(/<img[^>]*>/gi, " ")
    .replace(/<(br|\/tr|\/td|\/th|\/p|\/div|\/li|\/h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const ent = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
  return s.replace(/&[a-z#0-9]+;/gi, (m) => ent[m] || " ");
}
function extractNarabi(html, cars) {
  const ni = html.indexOf("並び予想");
  if (ni === -1) return null;
  const chunk = html.slice(ni, ni + 2500);
  const alts = [...chunk.matchAll(/alt="([^"]*)"/g)].map((m) => m[1]);
  const lines = []; let cur = []; let started = false;
  for (const a of alts) {
    if (/^[1-9]$/.test(a)) { cur.push(parseInt(a)); started = true; continue; }
    if (/middle|nakaguro/i.test(a)) { if (cur.length) { lines.push(cur); cur = []; } continue; }
    if (/←|→|arrow/i.test(a)) continue;
    if (started) break;
  }
  if (cur.length) lines.push(cur);
  const flat = lines.flat();
  if (!flat.length || flat.length !== cars.length) return null;
  const set = new Set(flat);
  if (set.size !== cars.length || !cars.every((c) => set.has(c))) return null;
  return lines;
}

// ---- 払戻一覧HTML → {場名_nR: {first,second,third,p3pay}} (results.jsと同ロジック) ----
function parseHaraiList(html) {
  const out = {};
  const venueRe = /([぀-ヿ一-龥]{2,5})競輪/g;
  const marks = []; let vm;
  while ((vm = venueRe.exec(html))) marks.push({ name: vm[1], idx: vm.index });
  for (let k = 0; k < marks.length; k++) {
    const venue = marks[k].name;
    const block = html.slice(marks[k].idx, k + 1 < marks.length ? marks[k + 1].idx : undefined);
    const rowRe = /class="race"[^>]*>\s*(\d{1,2})R[\s\S]*?class="order"[\s\S]*?<\/td>[\s\S]*?class="refund"[^>]*>\s*([\d,]+)/g;
    let rm;
    while ((rm = rowRe.exec(block))) {
      const rno = rm[1], payStr = rm[2].replace(/,/g, "");
      const orderChunk = block.slice(rm.index, rm.index + rm[0].length);
      const spans = [...orderChunk.matchAll(/<span[^>]*class="n\d"[^>]*>\s*(\d)\s*<\/span>/g)].map((x) => +x[1]);
      if (spans.length < 3 || !/^\d+$/.test(payStr)) continue;
      const key = venue + "_" + rno + "R";
      if (out[key]) continue;
      out[key] = { first: spans[0], second: spans[1], third: spans[2], p3pay: +payStr };
    }
  }
  return out;
}
const sujiHit = (lines, f, s) => (lines || []).some((l) => {
  for (let i = 0; i + 1 < l.length; i++) if ((l[i] === f && l[i + 1] === s) || (l[i] === s && l[i + 1] === f)) return true;
  return false;
});

// 1レース分の出走データを予想して {予想オブジェクト} を返す
function predictOne(html, url) {
  if (!/基本出走データ/.test(html)) return null;
  const text = htmlToText(html);
  const p = parseCard(text, TRACK_NAMES);
  const nb = extractNarabi(html, p.entries.map((e) => e.car));
  if (nb) { p.lines = nb; p.narabi = nb.flat(); }
  const tm = html.match(/<title>[^<]*?(\d{1,2})\/(\d{1,2})\s*([぀-ヿ一-龥]{2,5}?)(\d{1,2})R/);
  if (tm) { if (!p.place || !TRACK_NAMES.includes(p.place)) p.place = tm[3]; if (!p.raceNo) p.raceNo = tm[4] + "R"; }
  if (!p.place || !p.raceNo) return null;
  const bank = T[p.place];
  const r = predict(p, bank, p.place);
  const sx = sujiExpect(p, r, bank ? bank[10] : null);
  return {
    place: p.place, raceNo: p.raceNo, klass: r.klass, pattern: r.linePattern,
    score: sx ? sx.score : null, verdict: sx ? sx.verdict : "対象外",
    lines: p.lines, marksCars: r.marks.map((mk) => mk.car),
    sanrentan: r.bets.sanrentan,
  };
}

function ymd(d) { return d.toISOString().slice(0, 10); }
function buildDates(args) {
  const out = [];
  if (args.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(args[0]) && /^\d{4}-\d{2}-\d{2}$/.test(args[1])) {
    let a = new Date(args[0] + "T00:00:00Z"), b = new Date(args[1] + "T00:00:00Z");
    for (let d = new Date(a); d <= b; d.setUTCDate(d.getUTCDate() + 1)) out.push(ymd(new Date(d)));
  } else {
    const n = parseInt(args[0] || "30", 10);
    const base = new Date(Date.now() + 9 * 3600 * 1000); // JST
    for (let i = 1; i <= n; i++) { const d = new Date(base); d.setUTCDate(d.getUTCDate() - i); out.push(ymd(d)); }
  }
  return out;
}

async function main() {
  const dates = buildDates(process.argv.slice(2));
  console.log("backfill 対象:", dates[dates.length - 1], "〜", dates[0], "(" + dates.length + "日)");
  const dir = __dirname;
  const histPath = path.join(dir, "history.json");
  const hist = fs.existsSync(histPath) ? JSON.parse(fs.readFileSync(histPath, "utf8")) : { entries: [] };
  const done = new Set(hist.entries.map((e) => e.id));
  let added = 0;

  for (const dH of dates) {
    if (Date.now() - startedAt > DEADLINE_MS) { console.log("時間切れで終了"); break; }
    // 1) その日の払戻一覧を1回取得
    const [y, mo, d] = dH.split("-");
    let results = {};
    try {
      const hhtml = await get(`https://keirin.kdreams.jp/gamboo/keirin-kaisai/harai-list/${y}/${mo}/${d}/`);
      results = parseHaraiList(hhtml);
    } catch (e) { console.error("harai skip:", dH, e.message); continue; }
    if (!Object.keys(results).length) { console.log(dH, "確定レースなし(スキップ)"); continue; }

    // 2) 場×レースを走査して予想→照合
    let dayAdded = 0;
    for (const pid of VENUE_PIDS) {
      if (Date.now() - startedAt > DEADLINE_MS) break;
      let miss = 0;
      for (let rno = 1; rno <= 12; rno++) {
        const id = dH.replace(/-/g, "") + "_pid" + pid + "_" + rno;
        if (done.has(id)) { miss = 0; continue; }
        const url = `https://gamboo.jp/keirin/yoso/?rdt=${dH}&pid=${pid}&rno=${rno}`;
        let pr = null;
        try { await sleep(WAIT_MS); pr = predictOne(await get(url), url); } catch (e) { pr = null; }
        if (!pr) { miss++; if (rno <= 2 && miss >= 2) break; if (miss >= 3) break; continue; }
        miss = 0;
        const res = results[pr.place + "_" + pr.raceNo];
        if (!res) continue; // 結果が一覧にない(欠場・非開催)
        const { first: f, second: s, third: t, p3pay } = res;
        const eid = dH.replace(/-/g, "") + "_" + pr.place + "_" + pr.raceNo;
        if (done.has(eid)) continue;
        hist.entries.push({
          id: eid, date: dH.replace(/-/g, ""), place: pr.place, raceNo: pr.raceNo, klass: pr.klass,
          score: pr.score, verdict: pr.verdict, pattern: pr.pattern, f, s, t, p3pay,
          suji: sujiHit(pr.lines, f, s),
          honmeiWin: pr.marksCars[0] === f, honmeiRen: pr.marksCars[0] === f || pr.marksCars[0] === s,
          n3cnt: pr.sanrentan.length, n3hit: pr.sanrentan.includes(f + "-" + s + "-" + t),
        });
        done.add(eid); added++; dayAdded++;
      }
    }
    console.log(dH, "→", dayAdded, "レース追加 (累計" + hist.entries.length + ")");
  }

  if (hist.entries.length > 20000) hist.entries = hist.entries.slice(-20000);
  fs.writeFileSync(histPath, JSON.stringify(hist));
  console.log("backfill完了:", added, "件追加 / 累計", hist.entries.length);

  // stats.json 再集計
  const E = hist.entries;
  const rate = (a, b) => (b ? +(a / b * 100).toFixed(1) : 0);
  const buckets = {};
  for (const b of ["◎スジ堅い", "○スジ寄り", "△互角", "×荒れ含み"]) {
    const g = E.filter((e) => e.verdict === b);
    buckets[b] = { n: g.length, sujiRate: rate(g.filter((e) => e.suji).length, g.length) };
  }
  const n3bet = E.reduce((a, e) => a + (e.n3cnt || 0), 0);
  const n3ret = E.reduce((a, e) => a + (e.n3hit ? e.p3pay : 0), 0);
  const stats = {
    updatedAt: new Date().toISOString(), total: E.length,
    honmeiWin: rate(E.filter((e) => e.honmeiWin).length, E.length),
    honmeiRen: rate(E.filter((e) => e.honmeiRen).length, E.length),
    sujiOverall: rate(E.filter((e) => e.suji).length, E.length),
    buckets,
    nishatan: { hit: 0, roi: null },
    sanrentan: { hit: rate(E.filter((e) => e.n3hit).length, E.length), roi: rate(n3ret, n3bet * 100) },
  };
  fs.writeFileSync(path.join(dir, "stats.json"), JSON.stringify(stats));
  console.log("stats:", JSON.stringify(stats.sanrentan), JSON.stringify(buckets));
}
main().catch((e) => { console.error(e); process.exit(1); });
