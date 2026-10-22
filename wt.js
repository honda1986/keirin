// ============================================================
// wt.js — WINTICKET(ウィンチケット)から出走表・締切前の倍率・結果を取る(2026-10-23〜。hikitsugi §4-47)
//
// 楽天Kドリームスが緊急メンテナンス(PHP の脆弱性対応とみられる)で止まったので、全部こちらに移した。
// ページの中に window.__PRELOADED_STATE__ = {...} として、画面に出す元の JSON がそのまま入っている。
//   出走表 : https://www.winticket.jp/keirin/{場}/racecard/{cupId}/{日目}/{R}  … FETCH_KEIRIN_RACE(選手・成績・並び予想)・FETCH_KEIRIN_CUP_RACES(開催の全レース)
//   倍率   : https://www.winticket.jp/keirin/{場}/odds/{cupId}/{日目}/{R}      … FETCH_KEIRIN_RACE_ODDS(3連複は全組・確定後は払戻も)
//   一覧   : https://www.winticket.jp/keirin                                   … 今日開催の場のリンク
// robots.txt で止められているのは /keirin/cups/ だけ(使っていない)。1リクエストずつ間をあけて取る
//
// 出走表は Kドリームスの形のテキスト(engine.js の parseKdreams が読む形)に直して渡す。
// こうしておくと races.json の raw・アプリ(index.html)・scorelog.js など、出走表を読む所を変えずに済む。
// ★Kドリームスに無かった H(ホーム回数)は、各選手の3連対率の次に足す(parseKdreams は読み飛ばす。e.home に入れる)
// ============================================================
"use strict";
const BASE = "https://www.winticket.jp";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 取得(429・503・通信の失敗は少し待って取り直す) ----
async function get(url, { timeout = 25000, retry = 2 } = {}) {
  for (let a = 0; ; a++) {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), timeout);
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: c.signal });
      if (res.status === 429 || res.status >= 500) throw Object.assign(new Error("HTTP " + res.status), { retryable: true });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    } catch (e) {
      if (a < retry && (e.retryable || e.name === "AbortError" || /fetch failed/.test(e.message))) { await sleep(2000 * (a + 1)); continue; }
      throw e;
    } finally { clearTimeout(t); }
  }
}

// ---- ページの中の JSON ----
function stateOf(html) {
  const i = String(html).indexOf("window.__PRELOADED_STATE__ = ");
  if (i < 0) return null;
  const s = html.slice(i + 29);
  let d = 0, q = false, e = false;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (q) { if (e) e = false; else if (c === "\\") e = true; else if (c === '"') q = false; continue; }
    if (c === '"') q = true;
    else if (c === "{") d++;
    else if (c === "}") { d--; if (d === 0) return JSON.parse(s.slice(0, k + 1)); }
  }
  return null;
}
// queryKey に name を含むクエリの data
function query(S, name) {
  const qs = (S && S.tanStackQuery && S.tanStackQuery.queries) || [];
  const q = qs.find((x) => JSON.stringify(x.queryKey).includes(name));
  return q && q.state ? q.state.data : null;
}
const isMaintenance = (S) => !!(S && S.redux && S.redux.app && (S.redux.app.maintenance || S.redux.app.unavailable));

// ---- URL ----
const urlOf = (kind, slug, cupId, index, no) => `${BASE}/keirin/${slug}/${kind}/${cupId}/${index}/${no}`;
function parseUrl(u) {
  const m = String(u || "").match(/winticket\.jp\/keirin\/([a-z]+)\/(?:racecard|odds|raceresult)\/(\d{10})\/(\d+)\/(\d+)/);
  return m ? { slug: m[1], cupId: m[2], index: +m[3], no: +m[4] } : null;
}

// ---- 場の名前。WINTICKET の venueId は JKA の場コード(Kドリームスと同じ。11=函館 … 87=熊本) ----
const { TRACK_NAMES } = require("./bankdata.js");
const VENUE_PIDS = [11,12,13,21,22,23,24,25,26,27,28,31,32,34,35,36,37,38,42,43,44,45,46,47,48,51,53,54,55,56,61,62,63,71,73,74,75,81,83,84,85,86,87];
const PID2NAME = {};
if (TRACK_NAMES.length === VENUE_PIDS.length) TRACK_NAMES.forEach((n, i) => { PID2NAME[VENUE_PIDS[i]] = n; });
const placeOf = (venueId) => PID2NAME[parseInt(venueId, 10)] || null;

// ---- 日付と時刻(日本時間) ----
const jst = (sec) => new Date(sec * 1000 + 9 * 3600e3);
const hhmm = (sec) => jst(sec).toISOString().slice(11, 16);
const ymdJa = (d8) => `${d8.slice(0, 4)}年${d8.slice(4, 6)}月${d8.slice(6, 8)}日`;

// ---- 級班(class: 1=S 2=A 4=L(ガールズ), group: 0=S班 1〜3。2026-10-23 の全レースで確かめた) ----
function gradeOf(cls, group) {
  if (cls === 1 && group === 0) return "SS";
  const c = { 1: "S", 2: "A", 4: "L" }[cls];
  return c ? c + (group || 1) : "";
}

// ---- 今日開催の場(トップページのリンクから。場ごとに cupId と何日目か) ----
async function todayCups() {
  const html = await get(BASE + "/keirin");
  const seen = new Map();
  for (const m of html.matchAll(/href="\/keirin\/([a-z]+)\/racecard\/(\d{10})\/(\d+)\/\d+/g)) {
    if (!seen.has(m[1])) seen.set(m[1], { slug: m[1], cupId: m[2], index: +m[3] });
  }
  return [...seen.values()];
}

// ---- 出走表(1レース)。FETCH_KEIRIN_RACE と場の一覧から、parseKdreams が読める形のテキストを作る ----
// 選手1人ぶんの行: 枠 / 車番 / 名前 / 府県/年齢/期 / 級班 / 脚質 / ギヤ / 得点 / S / B / 逃 / 捲 / 差 / マ / 1着 / 2着 / 3着 / 着外 / 勝率 / 2連対率 / 3連対率 / H:回数 / コメント
//   ★逃 = frontRunner・捲 = deepCloser・差 = stalker・マ = marker(名前と逆に見えるが、ページの表と突き合わせて確かめた。2026-10-23 熊本1R)
//   ギヤは変更があれば変更後だけ(parseKdreams はギヤの値の最後を使う。2つ並べると compactCard が H を切り落とす)
const num2 = (v) => (v == null || !isFinite(v) ? "0" : String(Math.round(v * 100) / 100));
function cardText(R, place) {
  const race = R.race, sch = R.schedule || {};
  const P = {}; for (const p of R.players || []) P[p.id] = p;
  const REC = {}; for (const r of R.records || []) REC[r.playerId] = r;
  const L = [];
  L.push(place + "競輪 レース詳細");
  L.push(ymdJa(sch.date || ""));                     // compactCard が「 レース詳細 nR」を足す
  L.push(race.number + "R");
  L.push((race.class || "") + " " + (race.raceType || ""));
  L.push("発走予定 " + hhmm(race.startAt));
  L.push("締切予定 " + hhmm(race.closeAt));
  for (const en of (R.entries || []).slice().sort((a, b) => a.number - b.number)) {
    if (en.absent) continue;                          // 欠車は出走表から外す(並び予想に残る車番は fetch.js が外す)
    const p = P[en.playerId] || {}, r = REC[en.playerId] || {};
    L.push(String(en.bracketNumber || ""), String(en.number), p.name || "?",
      (p.prefecture || "?") + "/" + (p.age || 0) + "/" + (p.term || 0),
      gradeOf(p.class, p.group) || "A3", r.style || "追", num2((r.hasModifiedGearRatio && r.modifiedGearRatio) || r.gearRatio || 3.92),
      num2(r.racePoint), String(r.standing || 0), String(r.back || 0),
      String(r.frontRunner || 0), String(r.deepCloser || 0), String(r.stalker || 0), String(r.marker || 0),
      String(r.first || 0), String(r.second || 0), String(r.third || 0), String(r.others || 0),
      num2(r.firstRate), num2(r.secondRate), num2(r.thirdRate),
      "H:" + (r.home != null ? r.home : 0),
      (r.comment || "").replace(/\s+/g, " ").trim() || "コメントなし");
  }
  L.push("並び予想");
  L.push(narabiLine(R.linePrediction) || "← " + (R.entries || []).filter((e) => !e.absent).map((e) => e.number).join("・"));
  L.push("レース評");
  return L.join("\n");
}
// 並び予想 { lines: [{ entries: [{ numbers: [3] }, { numbers: [5, 4] }, ...] }, ...] } → 「← 3 (5 4) 1・7 2 4・6」
//   numbers が2人のときは、その位置を2人が競る(Kドリームスのカッコと同じ)
function narabiLine(lp) {
  if (!lp || !Array.isArray(lp.lines) || !lp.lines.length) return "";
  return "← " + lp.lines.map((l) => (l.entries || []).map((e) => {
    const ns = (e.numbers || []).filter((c) => c >= 1 && c <= 9);
    return ns.length >= 2 ? "(" + ns.join(" ") + ")" : String(ns[0] || "");
  }).filter(Boolean).join(" ")).filter(Boolean).join("・");
}

// ---- 倍率(3連複は全組そろう。並びは 1=2=3, 1=2=4, … engine/snap と同じ) ----
function combos3(n) { const o = []; for (let a = 1; a <= n; a++) for (let b = a + 1; b <= n; b++) for (let c = b + 1; c <= n; c++) o.push([a, b, c]); return o; }
function combos2(n, ordered) { const o = []; for (let a = 1; a <= n; a++) for (let b = 1; b <= n; b++) if (a !== b && (ordered || a < b)) o.push([a, b]); return o; }
const keyOf = (k) => (Array.isArray(k) ? k.join("-") : "");
// 9999.9 は「票がまだ無い」。そのまま残す(使う側で無効として扱う。Kドリームスのときと同じ)
function oddsArray(list, cs, sort) {
  const M = new Map();
  for (const x of list || []) { if (x.absent || !Array.isArray(x.key)) continue; const k = sort ? x.key.slice().sort((a, b) => a - b) : x.key; M.set(keyOf(k), x.odds > 0 ? x.odds : null); }
  return cs.map((c) => (M.has(keyOf(c)) ? M.get(keyOf(c)) : null));
}
function oddsOf(O, n) {
  if (!O) return null;
  return {
    o: oddsArray(O.trio, combos3(n), true),
    t2: oddsArray(O.exacta, combos2(n, true), false),
    f2: oddsArray(O.quinella, combos2(n, false), true),
    upd: O.oddsUpdatedAt ? hhmm(O.oddsUpdatedAt) : null,
    updatedAt: O.oddsUpdatedAt || null,
    final: !!O.finalOdds,
  };
}

// ---- 結果(確定後の倍率ページの払戻から)。Kドリームスの払戻一覧(parseHaraiList)と同じ形 ----
//   { first, second, third, p3pay, p3fpay, p2pay, p2first, p2second, f3:[a,b,c] }。まだ確定していなければ null
function resultOf(O) {
  if (!O) return null;
  const won = (list) => (list || []).filter((x) => x.payoffUnitPrice > 0);
  const tf = won(O.trifecta), tr = won(O.trio), ex = won(O.exacta);
  if (!tf.length && !tr.length && !ex.length) return null;
  const r = { first: null, second: null, third: null, p3pay: null, p3fpay: null, p2pay: null, p2first: null, p2second: null, f3: null };
  if (tf.length === 1) { [r.first, r.second, r.third] = tf[0].key; r.p3pay = tf[0].payoffUnitPrice; }
  if (tr.length === 1) { r.f3 = tr[0].key.slice().sort((a, b) => a - b); r.p3fpay = tr[0].payoffUnitPrice; }
  if (ex.length === 1) { [r.p2first, r.p2second] = ex[0].key; r.p2pay = ex[0].payoffUnitPrice; }
  // 同着などで払戻が2つ以上あるときは着順を決めない(配当は1つ目)
  if (tf.length > 1) r.p3pay = tf[0].payoffUnitPrice;
  if (tr.length > 1) r.p3fpay = tr[0].payoffUnitPrice;
  if (ex.length > 1) r.p2pay = ex[0].payoffUnitPrice;
  return r;
}

// ---- 1レースの倍率ページを読む ----
async function raceOdds(slug, cupId, index, no) {
  const S = stateOf(await get(urlOf("odds", slug, cupId, index, no)));
  if (!S) throw new Error("ページに JSON が無い");
  if (isMaintenance(S)) throw new Error("WINTICKET がメンテナンス中");
  const R = query(S, "FETCH_KEIRIN_RACE"), O = query(S, "FETCH_KEIRIN_RACE_ODDS");
  return { R, O, n: R && R.race ? R.race.entriesNumber : null };
}

module.exports = { BASE, get, sleep, stateOf, query, isMaintenance, urlOf, parseUrl, placeOf, todayCups, cardText, narabiLine,
  oddsOf, resultOf, raceOdds, combos3, combos2, gradeOf, hhmm, ymdJa, jst };
