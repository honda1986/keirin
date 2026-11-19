// ============================================================
// fav2.js — 3連複の1番人気が2倍以下のレースで、その1番人気が当たる見込み(%)を出す(hikitsugi §4-61)
//   アプリ(index.html の <script src>)の表示だけに使う。買い方(🔥・Ⓓ・Ⓐ・自動投票)には使わない
//
//   作り方: 2022-01〜2026-10 の「3連複の1番人気が2倍以下」22,032R(確定オッズ)でロジスティック回帰。
//     これまでの検証(倍率・男女・級・車立て・二分戦・SS・本命の形・3番手と相手の得点や3連対率の差・4人ライン・先頭の逃げ/捲り・
//     相手の20代30代・3番手の地元)を全部入れて、前の年までで作り次の年で試した(2023〜2026)。
//     ほとんどは倍率にもう入っていて、足すと次の年の当たり方がかえって悪くなった。4年とも倍率だけより良かった次の6つだけ残した:
//       倍率(曲線) / ガールズ(同じ倍率でも当たりにくい) / 5〜6車 / 1番人気に別のラインの選手が混ざる / A級1・2班 / 3番手が地元(当たりやすい)
//     倍率だけの見込みより3ポイント以上上げたレースは 実際56.9%(倍率だけなら51.2%)、3ポイント以上下げたレースは 実際47.0%(48.1%)。
//   3番手の得点と相手でいちばん高い得点の差(§4-61 の「3番手が崩れやすいとき」)は見込みには入れず、参考の一言だけ出す
//   ★確定オッズで作った見込み。アプリでは締切前の倍率で計算する。こうした1番人気を買い続けた回収は約8割(儲けにはならない)
// ============================================================
(function (root) {
  "use strict";
  const MAX_ODDS = 2.0;
  // 全期間(22,032R)で作った係数。見込み = 1 / (1 + exp(-(A + Σ B[k]・x[k])))。lo = log(1番人気の倍率)
  const A = 1.5621456982149844;
  const B = { lo: -3.9423268796695523, lo2: 1.788793262989419, girls: -0.25186128846510186, girls_lo: 0.09087975041841355,
    small: -0.0670009870899918, mixed: -0.11701190146321026, aclass: -0.035784461960174783, home3: 0.17795083783053367 };
  // 倍率だけで作った見込み(比べる元)
  const A0 = 1.5403995155441808, B0 = { lo: -4.030825072230974, lo2: 1.818247866499261 };
  // 3番手の得点 − 相手(本命ライン以外)でいちばん高い得点 ごとの「3番手が3着以内から消えた率」(2倍以下・ライン3人の1番人気 15,715R)
  const DROP3 = [[-5, 45.4], [-2, 40.6], [0, 36.9], [2, 32.2], [5, 27.1], [Infinity, 23.5]], DROP3_ALL = 35.6;
  const VP = { "函館": "北海道", "青森": "青森", "いわき平": "福島", "弥彦": "新潟", "前橋": "群馬", "取手": "茨城", "宇都宮": "栃木", "大宮": "埼玉", "西武園": "埼玉",
    "京王閣": "東京", "立川": "東京", "松戸": "千葉", "千葉": "千葉", "川崎": "神奈川", "平塚": "神奈川", "小田原": "神奈川", "伊東": "静岡", "静岡": "静岡",
    "名古屋": "愛知", "岐阜": "岐阜", "大垣": "岐阜", "豊橋": "愛知", "富山": "富山", "松阪": "三重", "四日市": "三重", "福井": "福井", "奈良": "奈良",
    "向日町": "京都", "和歌山": "和歌山", "岸和田": "大阪", "玉野": "岡山", "広島": "広島", "防府": "山口", "高松": "香川", "小松島": "徳島", "高知": "高知",
    "松山": "愛媛", "小倉": "福岡", "久留米": "福岡", "武雄": "佐賀", "佐世保": "長崎", "別府": "大分", "熊本": "熊本" };
  const COMBOS = {};
  function trioCombos(n) {
    if (!COMBOS[n]) { const o = []; for (let a = 1; a <= n; a++) for (let b = a + 1; b <= n; b++) for (let c = b + 1; c <= n; c++) o.push([a, b, c]); COMBOS[n] = o; }
    return COMBOS[n];
  }
  const clip = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const sig = (z) => 1 / (1 + Math.exp(-z));
  // 3連複の1番人気(1組に決まるときだけ)。o は trioCombos(n) の順
  function favOf(o, n) {
    const cs = trioCombos(n);
    if (!Array.isArray(o) || o.length !== cs.length) return null;
    let best = Infinity, at = -1, tie = false;
    o.forEach((v, i) => { if (v > 0 && v < 9999) { if (v < best) { best = v; at = i; tie = false; } else if (v === best) tie = true; } });
    if (at < 0 || tie) return null;
    return { trio: cs[at].slice(), odds: best, ticket: cs[at].join("=") };
  }
  // 出走表(engine.js / index.html の parseCard の entries)から、この計算に使う数字だけ
  function ridersOf(entries) {
    const E = {};
    for (const e of entries || []) E[e.car] = { sc: e.score, san: e.rate ? e.rate.sanren : null, age: e.age, pref: e.pref, cls: e.grade,
      nige: e.k ? e.k.nige : null, makuri: e.k ? e.k.makuri : null };
    return E;
  }
  // race: { n, place, lines, E: { 車番: { sc, san, age, pref, cls, nige, makuri } } } / trio: 1番人気の3人 / odds: その倍率
  function featuresOf(race, trio, odds) {
    const E = race.E, cars = Object.keys(E).map(Number), lines = race.lines || [];
    const girls = cars.length > 0 && cars.every((c) => String(E[c].cls || "").startsWith("L"));
    const lineOf = {}; lines.forEach((l, i) => l.forEach((c) => { lineOf[c] = i; }));
    const ln = lines.find((l) => trio.every((c) => l.includes(c))) || null;
    const top3 = !girls && !!ln && trio.map((c) => ln.indexOf(c)).sort((a, b) => a - b).join() === "0,1,2";
    const tl = new Set(trio.map((c) => lineOf[c]).filter((v) => v !== undefined));
    const opp = cars.filter((c) => !trio.includes(c) && (girls || !tl.has(lineOf[c])));
    const sc = (c) => E[c].sc || 0;
    const cls = cars.map((c) => String(E[c].cls || ""));
    const S = cls.some((c) => c === "S1" || c === "S2" || c === "SS");
    const chal = !girls && !S && cls.every((c) => !c || c === "A3");
    const lo = Math.log(odds);
    const x = { lo, lo2: lo * lo, girls: girls ? 1 : 0, girls_lo: girls ? lo : 0, small: race.n <= 6 ? 1 : 0, mixed: !girls && !top3 ? 1 : 0,
      aclass: !girls && !S && !chal ? 1 : 0, home3: 0 };
    let third = null;
    if (top3) {
      const c3 = ln[2], vp = VP[race.place];
      x.home3 = vp && vp === E[c3].pref ? 1 : 0;
      const o2 = cars.filter((c) => !ln.includes(c));
      if (o2.length) {
        const best = o2.reduce((a, c) => (sc(c) > sc(a) ? c : a), o2[0]);
        const gap = Math.round((sc(c3) - sc(best)) * 100) / 100;
        third = { car: c3, opp: best, gap, drop: DROP3.find(([t]) => gap < t)[1], dropAll: DROP3_ALL, line4: ln.length >= 4 };
      }
    }
    return { x, girls, top3, third, lineCars: ln };
  }
  const probOf = (x) => sig(A + Object.keys(B).reduce((s, k) => s + B[k] * x[k], 0));
  const prob0Of = (x) => sig(A0 + B0.lo * x.lo + B0.lo2 * x.lo2);
  // → null(2倍より上・1番人気が2組以上・倍率が無い) か { ticket, trio, odds, p, p0, parts: [{ k, label, d }], third, girls }
  //   p = 総合した見込み / p0 = 倍率だけの見込み / parts = 見込みを動かした理由(d = その理由が無かったときとの差・ポイント)
  function judge(race, o) {
    if (!race || !race.E || !race.n) return null;
    const f = favOf(o, race.n);
    if (!f || f.odds > MAX_ODDS) return null;
    if (!f.trio.every((c) => race.E[c])) return null;
    const F = featuresOf(race, f.trio, f.odds), x = F.x, p = probOf(x), p0 = prob0Of(x);
    const parts = [];
    const without = (keys) => { const y = Object.assign({}, x); keys.forEach((k) => { y[k] = 0; }); return Math.round((p - probOf(y)) * 1000) / 10; };
    if (x.girls) parts.push({ k: "girls", label: "ガールズ（同じ倍率の男子より当たりにくい）", d: without(["girls", "girls_lo"]) });
    if (x.home3) parts.push({ k: "home3", label: "3番手（" + F.lineCars[2] + "番）が地元", d: without(["home3"]) });
    if (x.mixed) parts.push({ k: "mixed", label: "1番人気に別のラインの選手が混ざる", d: without(["mixed"]) });
    if (x.small) parts.push({ k: "small", label: race.n + "車立て", d: without(["small"]) });
    if (x.aclass) parts.push({ k: "aclass", label: "A級1・2班", d: without(["aclass"]) });
    return { ticket: f.ticket, trio: f.trio, odds: f.odds, p, p0, parts, third: F.third, girls: F.girls };
  }
  const api = { MAX_ODDS, judge, favOf, featuresOf, ridersOf, trioCombos, probOf, prob0Of };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FAV2 = api;
})(typeof window !== "undefined" ? window : this);
