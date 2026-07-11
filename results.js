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

// 払戻一覧(HTMLまたはmarkdown表)→ { "場名_nR": {first,second,third,p3pay} }
// 場名は「○○競輪」の competition 部分(例: 前橋)をキーにする
function parseHaraiList(text) {
  const out = {};
  const lines = text.split(/\r?\n/);
  let venue = null;
  for (const raw of lines) {
    const line = raw.trim();
    // 見出し: 「### 前橋競輪 2日目」または「前橋競輪」を含む行
    const vm = line.match(/([぀-ヿ一-龥]{2,5})競輪/);
    if (vm && (line.startsWith("#") || line.startsWith("-") || line.includes("###") || /日目|初日|最終日/.test(line))) {
      venue = vm[1]; continue;
    }
    // markdown表の行: | 1R | 437 | 9,040 | 31 | ... |
    if (!venue || line.indexOf("|") === -1) continue;
    const cells = line.split("|").map((c) => c.trim()).filter((c) => c !== "");
    if (cells.length < 3) continue;
    const rm = cells[0].match(/^(\d{1,2})R$/);
    if (!rm) continue;
    const fin = cells[1].replace(/<br\s*\/?>/gi, " ").trim().split(/\s+/)[0];
    if (!/^\d{3}$/.test(fin)) continue; // 未確定(発走時刻)はスキップ
    // 3連単配当セル(同着は "15,220 18,450" の先頭)
    const payCell = (cells[2] || "").split(/\s+/)[0].replace(/,/g, "");
    if (!/^\d+$/.test(payCell)) continue;
    out[venue + "_" + rm[1] + "R"] = { first: +fin[0], second: +fin[1], third: +fin[2], p3pay: +payCell };
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
  const baseDates = [...new Set(races.map((x) => ((x.url || "").match(/rdt=([\d-]+)/) || [])[1]).values())].filter(Boolean);
  // races.jsonの日付 + その前日 も一覧を見る(ナイター開催は結果一覧が前日ページに載るため)
  const dateSet = new Set(baseDates);
  for (const dH of baseDates) {
    const dt = new Date(dH + "T00:00:00Z"); dt.setUTCDate(dt.getUTCDate() - 1);
    dateSet.add(dt.toISOString().slice(0, 10));
  }
  const dates = [...dateSet];
  const results = {};
  for (const dH of dates) {
    const [y, mo, d] = dH.split("-");
    const url = `https://keirin.kdreams.jp/gamboo/keirin-kaisai/harai-list/${y}/${mo}/${d}/`;
    try {
      const html = await get(url);
      if (!global.__dbg) {
        global.__dbg = true;
        console.log("DEBUG htmlLen:", html.length);
        console.log("DEBUG has<table>:", /<table/i.test(html), " has<tr>:", /<tr/i.test(html), " has競輪:", /競輪/.test(html));
        const gi = html.indexOf("競輪");
        console.log("DEBUG 競輪周辺>>>", gi >= 0 ? html.slice(gi - 20, gi + 900).replace(/\s+/g, " ") : "(競輪なし)", "<<<");
        // 「1R」を含む箇所の生HTML
        const ri = html.search(/1\s*R|１Ｒ/);
        console.log("DEBUG 1R周辺>>>", ri >= 0 ? html.slice(ri - 40, ri + 400).replace(/\s+/g, " ") : "(1Rなし)", "<<<");
      }
      // HTMLのテーブルを「| セル | セル |」の行に整形してparseに渡す(markdown/HTML両対応)
      const md = html
        .replace(/<(td|th)[^>]*>/gi, "| ")
        .replace(/<\/(td|th)>/gi, " ")
        .replace(/<\/tr>/gi, " |\n")
        .replace(/<h[1-6][^>]*>/gi, "\n### ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
      Object.assign(results, parseHaraiList(md));
      console.log("払戻一覧取得:", dH, "→", Object.keys(results).length, "レース確定");
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
