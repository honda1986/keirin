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

// 払戻一覧 → { "場名_nR": {first,second,third,p3pay,p2pay} }
// 新ページ(keirin.kdreams.jp/harailist/)はmarkdown/HTMLで「### 3連単」「### 2車単」のセクションを持つ。
// 3連単は「3-7-5 | 12,130」、2車単は「3-7 | 1,610」の形式。両方をマージする。
function parseHaraiList(text) {
  const out = {};
  // 「### 賭式名」でセクション分割
  const secRe = /###\s*(3連単|2車単|３連単|２車単)([\s\S]*?)(?=###|$)/g;
  let sm;
  const ensure = (key) => (out[key] = out[key] || {});
  while ((sm = secRe.exec(text))) {
    const kind = sm[1].replace("３", "3").replace("２", "2");
    const body = sm[2];
    // 場ブロック: 「- ○○競輪」または「○○競輪」見出しで分割
    const venueRe = /([぀-ヿ一-龥]{2,5})競輪/g;
    const marks = []; let vm;
    while ((vm = venueRe.exec(body))) marks.push({ name: vm[1], idx: vm.index });
    for (let k = 0; k < marks.length; k++) {
      const venue = marks[k].name;
      const block = body.slice(marks[k].idx, k + 1 < marks.length ? marks[k + 1].idx : undefined);
      // 行: | 1R | 3-7-5 | 12,130 | ... または | 1R | 3-7 | 1,610 | ...
      const rowRe = /\|\s*(\d{1,2})R\s*\|\s*([\d]-[\d](?:-[\d])?)\s*\|\s*([\d,]+)/g;
      let rm;
      while ((rm = rowRe.exec(block))) {
        const rno = rm[1], combo = rm[2], pay = +rm[3].replace(/,/g, "");
        const key = venue + "_" + rno + "R";
        const cars = combo.split("-").map(Number);
        if (kind === "3連単" && cars.length === 3) {
          const o = ensure(key);
          if (o.first == null) { o.first = cars[0]; o.second = cars[1]; o.third = cars[2]; o.p3pay = pay; }
        } else if (kind === "2車単" && cars.length === 2) {
          const o = ensure(key);
          if (o.p2pay == null) { o.p2pay = pay; o.p2first = cars[0]; o.p2second = cars[1]; }
        }
      }
    }
  }
  // 3連単の着順が取れたものだけ有効(2車単のみは着順不明なので除外しない: p2payは付随情報)
  return out;
}

// HTMLをmarkdown風テキストに正規化(td→|、tr→改行、h3→###)
function toMd(html) {
  if (/###\s*(3連単|2車単)/.test(html)) return html; // 既にmarkdown
  return html
    .replace(/<h[1-6][^>]*>/gi, "\n### ").replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<(td|th)[^>]*>/gi, "| ").replace(/<\/(td|th)>/gi, " ")
    .replace(/<\/tr>/gi, " |\n")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
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
    const url = `https://keirin.kdreams.jp/harailist/${y}/${mo}/${d}/`;
    try {
      const html = await get(url);
      Object.assign(results, parseHaraiList(toMd(html)));
      const withP2 = Object.values(results).filter((r) => r.p2pay != null).length;
      console.log("払戻一覧取得:", dH, "→", Object.keys(results).length, "レース確定(うち2車単", withP2, "件)");
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
    if (!r || r.first == null) continue; // 3連単着順が未確定なら次回実行で拾う
    const { first: f, second: s, third: t, p3pay, p2pay } = r;
    hist.entries.push({
      id, date: d8, place: x.place, raceNo: x.raceNo, klass: x.klass,
      score: x.score, verdict: x.verdict, pattern: x.pattern,
      f, s, t, p3pay, p2pay: p2pay != null ? p2pay : null,
      suji: sujiHit(x.lines, f, s),
      honmeiWin: !!(x.marksCars && x.marksCars[0] === f),
      honmeiRen: !!(x.marksCars && (x.marksCars[0] === f || x.marksCars[0] === s)),
      n2cnt: (x.nishatan || []).length, n2hit: (x.nishatan || []).includes(f + "-" + s),
      n3cnt: (x.sanrentan || []).length, n3hit: (x.sanrentan || []).includes(f + "-" + s + "-" + t),
      ranks: x.marksCars || [], gap: x.gap != null ? x.gap : null,
      riders: x.riders || null, lines: x.lines || null,
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
  // 日別サマリを作る補助(勝負レース=学習した勝ちパターン該当は sim.json 依存のためここでは全体成績のみ)
  // ---- 学習戦略(sim.json)を過去エントリに遡及適用して成績を出す ----
  let SIMD = null;
  try { SIMD = JSON.parse(fs.readFileSync(path.join(dir, "sim.json"), "utf8")); } catch (e) {}
  const PATS = SIMD ? ((SIMD.allPatterns && SIMD.allPatterns.length ? SIMD.allPatterns : SIMD.winners) || []) : [];
  const p3x = (fsArr, ss, ts) => { const o = new Set(); for (const a of fsArr) for (const b of ss) for (const c of ts) { if (a === b || b === c || a === c) continue; o.add(a + "-" + b + "-" + c); } return [...o]; };
  const lof = (lines, c) => (lines || []).find((l) => l.includes(c)) || null;
  const sjm = (lines, c) => { const l = lof(lines, c); if (!l || l.length < 2) return []; const i = l.indexOf(c); const o = []; if (i > 0) o.push(l[i - 1]); if (i < l.length - 1) o.push(l[i + 1]); return o; };
  const BLD = {
    p_1_234: (r) => p3x([r[0]], [r[1], r[2], r[3]], [r[1], r[2], r[3]]),
    p_1_2345: (r) => p3x([r[0]], [r[1], r[2], r[3], r[4]], [r[1], r[2], r[3], r[4]]),
    p_1_234_2345: (r) => p3x([r[0]], [r[1], r[2], r[3]], [r[1], r[2], r[3], r[4]]),
    p_12_1234: (r) => p3x([r[0], r[1]], [r[0], r[1], r[2], r[3]], [r[0], r[1], r[2], r[3]]),
    p_box123: (r) => p3x([r[0], r[1], r[2]], [r[0], r[1], r[2]], [r[0], r[1], r[2]]),
    p_1_23: (r) => p3x([r[0]], [r[1], r[2]], [r[1], r[2]]),
    p_1_23_234: (r) => p3x([r[0]], [r[1], r[2]], [r[1], r[2], r[3]]),
    p_12_123_12345: (r) => p3x([r[0], r[1]], [r[0], r[1], r[2]], [r[0], r[1], r[2], r[3], r[4]]),
    p_box1234: (r) => p3x([r[0], r[1], r[2], r[3]], [r[0], r[1], r[2], r[3]], [r[0], r[1], r[2], r[3]]),
    p_suji_main: (r, L) => { const m = sjm(L, r[0]); return m.length ? p3x([r[0]], m, [r[1], r[2], r[3]]) : []; },
    p_suji_plus: (r, L) => { const m = sjm(L, r[0]); return p3x([r[0]], [...new Set([...m, r[1]])], [r[1], r[2], r[3]]); },
    p_line12: (r, L) => { const l = lof(L, r[0]); if (!l || l.length < 2) return []; const o = new Set(); for (const a of l) for (const b of l) { if (a === b) continue; for (const c of [r[1], r[2], r[3]]) if (c !== a && c !== b) o.add(a + "-" + b + "-" + c); } return [...o]; },
    p_suji_wide: (r, L) => { const m = sjm(L, r[0]); return m.length ? p3x([r[0]], m, [r[1], r[2], r[3], r[4]]) : []; },
    p_suji_rev: (r, L) => { const m = sjm(L, r[0]); return m.length ? p3x(m, [r[0]], [r[1], r[2], r[3]]) : []; },
    p_suji_both: (r, L) => { const m = sjm(L, r[0]); if (!m.length) return []; return [...new Set([...p3x([r[0]], m, [r[1], r[2], r[3]]), ...p3x(m, [r[0]], [r[1], r[2], r[3]])])]; },
  };
  const condOk = (cond, e) => {
    if (cond.scoreMin != null && !((e.score || 0) >= cond.scoreMin)) return false;
    if (cond.gapMin != null && !(e.gap != null && e.gap >= cond.gapMin)) return false;
    if (cond.klass && e.klass !== cond.klass) return false;
    if (cond.notKlass && e.klass === cond.notKlass) return false;
    if (cond.verdict && e.verdict !== cond.verdict) return false;
    if (cond.verdictIn && !cond.verdictIn.includes(e.verdict)) return false;
    return true;
  };
  const stratEval = (e) => {
    if (!PATS.length || !Array.isArray(e.ranks) || e.ranks.length < 4) return null;
    for (const w of PATS) {
      const b = BLD[w.patternId];
      if (!b || !condOk(w.cond || {}, e)) continue;
      const t = b(e.ranks, e.lines);
      if (!t.length) continue;
      const hit = t.includes(e.f + "-" + e.s + "-" + e.t);
      return { cnt: t.length, hit, pay: hit ? e.p3pay : 0, shoubu: w.roi >= 100 };
    }
    return null;
  };
  const summarize = (arr) => {
    if (!arr.length) return null;
    const bet = arr.reduce((a, e) => a + (e.n3cnt || 0), 0);
    const ret = arr.reduce((a, e) => a + (e.n3hit ? e.p3pay : 0), 0);
    return {
      races: arr.length,
      honmeiWin: rate(arr.filter((e) => e.honmeiWin).length, arr.length),
      honmeiRen: rate(arr.filter((e) => e.honmeiRen).length, arr.length),
      sujiRate: rate(arr.filter((e) => e.suji).length, arr.length),
      hit: rate(arr.filter((e) => e.n3hit).length, arr.length),
      roi: rate(ret, bet * 100),
      bet: bet * 100, ret,
      profit: ret - bet * 100,
      hits: arr.filter((e) => e.n3hit).map((e) => ({ place: e.place, raceNo: e.raceNo, pay: e.p3pay })).sort((a, b) => b.pay - a.pay).slice(0, 5),
      ...(function () { // 学習戦略(最良構成)全体と、勝負レース(ROI100%超該当)のみの成績
        if (!PATS.length) return {};
        let sb = 0, sr = 0, shC = 0, sn = 0, shb = 0, shr = 0, shhC = 0, shn = 0;
        const shHits = [];
        for (const e of arr) {
          const v = stratEval(e);
          if (!v) continue;
          sn++; sb += v.cnt * 100; sr += v.pay; if (v.hit) shC++;
          if (v.shoubu) { shn++; shb += v.cnt * 100; shr += v.pay; if (v.hit) { shhC++; shHits.push({ place: e.place, raceNo: e.raceNo, pay: e.p3pay }); } }
        }
        return {
          st: sn ? { races: sn, hit: rate(shC, sn), roi: rate(sr, sb), profit: sr - sb } : null,
          sh: shn ? { races: shn, hit: rate(shhC, shn), roi: rate(shr, shb), profit: shr - shb, hits: shHits.sort((a, b) => b.pay - a.pay).slice(0, 5) } : null,
        };
      })(),
    };
  };
  // 当日(JST)と直近日別
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const todayStr = jst.toISOString().slice(0, 10).replace(/-/g, "");
  const today = summarize(E.filter((e) => e.date === todayStr));
  // 直近7日ぶんの日別成績
  const byDate = {};
  for (const e of E) (byDate[e.date] = byDate[e.date] || []).push(e);
  const recentDays = Object.keys(byDate).sort().reverse().slice(0, 7).map((d) => ({ date: d, ...summarize(byDate[d]) }));

  const stats = {
    updatedAt: new Date().toISOString(),
    total: E.length,
    honmeiWin: rate(E.filter((e) => e.honmeiWin).length, E.length),
    honmeiRen: rate(E.filter((e) => e.honmeiRen).length, E.length),
    sujiOverall: rate(E.filter((e) => e.suji).length, E.length),
    buckets,
    nishatan: { hit: rate(E.filter((e) => e.n2hit).length, E.length), roi: null },
    sanrentan: { hit: rate(E.filter((e) => e.n3hit).length, E.length), roi: rate(n3ret, n3bet * 100) },
    todayDate: todayStr,
    overall: (function () { const o = summarize(E); return o ? { st: o.st || null, sh: o.sh || null } : null; })(),
    today,          // 当日成績(無ければnull)
    recentDays,     // 直近7日の日別成績
  };
  fs.writeFileSync(path.join(dir, "stats.json"), JSON.stringify(stats));
  console.log("stats: 累計" + E.length + "R / 当日" + (today ? today.races + "R 回収率" + today.roi + "%" : "データなし"));
}

main().catch((e) => { console.error(e); process.exit(1); });
