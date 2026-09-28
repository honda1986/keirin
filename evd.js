// ============================================================
// evd.js — モデルD: 3連複の全組の期待値(hikitsugi §4-12)。夜の集計・betplan.js(Node)とアプリ(index.html の <script src>)で共用
//
//   組の確率 p ∝ exp( K·x + lo2·(x−LO_MEAN)² + lo3·(x−LO_MEAN)³ + lo9·x·[8車以上] + Σ(3人の特徴·係数) )、x = log(1/オッズ)
//   を有効な全組で割り戻し、期待値 = p × オッズ。
//   ev.js(v2)との違い: オッズの曲がり(大穴ほど期待値を割り引く)・競走得点の順位と偏差・ラインの先頭 を足した。
//   2022〜2026年9月の作り直した出走表(pastcard)12.3万レースで学習。前の年までで学習→次の年で試すと、
//   「期待値1.1以上・10〜30倍」は 2023 127% / 2024 120% / 2025 123% / 2026 121%(確定オッズ)
//
//   ★買うのは PICK の条件(期待値≥1.1・10〜30倍)を満たす組のうち、期待値がいちばん高い1組(1レース1点)
//   ★係数を変えたら pastcard_eval.js などの分析(Python)と突き合わせること(node evdcheck.js)
// ============================================================
(function (root) {
  "use strict";
  const MODEL = { version: "D-2026-09b", LO_MEAN: -4.264394023053231, R120_MEAN: 0.42665,
    b: { K: 1.391487, er: 0.038258, single: -0.040133, banme: 0.009734, age50: 0.074828, home: 0.019843, young: 0.102161, samepref: 0.005997, dsc: -0.019869, has_dsc: -0.061401, r120: -0.013435, has_r: -4.4e-05, lo2: -0.146743, lo3: 0.019943, lo9: -0.021965, scz: 0.074352, head: 0.030399, srk: 0.037567 } };
  const PICK = { minEv: 1.1, oddsLo: 10, oddsHi: 30 };
  const VENUE_PREF = { "函館": "北海道", "青森": "青森", "いわき平": "福島", "弥彦": "新潟", "前橋": "群馬", "取手": "茨城", "宇都宮": "栃木",
    "大宮": "埼玉", "西武園": "埼玉", "京王閣": "東京", "立川": "東京", "松戸": "千葉", "千葉": "千葉", "川崎": "神奈川", "平塚": "神奈川",
    "小田原": "神奈川", "伊東": "静岡", "静岡": "静岡", "名古屋": "愛知", "岐阜": "岐阜", "大垣": "岐阜", "豊橋": "愛知", "富山": "富山",
    "松阪": "三重", "四日市": "三重", "福井": "福井", "奈良": "奈良", "向日町": "京都", "和歌山": "和歌山", "岸和田": "大阪", "玉野": "岡山",
    "広島": "広島", "防府": "山口", "高松": "香川", "小松島": "徳島", "高知": "高知", "松山": "愛媛", "小倉": "福岡", "久留米": "福岡",
    "武雄": "佐賀", "佐世保": "長崎", "別府": "大分", "熊本": "熊本" };
  const RIDER_KEYS = ["er", "single", "banme", "age50", "home", "young", "samepref", "dsc", "has_dsc", "r120", "has_r", "scz", "head", "srk"];

  function trioCombos(n) { const o = []; for (let a = 1; a <= n; a++) for (let b = a + 1; b <= n; b++) for (let c = b + 1; c <= n; c++) o.push([a, b, c]); return o; }

  // 選手ごとの特徴。riders = history / races.json の riders([車番, 年齢, 期, ライン内位置, 評価順位, 評価点, 競走得点, 府県, 3連対率, 着度数の合計, 得点の変化])
  // 府県が欠けた選手がいれば null(地元・同県が作れない)
  function riderFeats(riders, lines, place) {
    if (!Array.isArray(riders) || riders.length < 3 || riders.some((r) => !r[7])) return null;
    const pos = {}, len = {}, mates = {}, byCar = {};
    for (const l of lines || []) l.forEach((c, i) => { pos[c] = i; len[c] = l.length; mates[c] = l.filter((x) => x !== c); });
    for (const r of riders) byCar[r[0]] = r;
    const vp = VENUE_PREF[place] || null;
    const sc = riders.map((r) => r[6] || 0);
    const m = sc.reduce((a, b) => a + b, 0) / sc.length;
    const sd = Math.sqrt(sc.reduce((a, b) => a + (b - m) * (b - m), 0) / sc.length) || 1;
    const order = riders.map((r, i) => ({ c: r[0], s: r[6] || 0, i })).sort((a, b) => b.s - a.s || a.i - b.i);
    const srk = {}; order.forEach((o, i) => { srk[o.c] = i + 1; });
    const F = {};
    for (const r of riders) {
      const c = r[0], lp = pos[c] != null ? pos[c] : 0, ll = len[c] || 1;
      const san = r[8] != null ? r[8] : null, nr = r[9] || 0, dsc = r[10] != null ? r[10] : null;
      const hasR = nr > 0 && san != null;
      F[c] = {
        er: r[4] || 5, single: ll === 1 ? 1 : 0, banme: lp >= 1 && ll >= 2 ? 1 : 0,
        age50: (r[1] || 0) >= 50 ? 1 : 0, home: vp && r[7] === vp ? 1 : 0, young: (r[2] || 0) >= 121 ? 1 : 0,
        samepref: lp >= 1 && (mates[c] || []).some((x) => byCar[x] && byCar[x][7] === r[7]) ? 1 : 0,
        dsc: dsc != null ? dsc : 0, has_dsc: dsc != null ? 1 : 0,
        r120: hasR ? san / 100 : MODEL.R120_MEAN, has_r: hasR ? 1 : 0,
        scz: ((r[6] || m) - m) / sd, head: lp === 0 && ll >= 2 ? 1 : 0, srk: srk[c],
      };
    }
    return F;
  }
  function riderScore(f) { const B = MODEL.b; let s = 0; for (const k of RIDER_KEYS) s += B[k] * f[k]; return s; }

  // 全組の期待値。o = 3連複の倍率(1=2=3, 1=2=4, … の順)。無効(0・null・9999 以上)は除いて割り戻す。無効が2割を超えたら null
  // → [{ ticket: "1=2=3", odds, ev }, …](有効な組だけ)
  function evAll(riders, lines, place, o, n) {
    const F = riderFeats(riders, lines, place);
    if (!F || !Array.isArray(o)) return null;
    n = n || riders.length;
    const cs = trioCombos(n);
    if (cs.length !== o.length || cs.some((c) => c.some((x) => !F[x]))) return null;
    const B = MODEL.b, is9 = n >= 8 ? 1 : 0, rs = {};
    for (const c in F) rs[c] = riderScore(F[c]);
    const rows = [];
    cs.forEach((c, i) => {
      const v = o[i];
      if (!(v > 0 && v < 9999)) return;
      const x = Math.log(1 / v), xc = x - MODEL.LO_MEAN;
      const u = B.K * x + B.lo2 * xc * xc + B.lo3 * xc * xc * xc + B.lo9 * x * is9 + rs[c[0]] + rs[c[1]] + rs[c[2]];
      rows.push({ ticket: c.join("="), odds: v, u });
    });
    if (rows.length < cs.length * 0.8) return null;
    const mx = Math.max(...rows.map((r) => r.u));
    let tot = 0; for (const r of rows) { r.w = Math.exp(r.u - mx); tot += r.w; }
    return rows.map((r) => ({ ticket: r.ticket, odds: r.odds, ev: (r.w / tot) * r.odds }));
  }
  // 買う1組(期待値≥1.1・10〜30倍の中で期待値がいちばん高い組)。無ければ null
  function pick(all) {
    if (!all) return null;
    let best = null;
    for (const r of all) if (r.ev >= PICK.minEv && r.odds >= PICK.oddsLo && r.odds <= PICK.oddsHi && (!best || r.ev > best.ev)) best = r;
    return best;
  }
  const api = { MODEL, PICK, riderFeats, evAll, pick, trioCombos };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EVD = api;
})(typeof window !== "undefined" ? window : this);
