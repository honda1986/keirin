// ============================================================
// 本日のレース結果を取得し、予想との答え合わせを history.json に蓄積、
// 集計を stats.json に書き出す(GitHub Actions から実行)
// 使い方: node results.js
// ============================================================
const fs = require("fs");
const path = require("path");

const UA = "keirin-local-app (personal use)";
const WAIT_MS = 400;
const FETCH_TIMEOUT = 10000;
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

function stripTags(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
}

// 結果ページ候補(上から順に試す)。3連単の払戻が読めたページを採用
const CANDS = [
  (d8, dH, pid, rno) => `https://gamboo.jp/keirin/bet/raceinfo?rdt=${d8}&pid=${pid}&rno=${rno}`,
  (d8, dH, pid, rno) => `https://gamboo.jp/keirin/result/?rdt=${dH}&pid=${pid}&rno=${rno}`,
  (d8, dH, pid, rno) => `https://gamboo.jp/keirin/yoso/result?rdt=${dH}&pid=${pid}&rno=${rno}`,
];

// テキストから払戻(=着順)を抽出。3連単 x-y-z ¥n が取れれば成立
function parseResult(text) {
  const p3 = text.match(/3連単[\s\S]{0,60}?([1-9])[-=]([1-9])[-=]([1-9])[\s\S]{0,40}?([\d,]+)\s*円/);
  if (!p3) return null;
  const out = { first: +p3[1], second: +p3[2], third: +p3[3], p3pay: +p3[4].replace(/,/g, "") };
  const p2 = text.match(/2車単[\s\S]{0,60}?([1-9])[-=]([1-9])[\s\S]{0,40}?([\d,]+)\s*円/);
  if (p2) { out.p2first = +p2[1]; out.p2second = +p2[2]; out.p2pay = +p2[3].replace(/,/g, ""); }
  return out;
}

const sujiHit = (lines, f, s) => (lines || []).some((l) => {
  for (let i = 0; i + 1 < l.length; i++) {
    if ((l[i] === f && l[i + 1] === s) || (l[i] === s && l[i + 1] === f)) return true;
  }
  return false;
});

async function main() {
  const dir = __dirname;
  const races = JSON.parse(fs.readFileSync(path.join(dir, "races.json"), "utf8")).races || [];
  const histPath = path.join(dir, "history.json");
  const hist = fs.existsSync(histPath) ? JSON.parse(fs.readFileSync(histPath, "utf8")) : { entries: [] };
  const done = new Set(hist.entries.map((e) => e.id));
  let dumped = false, added = 0;

  for (const x of races) {
    const um = (x.url || "").match(/rdt=([\d-]+).*?pid=(\d+).*?rno=(\d+)/);
    if (!um) continue;
    const dH = um[1], pid = um[2], rno = um[3];
    const d8 = dH.replace(/-/g, "");
    const id = d8 + "_" + x.key;
    if (done.has(id)) continue;

    let result = null;
    for (const mk of CANDS) {
      const url = mk(d8, dH, pid, rno);
      try {
        await sleep(WAIT_MS);
        const html = await get(url);
        const text = stripTags(html);
        result = parseResult(text);
        if (result) break;
        if (!dumped) { // 最初の1件だけ診断: 払戻周辺のテキスト
          dumped = true;
          const i = text.indexOf("払戻");
          console.log("DEBUG url:", url);
          console.log("DEBUG 払戻周辺>>>", i >= 0 ? text.slice(i, i + 500).replace(/\s+/g, " ") : "(払戻の文字なし) 先頭:" + text.slice(0, 300).replace(/\s+/g, " "), "<<<");
        }
      } catch (e) { /* 次候補へ */ }
    }
    if (!result) continue; // 未確定(発走前)や取得不可はスキップ、次回実行で拾う

    const f = result.first, s = result.second, t = result.third;
    const e = {
      id, date: d8, place: x.place, raceNo: x.raceNo, klass: x.klass,
      score: x.score, verdict: x.verdict, pattern: x.pattern,
      f, s, t, p2pay: result.p2pay || null, p3pay: result.p3pay,
      suji: sujiHit(x.lines, f, s),
      honmeiWin: x.marksCars && x.marksCars[0] === f,
      honmeiRen: x.marksCars && (x.marksCars[0] === f || x.marksCars[0] === s),
      n2cnt: (x.nishatan || []).length, n2hit: (x.nishatan || []).includes(f + "-" + s),
      n3cnt: (x.sanrentan || []).length, n3hit: (x.sanrentan || []).includes(f + "-" + s + "-" + t),
    };
    hist.entries.push(e); added++;
    console.log("RESULT:", x.place, x.raceNo, f + "-" + s + "-" + t, "スジ:" + (e.suji ? "○" : "×"), "◎1着:" + (e.honmeiWin ? "○" : "×"));
  }

  if (hist.entries.length > 8000) hist.entries = hist.entries.slice(-8000);
  fs.writeFileSync(histPath, JSON.stringify(hist));
  console.log("history:", added, "件追加 / 累計", hist.entries.length);

  // ---- 集計 → stats.json ----
  const E = hist.entries;
  const n = E.length || 1;
  const rate = (a, b) => (b ? +(a / b * 100).toFixed(1) : 0);
  const buckets = {};
  for (const b of ["◎スジ堅い", "○スジ寄り", "△互角", "×荒れ含み"]) {
    const g = E.filter((e) => e.verdict === b);
    buckets[b] = { n: g.length, sujiRate: rate(g.filter((e) => e.suji).length, g.length) };
  }
  const n2bet = E.reduce((a, e) => a + e.n2cnt, 0), n2ret = E.reduce((a, e) => a + (e.n2hit && e.p2pay ? e.p2pay : 0), 0);
  const n3bet = E.reduce((a, e) => a + e.n3cnt, 0), n3ret = E.reduce((a, e) => a + (e.n3hit ? e.p3pay : 0), 0);
  const stats = {
    updatedAt: new Date().toISOString(),
    total: E.length,
    honmeiWin: rate(E.filter((e) => e.honmeiWin).length, E.length),
    honmeiRen: rate(E.filter((e) => e.honmeiRen).length, E.length),
    sujiOverall: rate(E.filter((e) => e.suji).length, E.length),
    buckets,
    nishatan: { hit: rate(E.filter((e) => e.n2hit).length, E.length), roi: rate(n2ret, n2bet * 100) },
    sanrentan: { hit: rate(E.filter((e) => e.n3hit).length, E.length), roi: rate(n3ret, n3bet * 100) },
  };
  fs.writeFileSync(path.join(dir, "stats.json"), JSON.stringify(stats));
  console.log("stats:", JSON.stringify(stats.buckets));
}

main().catch((e) => { console.error(e); process.exit(1); });
