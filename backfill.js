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
// 学習補正(learn.jsが生成)。無ければ補正なしで動作
let LEARN_W = null;
try { LEARN_W = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "weights.json"), "utf8")); console.log("学習補正を適用:", LEARN_W.updatedAt); } catch (e) {}

const UA = "keirin-local-app (personal use; backfill)";
const CONCURRENCY = 3;          // 同時リクエスト数
const WAIT_MS = 400;            // 各ワーカー内の最小間隔
const FETCH_TIMEOUT = 15000;
const MAX_RETRY = 2;            // レート制限(429/503)時のリトライ回数
const DEADLINE_MS = 5.5 * 60 * 60 * 1000; // 5.5時間(Actions上限6時間の手前)で打ち切り
const startedAt = Date.now();
const VENUE_PIDS = [11,12,13,21,22,23,24,25,26,27,28,31,32,34,35,36,37,38,42,43,44,45,46,47,48,51,53,54,55,56,61,62,63,71,73,74,75,81,83,84,85,86,87];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getOnce(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: ctrl.signal });
    if (res.status === 429 || res.status === 503) { const e = new Error(res.status); e.retryable = true; throw e; }
    if (!res.ok) throw new Error(res.status);
    return await res.text();
  } finally { clearTimeout(t); }
}
async function get(url) {
  for (let attempt = 0; ; attempt++) {
    try { return await getOnce(url); }
    catch (e) {
      if (e.retryable && attempt < MAX_RETRY) { await sleep(1500 * (attempt + 1)); continue; }
      throw e;
    }
  }
}
// 汎用の並列プール: items を worker で同時CONCURRENCY本処理
async function pool(items, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
      await sleep(WAIT_MS);
    }
  });
  await Promise.all(runners);
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
  const r = predict(p, bank, p.place, LEARN_W);
  const sx = sujiExpect(p, r, bank ? bank[10] : null);
  // 選手詳細: [車番, 年齢, 期, 位置(0=先頭1=番手2=3番手以降3=単騎), 評価順位, 総合点]
  const posOf = {};
  for (const l of p.lines) {
    if (l.length === 1) posOf[l[0]] = 3;
    else l.forEach((c, li) => { posOf[c] = Math.min(li, 2); });
  }
  const rankOf = {};
  r.scores.forEach((sc, ri) => (rankOf[sc.car] = ri + 1));
  const riders = p.entries.map((en) => [
    en.car, en.age || 0, parseInt(en.ki) || 0, posOf[en.car] ?? 3, rankOf[en.car] || 9,
    +(r.scores.find((sc) => sc.car === en.car)?.total || 0).toFixed(1),
  ]);
  return {
    place: p.place, raceNo: p.raceNo, klass: r.klass, pattern: r.linePattern,
    score: sx ? sx.score : null, verdict: sx ? sx.verdict : "対象外",
    lines: p.lines, marksCars: r.marks.map((mk) => mk.car),
    sanrentan: r.bets.sanrentan, riders,
    gap: r.scores && r.scores[1] ? +(r.scores[0].total - r.scores[1].total).toFixed(1) : null,
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
    const hurl = `https://keirin.kdreams.jp/harailist/${y}/${mo}/${d}/`;
    try {
      const hhtml = await get(hurl);
      results = parseHaraiList(toMd(hhtml));
      if (!global.__hdbg) {
        global.__hdbg = true;
        console.log("DEBUG harai url:", hurl);
        console.log("DEBUG htmlLen:", hhtml.length, "has競輪:", /競輪/.test(hhtml), "hasrefund:", /class="refund"/.test(hhtml), "parsed:", Object.keys(results).length);
        console.log("DEBUG head:", hhtml.slice(0, 300).replace(/\s+/g, " "));
      }
    } catch (e) { console.error("harai skip:", dH, "err=", e.message); continue; }
    if (!Object.keys(results).length) { console.log(dH, "確定レースなし(parsed 0)"); continue; }

    // 2) 全pid × 全R(1..12)を候補化。全国の全開催場を確実にカバーし、結果一覧に無いものは後で捨てる
    const urls = [];
    for (const pid of VENUE_PIDS) {
      for (let rno = 1; rno <= 12; rno++) {
        urls.push({ pid, rno, url: `https://gamboo.jp/keirin/yoso/?rdt=${dH}&pid=${pid}&rno=${rno}` });
      }
    }
    let dayAdded = 0;
    let gErr = {}, gOk = 0, gEmpty = 0;
    await pool(urls, async (item) => {
      if (Date.now() - startedAt > DEADLINE_MS) return;
      let pr = null;
      try {
        const gh = await get(item.url);
        if (gh.length === 0 || !/基本出走データ/.test(gh)) {
          gEmpty++;
          if (gh.length === 0) { global.__emptyStreak = (global.__emptyStreak || 0) + 1; }
          if (!global.__gdbg) { global.__gdbg = true; console.log("DEBUG gamboo url:", item.url, "len:", gh.length, "has基本出走:", /基本出走/.test(gh)); }
          // 空ページ(len0)が15連続=ブロック兆候 → 30秒クールダウン
          if ((global.__emptyStreak || 0) >= 15) { console.log("ブロック兆候: 30秒待機"); await sleep(30000); global.__emptyStreak = 0; }
        } else { global.__emptyStreak = 0; }
        pr = predictOne(gh, item.url);
        if (pr) gOk++;
      } catch (e) { gErr[e.message] = (gErr[e.message] || 0) + 1; }
      if (!pr) return;
      const res = results[pr.place + "_" + pr.raceNo];
      if (!res) {
        if (!global.__mdbg) { global.__mdbg = true;
          console.log("DEBUG 照合NG 予想キー:", pr.place + "_" + pr.raceNo, "/ 結果側キー例:", Object.keys(results).slice(0, 8).join(", "));
        }
        return;
      }
      const eid = dH.replace(/-/g, "") + "_" + pr.place + "_" + pr.raceNo;
      if (done.has(eid)) return;
      const { first: f, second: s, third: t, p3pay } = res;
      hist.entries.push({
        id: eid, date: dH.replace(/-/g, ""), place: pr.place, raceNo: pr.raceNo, klass: pr.klass,
        score: pr.score, verdict: pr.verdict, pattern: pr.pattern, f, s, t, p3pay, p2pay: res.p2pay != null ? res.p2pay : null,
        suji: sujiHit(pr.lines, f, s),
        honmeiWin: pr.marksCars[0] === f, honmeiRen: pr.marksCars[0] === f || pr.marksCars[0] === s,
        n3cnt: pr.sanrentan.length, n3hit: pr.sanrentan.includes(f + "-" + s + "-" + t),
        ranks: pr.marksCars, gap: pr.gap, riders: pr.riders, lines: pr.lines,
      });
      done.add(eid); added++; dayAdded++;
    });
    console.log(dH, "→", dayAdded, "レース追加 (予想成功" + gOk + " 空" + gEmpty + " エラー" + JSON.stringify(gErr) + ")");
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
      bet: bet * 100, ret, profit: ret - bet * 100,
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
  const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const todayStr = jstNow.toISOString().slice(0, 10).replace(/-/g, "");
  const todayS = summarize(E.filter((e) => e.date === todayStr));
  const byDate = {};
  for (const e of E) (byDate[e.date] = byDate[e.date] || []).push(e);
  const recentDays = Object.keys(byDate).sort().reverse().slice(0, 7).map((d) => ({ date: d, ...summarize(byDate[d]) }));

  const stats = {
    updatedAt: new Date().toISOString(), total: E.length,
    todayDate: todayStr, today: todayS, recentDays,
    overall: (function () { const o = summarize(E); return o ? { st: o.st || null, sh: o.sh || null } : null; })(),
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
