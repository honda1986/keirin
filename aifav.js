// ============================================================
// aifav.js — Ⓐ「AI が外した1番人気ライン」: 3連複の1番人気がライン3車なのに、WINTICKET の AI予想(4車)がその3人をそろえていないとき、
//   その1番人気を1点買う(hikitsugi §4-50)。夜の集計(results.js)・betplan.js(Node)とアプリ(index.html の <script src>)で共用
//
//   条件(すべて): S級 / AI予想の4車がある / 3連複の1番人気が1組に決まる(同じ倍率が2組以上なら買わない) /
//                  その3人が並び予想の同じライン(3人以上)にいる / AI の4車にその3人が全部は入っていない / 1番人気が4倍以上
//   根拠(§4-49。確定オッズで判定・2025-01〜2026-10): 1,138R 回収114.7%(2025年 113.9% / 2026年 115.4%)。
//     いくつも切り分けて見つけた組なので、締切前の倍率では確かめていない(はむさん「確かめなくていいので実装して」2026-11-03)
//   倍率は買うときと同じ「締切2分前より前の最後の記録」で判定する(自動投票・アプリ・夜の集計で同じ)
// ============================================================
(function (root) {
  "use strict";
  const RULE = { klass: "s", minOdds: 4 };
  const COMBOS = {};
  function trioCombos(n) {
    if (!COMBOS[n]) { const o = []; for (let a = 1; a <= n; a++) for (let b = a + 1; b <= n; b++) for (let c = b + 1; c <= n; c++) o.push(a + "=" + b + "=" + c); COMBOS[n] = o; }
    return COMBOS[n];
  }
  // race: { klass, lines, ai }(races.json / history.json の行) / o: 3連複の倍率(trioCombos(n) の順) / n: 車立て
  // → { verdict: "buy" | "none"(条件に入らない) | "noAi"(AI予想が無い) | "noOdds", ticket, odds, why }
  function judge(race, o, n) {
    if (!race || race.klass !== RULE.klass) return { verdict: "none", why: "S級以外" };
    if (!Array.isArray(race.ai) || race.ai.length !== 4) return { verdict: "noAi", why: "AI予想が無い" };
    const cs = trioCombos(n);
    if (!Array.isArray(o) || o.length !== cs.length) return { verdict: "noOdds", why: "倍率が無い・組の数が合わない" };
    let lo = Infinity, at = -1, tie = false;
    o.forEach((v, i) => { if (v > 0 && v < 9999 && v < lo) { lo = v; at = i; tie = false; } else if (v > 0 && v === lo) tie = true; });
    if (at < 0) return { verdict: "noOdds", why: "倍率が無い" };
    const ticket = cs[at], odds = lo;
    if (tie) return { verdict: "none", ticket, odds, why: "1番人気が2組以上" };
    const fav = ticket.split("=").map(Number);
    const inLine = (race.lines || []).some((l) => Array.isArray(l) && l.length >= 3 && l.filter((c) => fav.includes(c)).length === 3);
    if (!inLine) return { verdict: "none", ticket, odds, why: "1番人気がライン3車でない" };
    if (fav.every((c) => race.ai.includes(c))) return { verdict: "none", ticket, odds, why: "AI予想が3人をそろえている" };
    if (odds < RULE.minOdds) return { verdict: "none", ticket, odds, why: "1番人気が" + RULE.minOdds + "倍未満" };
    return { verdict: "buy", ticket, odds };
  }
  const api = { RULE, judge, trioCombos };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AIFAV = api;
})(typeof window !== "undefined" ? window : this);
