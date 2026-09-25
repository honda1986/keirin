// ============================================================
// ev.js — 🔥の買い目の期待値(夜の集計 results.js 用。アプリ index.html の EV_MODEL / evDelta / evOfRow と同じ計算)
//
//   組の確率 p ∝ (1/オッズ)^K × exp(3人の δ の和) を全組で割り戻し、期待値 = p × オッズ(hikitsugi §4-3)
//   ★係数・場の府県・計算を変えるときは index.html の同名の部分も必ず同じに直すこと(evcheck.js で突き合わせる)
// ============================================================
"use strict";
const EV_MODEL = { K: 1.18, b: { er: 0.05552, single: -0.06649, banme: -0.04201, age50: 0.08862, home: 0.0448, young: 0.07674, samepref: 0.032 } };
const VENUE_PREF = { "函館": "北海道", "青森": "青森", "いわき平": "福島", "弥彦": "新潟", "前橋": "群馬", "取手": "茨城", "宇都宮": "栃木",
  "大宮": "埼玉", "西武園": "埼玉", "京王閣": "東京", "立川": "東京", "松戸": "千葉", "千葉": "千葉", "川崎": "神奈川", "平塚": "神奈川",
  "小田原": "神奈川", "伊東": "静岡", "静岡": "静岡", "名古屋": "愛知", "岐阜": "岐阜", "大垣": "岐阜", "豊橋": "愛知", "富山": "富山",
  "松阪": "三重", "四日市": "三重", "福井": "福井", "奈良": "奈良", "向日町": "京都", "和歌山": "和歌山", "岸和田": "大阪", "玉野": "岡山",
  "広島": "広島", "防府": "山口", "高松": "香川", "小松島": "徳島", "高知": "高知", "松山": "愛媛", "小倉": "福岡", "久留米": "福岡",
  "武雄": "佐賀", "佐世保": "長崎", "別府": "大分", "熊本": "熊本" };

// 選手ごとの δ。ents = [{ car, age, ki(数), pref, rank(評価順位) }]、lines = 並び
function deltaOf(ents, lines, place) {
  const B = EV_MODEL.b, pos = {}, len = {}, mates = {}, byCar = {};
  for (const l of lines || []) l.forEach((c, i) => { pos[c] = i; len[c] = l.length; mates[c] = l.filter((x) => x !== c); });
  for (const e of ents) byCar[e.car] = e;
  const vp = VENUE_PREF[place] || null;
  const out = {};
  for (const e of ents) {
    const lp = pos[e.car], ll = len[e.car] || 1;
    const samePref = lp >= 1 && (mates[e.car] || []).some((m) => byCar[m] && byCar[m].pref && byCar[m].pref === e.pref);
    out[e.car] = B.er * (e.rank || 5) + (ll === 1 ? B.single : 0) + (lp >= 1 && ll >= 2 ? B.banme : 0) +
      ((e.age || 0) >= 50 ? B.age50 : 0) + (vp && e.pref === vp ? B.home : 0) + ((e.ki || 0) >= 121 ? B.young : 0) + (samePref ? B.samepref : 0);
  }
  return out;
}
// history.json の riders([車番, 年齢, 期, ライン内位置, 評価順位, 評価点, 競走得点, 府県]) から。府県が無ければ null
function deltaFromRiders(riders, lines, place) {
  if (!Array.isArray(riders) || !riders.length || riders.some((r) => !r[7])) return null;
  return deltaOf(riders.map((r) => ({ car: r[0], age: r[1], ki: r[2], rank: r[4], pref: r[7] })), lines, place);
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
module.exports = { EV_MODEL, VENUE_PREF, deltaOf, deltaFromRiders, evOf, trioCombos };
