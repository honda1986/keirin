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

// 払戻一覧HTML → { "場名_nR": {first,second,third,p3pay,p2pay} }
// 実構造(kdreams harailist): 賭式ごとにテーブルがあり、各行は
//   <td class="race">1R</td>
//   <td class="order"><p class="num"><span class="n1">1</span><span class="symbol">-</span><span class="n3">3</span>...</p></td>
//   <td class="refund">12,130</td>
// span.nX の X が車番。span数=3なら3連単、=2なら2車単。ページ上部が3連単→順に2車単…と並ぶ。
// レースキーは直近の「○○競輪」見出し。同一キーに3連単(p3pay)と2車単(p2pay)をマージする。
function parseHaraiList(html) {
  const out = {};
  // 「○○競輪」見出しと各レース行を出現順に走査し、直近の場名を保持
  // トークン列: 場名マーカー or レース行
  // 注: ギャップは {0,N}? で上限を設ける。無制限の [\s\S]*? だと未確定行(配当なし)が多い時間帯に
  // バックトラックが爆発してハングするため(1行のrace→order→refundは実HTMLで数百文字以内)。
  const tokenRe = /([぀-ヿ一-龥]{2,5})競輪|class="race"[^>]*>\s*(\d{1,2})R[\s\S]{0,300}?class="order"([\s\S]{0,600}?)<\/td>[\s\S]{0,200}?class="refund"[^>]*>\s*([\d,]+)/g;
  let m, venue = null;
  while ((m = tokenRe.exec(html))) {
    if (m[1]) { venue = m[1]; continue; }       // 場名見出し
    if (!venue) continue;
    const rno = m[2];
    const orderChunk = m[3];
    const pay = +m[4].replace(/,/g, "");
    // span.nX から車番を順に抽出(symbolは無視)
    const cars = [...orderChunk.matchAll(/class="n(\d)"[^>]*>\s*(\d)\s*</g)].map((x) => +x[2]);
    if (!cars.length || !pay) continue;
    const key = venue + "_" + rno + "R";
    const o = (out[key] = out[key] || {});
    if (cars.length === 3 && o.first == null) {
      o.first = cars[0]; o.second = cars[1]; o.third = cars[2]; o.p3pay = pay;
    } else if (cars.length === 2 && o.p2pay == null) {
      o.p2pay = pay; o.p2first = cars[0]; o.p2second = cars[1];
    }
  }
  return out;
}
function toMd(html) { return html; } // 生HTMLをそのまま parseHaraiList に渡す(互換のため関数は残す)

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
  // 結果キーは「日付8桁_場名_nR」。ページ日付をキーに含めることで、
  // 別日の同場・同レース番号の結果が未出走レースに誤って紐付く事故を防ぐ。
  const results = {};
  for (const dH of dates) {
    const [y, mo, d] = dH.split("-");
    const url = `https://keirin.kdreams.jp/harailist/${y}/${mo}/${d}/`;
    try {
      const html = await get(url);
      const day = parseHaraiList(html);
      const d8p = dH.replace(/-/g, "");
      let cnt = 0, p2 = 0;
      for (const [k, v] of Object.entries(day)) {
        results[d8p + "_" + k] = v; cnt++;
        if (v.p2pay != null) p2++;
      }
      console.log("払戻一覧取得:", dH, "→", cnt, "レース確定(うち2車単", p2, "件)");
    } catch (e) { console.error("harai-list skip:", url, e.message); }
  }

  const entryById = new Map(hist.entries.map((e) => [e.id, e]));
  let added = 0, p2added = 0;
  for (const x of races) {
    const dH = ((x.url || "").match(/rdt=([\d-]+)/) || [])[1];
    if (!dH) continue;
    const d8 = dH.replace(/-/g, "");
    const id = d8 + "_" + x.key;
    const r = results[d8 + "_" + x.place + "_" + x.raceNo]; // 開催日が一致する結果だけを使う
    if (!r || r.first == null) continue; // 3連単着順が未確定なら次回実行で拾う
    if (done.has(id)) {
      // 既存レース: 2車単配当が未設定なら追記
      if (r.p2pay != null) { const ex = entryById.get(id); if (ex && ex.p2pay == null) { ex.p2pay = r.p2pay; p2added++; } }
      continue;
    }
    const { first: f, second: s, third: t, p3pay, p2pay } = r;
    const newEntry = {
      id, date: d8, place: x.place, raceNo: x.raceNo, klass: x.klass, grade: x.grade || "",
      score: x.score, verdict: x.verdict, pattern: x.pattern,
      f, s, t, p3pay, p2pay: p2pay != null ? p2pay : null,
      suji: sujiHit(x.lines, f, s),
      honmeiWin: !!(x.marksCars && x.marksCars[0] === f),
      honmeiRen: !!(x.marksCars && (x.marksCars[0] === f || x.marksCars[0] === s)),
      n2cnt: (x.nishatan || []).length, n2hit: (x.nishatan || []).includes(f + "-" + s),
      n3cnt: (x.sanrentan || []).length, n3hit: (x.sanrentan || []).includes(f + "-" + s + "-" + t),
      ranks: x.marksCars || [], gap: x.gap != null ? x.gap : null,
      riders: x.riders || null, lines: x.lines || null,
    };
    hist.entries.push(newEntry);
    entryById.set(id, newEntry);
    added++;
    console.log("RESULT:", x.place, x.raceNo, f + "-" + s + "-" + t, p3pay + "円",
      "スジ:" + (sujiHit(x.lines, f, s) ? "○" : "×"));
  }
  if (p2added) console.log("既存", p2added, "件に2車単配当を追記");

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
  // 学習補正(weights.json)を読み、riders素点から「補正後の評価順」をレースごとに再構築。
  // バックテスト(simulate.js)が [補正後] パターンで adjRanks を使うのと完全に一致させるため。
  let LW = null;
  try { LW = JSON.parse(fs.readFileSync(path.join(dir, "weights.json"), "utf8")); } catch (e) {}
  const kiBandA = (ki) => ki >= 121 ? "期121+(若手)" : ki >= 111 ? "期111-120" : ki >= 100 ? "期100-110" : ki > 0 ? "期99以下(ベテラン)" : null;
  const ageBandA = (a) => a > 0 && a <= 23 ? "23歳以下" : a > 0 && a <= 27 ? "24-27歳" : a > 0 && a <= 35 ? "28-35歳" : a > 35 ? "36歳以上" : null;
  const adjRanksOf = (e) => {
    if (!LW || !Array.isArray(e.riders) || e.riders.length < 5) return null;
    return e.riders.map((rd) => {
      const [car, age, ki, pos, , total] = rd;
      let b = 0;
      const pk = ["head", "second", "third", "tanki"][pos];
      if (LW.posBonus && LW.posBonus[pk]) b += LW.posBonus[pk];
      const kb = kiBandA(ki); if (kb && LW.kiBonus && LW.kiBonus[kb]) b += LW.kiBonus[kb];
      const ab = ageBandA(age); if (ab && LW.ageBonus && LW.ageBonus[ab]) b += LW.ageBonus[ab];
      return { car, t: (total || 0) + b };
    }).sort((x, y) => y.t - x.t).map((x) => x.car);
  };
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
    // 2車単ビルダー
    n2_1_23: (r) => p2x([r[0]], [r[1], r[2]]),
    n2_1_234: (r) => p2x([r[0]], [r[1], r[2], r[3]]),
    n2_box12: (r) => p2x([r[0], r[1]], [r[0], r[1]]),
    n2_1_2: (r) => p2x([r[0]], [r[1]]),
    n2_suji: (r, L) => { const m = sjm(L, r[0]); return m.length ? p2x([r[0]], m) : []; },
    n2_suji_both: (r, L) => { const m = sjm(L, r[0]); if (!m.length) return []; return [...new Set([...p2x([r[0]], m), ...p2x(m, [r[0]])])]; },
  };
  const p2x = (fsA, ssA) => { const o = new Set(); for (const a of fsA) for (const b of ssA) { if (a === b) continue; o.add(a + "-" + b); } return [...o]; };
  const condOk = (cond, e) => {
    if (cond.scoreMin != null && !((e.score || 0) >= cond.scoreMin)) return false;
    if (cond.gapMin != null && !(e.gap != null && e.gap >= cond.gapMin)) return false;
    if (cond.klass && e.klass !== cond.klass) return false;
    if (cond.notKlass && e.klass === cond.notKlass) return false;
    if (cond.verdict && e.verdict !== cond.verdict) return false;
    if (cond.notVerdict && e.verdict === cond.notVerdict) return false;
    if (cond.gradeRe && !(e.grade && new RegExp(cond.gradeRe).test(e.grade))) return false;
    if (cond.notGradeRe && e.grade && new RegExp(cond.notGradeRe).test(e.grade)) return false;
    if (cond.verdictIn && !cond.verdictIn.includes(e.verdict)) return false;
    return true;
  };
  const adjCache = new Map();
  const stratEval = (e) => {
    if (!PATS.length || !Array.isArray(e.ranks) || e.ranks.length < 4) return null;
    for (const w of PATS) {
      const b = BLD[w.patternId];
      if (!b || !condOk(w.cond || {}, e)) continue;
      const isN2 = w.betType === "nishatan" || /^n2_/.test(w.patternId);
      if (isN2 && e.p2pay == null) continue; // 2車単配当が無いレースは対象外
      // [補正後]パターンは補正後評価順を使う(バックテストと一致させる)
      // 保存ranksは既に学習補正込み(fetch/backfillがpredictにweightsを渡して予想)。
      // ここで再補正すると二重補正になりカードと不一致になるため、常に保存ranksを使う。
      const t = b(e.ranks, e.lines);
      if (!t.length) continue;
      const hitTicket = isN2 ? (e.f + "-" + e.s) : (e.f + "-" + e.s + "-" + e.t);
      const hit = t.includes(hitTicket);
      const pay = hit ? (isN2 ? e.p2pay : e.p3pay) : 0;
      return { cnt: t.length, hit, pay, shoubu: w.roi >= 100, betType: isN2 ? "nishatan" : "sanrentan" };
    }
    return null;
  };
  // TOP構成(回収率最大の1構成)だけを評価: バックテストの数字と一対一で比較するため
  const TOP = PATS.length && PATS[0].roi >= 100 ? PATS[0] : null;
  const topEval = (e) => {
    if (!TOP || !Array.isArray(e.ranks) || e.ranks.length < 4) return null;
    const b = BLD[TOP.patternId];
    if (!b || !condOk(TOP.cond || {}, e)) return null;
    const isN2 = TOP.betType === "nishatan" || /^n2_/.test(TOP.patternId);
    if (isN2 && e.p2pay == null) return null;
    const t = b(e.ranks, e.lines);
    if (!t.length) return null;
    const hitTicket = isN2 ? (e.f + "-" + e.s) : (e.f + "-" + e.s + "-" + e.t);
    const hit = t.includes(hitTicket);
    return { cnt: t.length, hit, pay: hit ? (isN2 ? e.p2pay : e.p3pay) : 0 };
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
        let shBet = "sanrentan";
        for (const e of arr) {
          const v = stratEval(e);
          if (!v) continue;
          sn++; sb += v.cnt * 100; sr += v.pay; if (v.hit) shC++;
          if (v.shoubu) { shn++; shb += v.cnt * 100; shr += v.pay; shBet = v.betType; if (v.hit) { shhC++; shHits.push({ place: e.place, raceNo: e.raceNo, pay: v.pay, betType: v.betType }); } }
        }
        // TOP構成のみ
        let tn = 0, tb = 0, tr = 0, th = 0;
        for (const e of arr) {
          const v = topEval(e);
          if (!v) continue;
          tn++; tb += v.cnt * 100; tr += v.pay; if (v.hit) th++;
        }
        return {
          st: sn ? { races: sn, hit: rate(shC, sn), roi: rate(sr, sb), profit: sr - sb } : null,
          sh: shn ? { races: shn, hit: rate(shhC, shn), roi: rate(shr, shb), profit: shr - shb, betType: shBet, hits: shHits.sort((a, b) => b.pay - a.pay).slice(0, 5) } : null,
          shTop: tn ? { races: tn, hit: rate(th, tn), roi: rate(tr, tb), profit: tr - tb, name: TOP ? TOP.patternName + " × " + TOP.filterName : "" } : null,
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
    overall: (function () { const o = summarize(E); return o ? { st: o.st || null, sh: o.sh || null, shTop: o.shTop || null } : null; })(),
    today,          // 当日成績(無ければnull)
    recentDays,     // 直近7日の日別成績
  };
  fs.writeFileSync(path.join(dir, "stats.json"), JSON.stringify(stats));
  console.log("stats: 累計" + E.length + "R / 当日" + (today ? today.races + "R 回収率" + today.roi + "%" : "データなし"));
}

main().catch((e) => { console.error(e); process.exit(1); });
