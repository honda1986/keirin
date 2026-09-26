// ============================================================
// ev.js — 🔥の買い目の期待値(夜の集計 results.js 用。アプリ index.html の EV_MODEL / evDelta / evOfRow と同じ計算)
//
//   組の確率 p ∝ (1/オッズ)^K × exp(3人の δ の和) を全組で割り戻し、期待値 = p × オッズ(hikitsugi §4-3)
//   ★係数・場の府県・計算を変えるときは index.html の同名の部分も必ず同じに直すこと(evcheck.js で突き合わせる)
// ============================================================
"use strict";
// v2(2026-09-26): 「得点の変化」と「3連対率」を足した(2022〜2026年の5年とも効いていた特徴。hikitsugi §4-3)
//   dsc = 今の得点 − 90日以上前の得点(±6で打ち切り)。90〜365日前の記録が無ければ has_dsc=0
//   r120 = 3連対率(0〜1)。出走表の3連対率は直近4か月の3着以内率で、furoito から作った120日の率と相関0.83
//          着度数が0(直近に走っていない)なら has_r=0、r120 は平均(R120_MEAN)で埋める
const EV_MODEL = { K: 1.18, R120_MEAN: 0.42665, b: { er: 0.05012, single: -0.06441, banme: -0.03693, age50: 0.08587, home: 0.04772,
  young: 0.08961, samepref: 0.03198, dsc: -0.01254, has_dsc: 0.02362, r120: -0.01764, has_r: -0.30319 } };
const VENUE_PREF = { "函館": "北海道", "青森": "青森", "いわき平": "福島", "弥彦": "新潟", "前橋": "群馬", "取手": "茨城", "宇都宮": "栃木",
  "大宮": "埼玉", "西武園": "埼玉", "京王閣": "東京", "立川": "東京", "松戸": "千葉", "千葉": "千葉", "川崎": "神奈川", "平塚": "神奈川",
  "小田原": "神奈川", "伊東": "静岡", "静岡": "静岡", "名古屋": "愛知", "岐阜": "岐阜", "大垣": "岐阜", "豊橋": "愛知", "富山": "富山",
  "松阪": "三重", "四日市": "三重", "福井": "福井", "奈良": "奈良", "向日町": "京都", "和歌山": "和歌山", "岸和田": "大阪", "玉野": "岡山",
  "広島": "広島", "防府": "山口", "高松": "香川", "小松島": "徳島", "高知": "高知", "松山": "愛媛", "小倉": "福岡", "久留米": "福岡",
  "武雄": "佐賀", "佐世保": "長崎", "別府": "大分", "熊本": "熊本" };

// 得点の変化。log = scores.json の1人分 [["YYYYMMDD", 得点], ...](日付順)。90〜365日前の最後の記録と比べる。無ければ null
function scoreChange(log, d8, score) {
  if (!Array.isArray(log) || !(score > 0) || !/^\d{8}$/.test(d8 || "")) return null;
  const t = Date.UTC(+d8.slice(0, 4), +d8.slice(4, 6) - 1, +d8.slice(6, 8));
  const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
  const hi = ymd(t - 90 * 86400e3), lo = ymd(t - 365 * 86400e3);
  let old = null;
  for (const r of log) if (r[0] <= hi && r[0] >= lo && r[1] > 0) old = r[1];
  return old == null ? null : Math.max(-6, Math.min(6, score - old));
}
// 選手ごとの δ。ents = [{ car, age, ki(数), pref, rank(評価順位), dsc(得点の変化 or null), san(3連対率 %), nr(着度数の合計) }]、lines = 並び
function deltaOf(ents, lines, place) {
  const B = EV_MODEL.b, pos = {}, len = {}, mates = {}, byCar = {};
  for (const l of lines || []) l.forEach((c, i) => { pos[c] = i; len[c] = l.length; mates[c] = l.filter((x) => x !== c); });
  for (const e of ents) byCar[e.car] = e;
  const vp = VENUE_PREF[place] || null;
  const out = {};
  for (const e of ents) {
    const lp = pos[e.car], ll = len[e.car] || 1;
    const samePref = lp >= 1 && (mates[e.car] || []).some((m) => byCar[m] && byCar[m].pref && byCar[m].pref === e.pref);
    const hasR = (e.nr || 0) > 0 && e.san != null;
    out[e.car] = B.er * (e.rank || 5) + (ll === 1 ? B.single : 0) + (lp >= 1 && ll >= 2 ? B.banme : 0) +
      ((e.age || 0) >= 50 ? B.age50 : 0) + (vp && e.pref === vp ? B.home : 0) + ((e.ki || 0) >= 121 ? B.young : 0) + (samePref ? B.samepref : 0) +
      (e.dsc != null ? B.dsc * e.dsc + B.has_dsc : 0) +
      B.r120 * (hasR ? e.san / 100 : EV_MODEL.R120_MEAN) + (hasR ? B.has_r : 0);
  }
  return out;
}
// history.json の riders([車番, 年齢, 期, ライン内位置, 評価順位, 評価点, 競走得点, 府県, 3連対率, 着度数の合計, 得点の変化]) から。
// 府県(8番目)が無ければ null。3連対率・着度数・得点の変化(9〜11番目)は 2026-09-26 から
function deltaFromRiders(riders, lines, place) {
  if (!Array.isArray(riders) || !riders.length || riders.some((r) => !r[7])) return null;
  return deltaOf(riders.map((r) => ({ car: r[0], age: r[1], ki: r[2], rank: r[4], pref: r[7],
    san: r[8] != null ? r[8] : null, nr: r[9] != null ? r[9] : 0, dsc: r[10] != null ? r[10] : null })), lines, place);
}
function trioCombos(n) { const o = []; for (let a = 1; a <= n; a++) for (let b = a + 1; b <= n; b++) for (let c = b + 1; c <= n; c++) o.push([a, b, c]); return o; }
// o = 3連複の倍率(1=2=3, 1=2=4, … の順)。無効(0・null・9999.9 以上)が2割を超えたら null
function evOf(delta, ticket, o, n) {
  if (!delta || !Array.isArray(o)) return null;
  const cs = trioCombos(n);
  if (cs.length !== o.length) return null;
  let tot = 0, valid = 0, mine = null, mineOdds = null;
  cs.forEach((c, i) => {
    const v = o[i];
    if (!(v > 0 && v < 9999)) return;
    valid++;
    const w = Math.pow(1 / v, EV_MODEL.K) * Math.exp((delta[c[0]] || 0) + (delta[c[1]] || 0) + (delta[c[2]] || 0));
    tot += w;
    if (c.join("=") === ticket) { mine = w; mineOdds = v; }
  });
  if (!tot || mine == null || valid < cs.length * 0.8) return null;
  return (mine / tot) * mineOdds;
}
module.exports = { EV_MODEL, VENUE_PREF, scoreChange, deltaOf, deltaFromRiders, evOf, trioCombos };
