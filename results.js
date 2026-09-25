// ============================================================
// GambooBETの払戻金一覧(日別1ページ)から全レース結果を取得し、
// 予想との答え合わせを history.json / stats.json に蓄積する
// 使い方: node results.js
// ============================================================
const fs = require("fs");
const path = require("path");
const { f3PlanFrom } = require("./engine.js");

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
  // 【方針】① まず「○○競輪」でブロック分割 → ② 各ブロック内で行の開始位置を全部拾い、
  //   ③ 行ごとに独立した区間として読む。
  //   1つの正規表現で通し読みすると、配当が空の行(未発売等)で次の配当まで走ってしまい、
  //   飛び越えた行がまるごと失われる(3連単が23レース欠ける等の原因)。
  const parts = html.split(/([぀-ヿ一-龥]{2,5})競輪/);
  for (let i = 1; i < parts.length; i += 2) {
    const venue = parts[i];
    const block = parts[i + 1] || "";
    // 行の開始位置(レース番号セル)を全部列挙
    const heads = [];
    const raceRe = /class="race"[^>]*>\s*(\d{1,2})R/g;
    let hm;
    while ((hm = raceRe.exec(block))) heads.push({ pos: hm.index, rno: hm[1] });
    for (let k = 0; k < heads.length; k++) {
      // 次の行の開始までを1行分として切り出す(最後の行は1500字まで)
      const segEnd = k + 1 < heads.length ? heads[k + 1].pos : Math.min(block.length, heads[k].pos + 1500);
      const seg = block.slice(heads[k].pos, segEnd);
      // 配当セルはタグごと取り出し、タグを剥がしてから数字を拾う。
      // 高額配当は <span class="attention">58,560</span> のようにタグで囲まれるため、
      // 「> の直後が数字」を前提にすると、高配当の行だけ選択的に取りこぼす。
      // これが3連単の取得率が6割だった原因(2車単も100倍超だとレースごと欠落していた)。
      const payM = seg.match(/class="refund"[^>]*>([\s\S]*?)<\/td>/);
      if (!payM) continue;
      const payNum = payM[1].replace(/<[^>]*>/g, " ").match(/([\d,]+)/);
      if (!payNum) continue;                     // 配当なし(未発売・未確定)はスキップ
      const ordM = seg.match(/class="order"([\s\S]*?)<\/td>/);
      if (!ordM) continue;
      const chunk = ordM[1];
      const pay = +payNum[1].replace(/,/g, "");
      const cars = [...chunk.matchAll(/class="n(\d)"[^>]*>\s*(\d)\s*</g)].map((x) => +x[2]);
      if (!cars.length || !pay) continue;
      // 賭式は区切り文字で判別: "-"=順序あり(3連単/2車単) / "="=順序なし(複式)は無視。
      // 複式は着順ではなく番号順に並ぶため、取り込むと着順データまで壊れる。
      const syms = [...chunk.matchAll(/class="symbol"[^>]*>([\s\S]{0,8}?)<\//g)].map((x) => x[1]);
      // 記号の個数が「車数 - 1」と合わない行は判別不能なので捨てる。
      // これが無いと syms が空のとき素通りし、複式が単式として取り込まれる(着順が番号順に化ける)。
      if (syms.length !== cars.length - 1) continue;
      if (syms.some((s) => s.includes("=") || s.includes("＝"))) continue;
      const key = venue + "_" + heads[k].rno + "R";
      const o = (out[key] = out[key] || {});
      if (cars.length === 3 && o.first == null) {
        o.first = cars[0]; o.second = cars[1]; o.third = cars[2]; o.p3pay = pay;
      } else if (cars.length === 2 && o.p2pay == null) {
        o.p2pay = pay; o.p2first = cars[0]; o.p2second = cars[1];
      }
    }
  }
  return out;
}
function toMd(html) { return html; } // 生HTMLをそのまま parseHaraiList に渡す(互換のため関数は残す)

// レース日を "YYYY-MM-DD" で返す。取れなければ null。
// 2026-08-28の楽天Kドリームス移行で races.json の url から rdt= が消えた。
// url だけを見ていたため 8/26〜9/21 のあいだ baseDates が空になり、
// 払戻一覧を1ページも取りに行かず history.json に1件も追加されていなかった。
// ★kdreamsの16桁IDに入っている日付は「開催初日」なので使ってはいけない。
//   例: 広島 6220260920020001 は 2026-09-21 のレース(IDは 20260920)。
//   races.json の date("2026年09月21日") を正とする。
const raceDate = (x) => {
  const m = String(x.url || "").match(/rdt=(\d{4}-\d{2}-\d{2})/);      // Gamboo時代のraces.json
  if (m) return m[1];
  const j = String(x.date || "").match(/(\d{4})年(\d{1,2})月(\d{1,2})日/); // kdreams
  if (j) return j[1] + "-" + j[2].padStart(2, "0") + "-" + j[3].padStart(2, "0");
  const i = String(x.date || "").match(/^\d{4}-\d{2}-\d{2}$/);          // 念のため
  if (i) return i[0];
  return null;
};

const sujiHit = (lines, f, s) => (lines || []).some((l) => {
  for (let i = 0; i + 1 < l.length; i++) {
    if ((l[i] === f && l[i + 1] === s) || (l[i] === s && l[i + 1] === f)) return true;
  }
  return false;
});

// 払戻一覧の1レース分を使える形にそろえる。使えるなら true。
// 3連単が取れなくても、2車単の並びが「1着-2着」なので記録できる。
const normalizeResult = (r) => {
  if (r.first == null && r.p2first != null) { r.first = r.p2first; r.second = r.p2second; r.third = null; r.p3pay = null; }
  return r.first != null;   // false = 着順がまだ確定していない
};

// history.json の1エントリを作る。
// ★results.js と gitfill.js で必ず同じ形を書くため、ここに1箇所だけ置いて共有する。
//   2026-08-28の移行では同じロジックが複数ファイルに散っていたせいで
//   results.js だけが取り残された。同じ事故を繰り返さないこと。
function makeEntry(x, r, d8) {
  const { first: f, second: s, third: t, p3pay, p2pay } = r;
  return {
    id: d8 + "_" + x.key, date: d8, place: x.place, raceNo: x.raceNo, klass: x.klass, grade: x.grade || "",
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
}

async function main() {
  const dir = __dirname;
  const races = JSON.parse(fs.readFileSync(path.join(dir, "races.json"), "utf8")).races || [];
  const histPath = path.join(dir, "history.json");
  const hist = fs.existsSync(histPath) ? JSON.parse(fs.readFileSync(histPath, "utf8")) : { entries: [] };
  const done = new Set(hist.entries.map((e) => e.id));

  // --stats-only: 払戻の取得と history.json の書き込みを飛ばし、stats.json だけ作り直す。
  // results.yml で sanpuku.js が3連複配当を追記した「後」に、もう一度回すため
  // (これが無いと、成績に載る直近1日の3連複配当が次の晩まで空のままになる)。
  const STATS_ONLY = process.argv.includes("--stats-only");
  // races.json内の日付を集めて、日付ごとに払戻一覧を1回取得
  const baseDates = [...new Set(races.map(raceDate).filter(Boolean))];
  // レース日が1件も取れないのは取得元の形式が変わったとき。黙って0件追加を続けないよう、ここで落とす。
  if (races.length && !baseDates.length) {
    console.error("レース日を1件も特定できません。races.json の url / date の形式が変わった可能性があります。");
    console.error("先頭レース:", JSON.stringify({ url: races[0].url, date: races[0].date }));
    process.exit(1);
  }
  // races.jsonの日付 + その前日 も一覧を見る(ナイター開催は結果一覧が前日ページに載るため)
  const dateSet = new Set(baseDates);
  for (const dH of baseDates) {
    const dt = new Date(dH + "T00:00:00Z"); dt.setUTCDate(dt.getUTCDate() - 1);
    dateSet.add(dt.toISOString().slice(0, 10));
  }
  const dates = STATS_ONLY ? [] : [...dateSet];
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
    const dH = raceDate(x);
    if (!dH) continue;
    const d8 = dH.replace(/-/g, "");
    const id = d8 + "_" + x.key;
    const r = results[d8 + "_" + x.place + "_" + x.raceNo]; // 開催日が一致する結果だけを使う
    // 3連単が取れなくても、2車単の並びが「1着-2着」なので記録できる
    if (!r) continue;
    if (!normalizeResult(r)) continue; // 着順がまだ確定していない
    if (done.has(id)) {
      // 既存レース: 2車単配当が未設定なら追記
      if (r.p2pay != null) { const ex = entryById.get(id); if (ex && ex.p2pay == null) { ex.p2pay = r.p2pay; p2added++; } }
      continue;
    }
    const f = r.first, s = r.second, t = r.third, p3pay = r.p3pay;
    const newEntry = makeEntry(x, r, d8);
    hist.entries.push(newEntry);
    entryById.set(id, newEntry);
    added++;
    console.log("RESULT:", x.place, x.raceNo, f + "-" + s + "-" + t, p3pay + "円",
      "スジ:" + (sujiHit(x.lines, f, s) ? "○" : "×"));
  }
  if (p2added) console.log("既存", p2added, "件に2車単配当を追記");

  // ---- 件数上限は撤廃(2026-07-29)----
  // 以前ここに `if (hist.entries.length > 8000) hist.entries = hist.entries.slice(-8000);` があった。
  // これが過去4回の大量消失の原因:
  //   7/26 02:15  9877 → 8000  (-1877)
  //   7/26 12:18 11170 → 8000  (-3170)  ← 引き継ぎメモの「3,000件消失」はこれ
  //   7/26 14:00  8726 → 8000  ( -726)
  //   7/27 06:05 10059 → 8000  (-2059)  ← 5月分の復旧と3連複配当が消えた
  // 「同時実行による消失」と診断していたが誤り。concurrency では防げない。
  // slice(-8000) は末尾を残すので、消えるのは常に先頭 = 最も古いレース。
  // 再び絞る必要が出たら、件数ではなく日付で切ること(古い順に切ると復旧分が失われる)。
  console.log("history 件数:", hist.entries.length);
  if (!STATS_ONLY) fs.writeFileSync(histPath, JSON.stringify(hist));
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
    if (cond.scoreMax != null && !((e.score || 0) < cond.scoreMax)) return false;
    if (cond.gapMax != null && !(e.gap != null && e.gap < cond.gapMax)) return false;
    if (cond.patternRe && !(e.pattern && new RegExp(cond.patternRe).test(e.pattern))) return false;
    if (cond.lineSizeMin != null || cond.lineSizeEq != null || cond.topIsHead != null || cond.topNotTail != null) {
      const l0 = (e.lines || []).find((x) => x.includes((e.ranks || [])[0]));
      if (cond.lineSizeMin != null && !(l0 && l0.length >= cond.lineSizeMin)) return false;
      if (cond.lineSizeEq != null && !(l0 && l0.length === cond.lineSizeEq)) return false;
      if (cond.topIsHead != null) {
        const isHead = !!(l0 && l0.length >= 2 && l0[0] === e.ranks[0]);
        if (isHead !== cond.topIsHead) return false;
      }
      if (cond.topNotTail === true) {
        const isTail = !!(l0 && l0.length >= 2 && l0[l0.length - 1] === e.ranks[0]);
        if (isTail) return false; // 本命がライン最後尾のレースは対象外
      }
    }
    if (cond.gradeRe && !(e.grade && new RegExp(cond.gradeRe).test(e.grade))) return false;
    if (cond.notGradeRe && e.grade && new RegExp(cond.notGradeRe).test(e.grade)) return false;
    if (cond.verdictIn && !cond.verdictIn.includes(e.verdict)) return false;
    return true;
  };
  const adjCache = new Map();
  const isShoubuPat = (w) => (w.shoubu != null ? !!w.shoubu : (w.roi >= 105 && w.races >= 300));
  const SH_PATS = PATS.filter(isShoubuPat);
  const stratEval = (e) => {
    // まず勝負採用構成だけで判定(アプリの🔥と同一基準)。無ければ全構成で参考評価。
    const v = evalWith(SH_PATS, e, true);
    return v || evalWith(PATS, e, false);
  };
  const evalWith = (list, e, isShoubu) => {
    if (!list.length || !Array.isArray(e.ranks) || e.ranks.length < 4) return null;
    for (const w of list) {
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
      return { cnt: t.length, hit, pay, shoubu: isShoubu, betType: isN2 ? "nishatan" : "sanrentan" };
    }
    return null;
  };
  // TOP構成(回収率最大の1構成)だけを評価: バックテストの数字と一対一で比較するため
  const TOP = SH_PATS.length ? SH_PATS[0] : null;
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
  // ---- いま実際に買っている方法(3連複・本命ライン3人)の答え合わせ ----
  // sim.json 由来の stratEval / topEval は総当たり構成を評価するもので、
  // アプリが 2026-09 に採用をやめた古い戦略。成績カードがそちらを映したままだと
  // 「表示されている数字」と「買っている買い目」が別物になるので、こちらを足す。
  // ranks は上位6人しか入っておらず車立てを誤るため、riders から並べ直す。
  const rankedOf = (e) => {
    if (Array.isArray(e.riders) && e.riders.length) {
      return [...e.riders].sort((a, b) => (a[4] || 99) - (b[4] || 99)).map((r) => r[0]);
    }
    return Array.isArray(e.ranks) ? e.ranks : [];
  };
  const f3Eval = (e) => {
    if (e.p3fpay == null || e.f == null || e.s == null || e.t == null) return null;
    const rk = rankedOf(e);
    if (rk.length < 4 || !Array.isArray(e.lines)) return null;
    const pl = f3PlanFrom(rk, e.lines);
    if (!pl || !pl.trio) return null;
    const hit = [e.f, e.s, e.t].sort((a, b) => a - b).join("=") === pl.ticket;
    return { hot: !!pl.hot, cars: pl.cars, needOdds: !!pl.needOdds, hit, pay: hit ? e.p3fpay : 0 };
  };
  // 1点100円を1レース1点だけ買う前提なので、bet = レース数 * 100。
  const f3Group = (arr, pick) => {
    let n = 0, ret = 0, hitN = 0; const hits = [];
    for (const e of arr) {
      const v = f3Eval(e);
      if (!v || !pick(v)) continue;
      n++; ret += v.pay;
      if (v.hit) { hitN++; hits.push({ place: e.place, raceNo: e.raceNo, pay: v.pay }); }
    }
    if (!n) return null;
    return {
      races: n, hit: rate(hitN, n), roi: rate(ret, n * 100), profit: ret - n * 100,
      hits: hits.sort((a, b) => b.pay - a.pay).slice(0, 5),
    };
  };

  const summarize = (arr) => {
    if (!arr.length) return null;
    const bet = arr.reduce((a, e) => a + (e.n3cnt || 0), 0);
    const ret = arr.reduce((a, e) => a + (e.n3hit ? e.p3pay : 0), 0);
    return {
      races: arr.length,
      // 🔥7車は「オッズ4〜15倍のときだけ買う」条件付きだが、過去分は当時のオッズを
      // 全期間ぶん持っていない。hot7 はその確認をせず全部買った場合の数字なので、
      // 実運用(帯内のみ)より低く出る。表示側でもそう断ること。
      f3: {
        hot: f3Group(arr, (v) => v.hot),
        hot9: f3Group(arr, (v) => v.hot && v.cars >= 8),
        hot7: f3Group(arr, (v) => v.hot && v.cars === 7),
        all: f3Group(arr, () => true),
      },
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
  // 当日と直近日別。
  // 「当日」は races.json のレース日。以前は実行時刻(JST)の日付を使っていたが、
  // 23:50 予定の定時実行が GitHub の遅れで日付をまたぐと、当日の結果が空になっていた。
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const todayStr = (baseDates.length ? baseDates.slice().sort().pop() : jst.toISOString().slice(0, 10)).replace(/-/g, "");
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
    overall: (function () { const o = summarize(E); return o ? { st: o.st || null, sh: o.sh || null, shTop: o.shTop || null, f3: o.f3 || null } : null; })(),
    today,          // 当日成績(無ければnull)
    // 本日の確定レース(アプリの勝負レースカードで結果を表示するため)
    todayRaces: E.filter((e) => e.date === todayStr).map((e) => ({
      place: e.place, raceNo: e.raceNo, f: e.f, s: e.s, t: e.t,
      p2pay: e.p2pay != null ? e.p2pay : null, p3pay: e.p3pay != null ? e.p3pay : null,
      p3fpay: e.p3fpay != null ? e.p3fpay : null,   // アプリの🔥カードは3連複の配当を読む
    })),
    // 直近7日の🔥レース1件ずつの結果(アプリの成績タブで一覧にする)。
    // 配当が null は「当たったが3連複の配当がまだ取れていない」。
    recentHot: (function () {
      const days = Object.keys(byDate).sort().reverse().slice(0, 7);
      const out = [];
      for (const d of days) for (const e of byDate[d]) {
        if (e.f == null || e.s == null) continue;
        const rk = rankedOf(e);
        if (rk.length < 4 || !Array.isArray(e.lines)) continue;
        const pl = f3PlanFrom(rk, e.lines);
        if (!pl || !pl.hot || !pl.trio) continue;
        const done = e.t != null;
        const hit = done && [e.f, e.s, e.t].sort((a, b) => a - b).join("=") === pl.ticket;
        out.push({ date: e.date, place: e.place, raceNo: e.raceNo, cars: pl.cars, ticket: pl.ticket, needOdds: !!pl.needOdds,
          order: e.f + "-" + e.s + "-" + (done ? e.t : "?"), hit, pay: hit ? (e.p3fpay != null ? e.p3fpay : null) : 0 });
      }
      const rn = (x) => parseInt(x.raceNo, 10) || 0;
      return out.sort((a, b) => b.date.localeCompare(a.date) || a.place.localeCompare(b.place) || rn(a) - rn(b));
    })(),
    recentDays,     // 直近7日の日別成績
  };
  fs.writeFileSync(path.join(dir, "stats.json"), JSON.stringify(stats));
  console.log("stats: 累計" + E.length + "R / 当日" + (today ? today.races + "R 回収率" + today.roi + "%" : "データなし"));
}

// 直接実行したときだけ走らせる(gitfill.js から require して部品を使い回すため)
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { get, parseHaraiList, sujiHit, raceDate, normalizeResult, makeEntry };
