// ============================================================
// GambooBETの払戻金一覧(日別1ページ)から全レース結果を取得し、
// 予想との答え合わせを history.json / stats.json に蓄積する
// 使い方: node results.js
// ============================================================
const fs = require("fs");
const path = require("path");

const UA = "keirin-local-app (personal use)";
const FETCH_TIMEOUT = 15000;

async function get(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(res.status + " " + url);
    return await res.text();
  } finally { clearTimeout(t); }
}

const strip = (h) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const sameDigits = (a, b) => a.split("").sort().join("") === b.split("").sort().join("");

// 払戻一覧HTML → { "場名_nR": {first,second,third,p3pay} }
function parseHaraiList(html) {
  const out = {};
  let venue = null;
  const re = /([぀-ヿ一-龥]{2,5})競輪|<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) { venue = m[1]; continue; }
    if (!venue) continue;
    const tokens = strip(m[2]).split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const rm = tokens[0].match(/^(\d{1,2})R$/);
    if (!rm) continue;
    // 未確定行(発走時刻 20:45 等)はスキップ
    const fin = tokens[1];
    if (!fin || !/^\d{3}$/.test(fin)) continue;
    // 同着行: 着順の直後に同じ数字構成の3桁が続く場合は読み飛ばす
    let i = 2;
    while (i < tokens.length && /^\d{3}$/.test(tokens[i]) && sameDigits(tokens[i], fin)) i++;
    // 次の数値トークン(カンマ許容)が3連単払戻
    let pay = null;
    for (; i < tokens.length; i++) {
      const v = tokens[i].replace(/,/g, "");
      if (/^\d+$/.test(v)) { pay = +v; break; }
    }
    if (pay == null) continue;
    out[venue + "_" + rm[1] + "R"] = { first: +fin[0], second: +fin[1], third: +fin[2], p3pay: pay };
  }
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

  // races.json内の日付を集めて、日付ごとに払戻一覧を1回取得
  const dates = [...new Set(races.map((x) => ((x.url || "").match(/rdt=([\d-]+)/) || [])[1]).values())].filter(Boolean);
  const results = {};
  for (const dH of dates) {
    const [y, mo, d] = dH.split("-");
    const url = `https://keirin.kdreams.jp/gamboo/keirin-kaisai/harai-list/${y}/${mo}/${d}/`;
    try {
      const html = await get(url);
      Object.assign(results, parseHaraiList(html));
      console.log("払戻一覧取得:", dH, Object.keys(results).length, "レース確定");
    } catch (e) { console.error("harai-list skip:", url, e.message); }
  }

  let added = 0;
  for (const x of races) {
    const dH = ((x.url || "").match(/rdt=([\d-]+)/) || [])[1];
    if (!dH) continue;
    const d8 = dH.replace(/-/g, "");
    const id = d8 + "_" + x.key;
    if (done.has(id)) continue;
    const r = results[x.place + "_" + x.raceNo];
    if (!r) continue; // 未確定は次回実行で拾う
    const { first: f, second: s, third: t, p3pay } = r;
    hist.entries.push({
      id, date: d8, place: x.place, raceNo: x.raceNo, klass: x.klass,
      score: x.score, verdict: x.verdict, pattern: x.pattern,
      f, s, t, p3pay,
      suji: sujiHit(x.lines, f, s),
      honmeiWin: !!(x.marksCars && x.marksCars[0] === f),
      honmeiRen: !!(x.marksCars && (x.marksCars[0] === f || x.marksCars[0] === s)),
      n2cnt: (x.nishatan || []).length, n2hit: (x.nishatan || []).includes(f + "-" + s),
      n3cnt: (x.sanrentan || []).length, n3hit: (x.sanrentan || []).includes(f + "-" + s + "-" + t),
    });
    added++;
    console.log("RESULT:", x.place, x.raceNo, f + "-" + s + "-" + t, p3pay + "円",
      "スジ:" + (sujiHit(x.lines, f, s) ? "○" : "×"));
  }

  if (hist.entries.length > 8000) hist.entries = hist.entries.slice(-8000);
  fs.writeFileSync(histPath, JSON.stringify(hist));
  console.log("history:", added, "件追加 / 累計", hist.entries.length);

  // ---- 集計 → stats.json ----
  const E = hist.entries;
  const rate = (a, b) => (b ? +(a / b * 100).toFixed(1) : 0);
  const buckets = {};
  for (const b of ["◎スジ堅い", "○スジ寄り", "△互角", "×荒れ含み"]) {
    const g = E.filter((e) => e.verdict === b);
    buckets[b] = { n: g.length, sujiRate: rate(g.filter((e) => e.suji).length, g.length) };
  }
  const n3bet = E.reduce((a, e) => a + e.n3cnt, 0);
  const n3ret = E.reduce((a, e) => a + (e.n3hit ? e.p3pay : 0), 0);
  const stats = {
    updatedAt: new Date().toISOString(),
    total: E.length,
    honmeiWin: rate(E.filter((e) => e.honmeiWin).length, E.length),
    honmeiRen: rate(E.filter((e) => e.honmeiRen).length, E.length),
    sujiOverall: rate(E.filter((e) => e.suji).length, E.length),
    buckets,
    nishatan: { hit: rate(E.filter((e) => e.n2hit).length, E.length), roi: null },
    sanrentan: { hit: rate(E.filter((e) => e.n3hit).length, E.length), roi: rate(n3ret, n3bet * 100) },
  };
  fs.writeFileSync(path.join(dir, "stats.json"), JSON.stringify(stats));
  console.log("stats:", JSON.stringify(stats));
}

main().catch((e) => { console.error(e); process.exit(1); });
