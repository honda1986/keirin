// ============================================================
// fetch.js — 本日の全レースを取得して races.json に書き出す
//
// 【2026-11-15 WINTICKET が海外からのアクセスを止めた → 取れなければ Kドリームス(hikitsugi §4-57)】
//   WINTICKET は「海外からはサービスを利用できません」(HTTP 403)。GitHub Actions(アメリカ)からは取れない。
//   まず WINTICKET を試し、開催の一覧が取れなければ楽天Kドリームス(復旧していた)で取る。日本の PC からは今まで通り WINTICKET。
//   races.json の url がどちらのページかで、snap.js・live.js・results.js・gitfill.js も取得元を切り替える。
//   Kドリームスで取った日は AI予想(Ⓐに使う)と H は入らない。KEIRIN_SOURCE=kd / wt で片方だけにできる
//
// 【2026-10-23 取得元を WINTICKET に変更(hikitsugi §4-47)】
//   楽天Kドリームスが緊急メンテナンスで止まった(PHP の脆弱性対応とみられる)ので、WINTICKET(wt.js)に移した。
//   トップページから今日開催の場 → 場ごとに開催の全レース → 1レース1ページの出走表。
//   出走表は wt.js の cardText で Kドリームスと同じ形のテキストにして buildEntry に渡す(raw も同じ形なのでアプリはそのまま読める)。
//   races.json の url は WINTICKET の出走表(snap.js・live.js・results.js がここから倍率と結果を取る)。
//   ★昼(12:20)・夕方(16:50)の取り直しでは、トップページから終わった場が消えることがあるので、同じ日の races.json にあるレースは残す
//
// 【2026-08-28 取得元を変更】
//   Gamboo は AWS WAF のボット判定(JavaScript必須のチャレンジ)が入り、
//   プログラムからは一切取得できなくなった(全URLで HTTP 202 / server:awselb)。
//   そのため楽天Kドリームスへ切り替えた。odds.js と同じ経路・同じ作りにしてある。
//
//   日別一覧: https://keirin.kdreams.jp/odds/YYYY/MM/DD/   ← 1回でその日の全レースURLが取れる
//   レース  : https://keirin.kdreams.jp/{場名}/racedetail/{16桁ID}/
//
//   ページには出走表・競走得点・着度数・連対率・ギヤ・脚質・並び予想が
//   すべて最初から入っているので、1レース1リクエストで足りる。
//   ただし「前得点」だけは無い。その代わり scorelog.js で毎日の競走得点を
//   scores.json に貯め、「前回の開催からの増減」で代用できるようにしてある。
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const { parseCard, predict, sujiExpect, applyScoreLog, f3PlanFrom } = require("./engine.js");
const { T, TRACK_NAMES } = require("./bankdata.js");
const EV = require("./ev.js");
const FRONT = require("./front.js");
const DF = require("./datafile.js");
// 出走表の予想印(記者の ◎○▲△×注)。🔥9車の「朝の自信度」に使う(hotconf.js。2026-11-24〜・hikitsugi §4-67)。Kドリームスのページにだけある(WINTICKET には無い)
const HOTCONF = require("./hotconf.js");
// 展開予想の「ラインで前について行けない(離れる)確率」(tenkai.js の detach。hikitsugi §4-25・§4-26)。🔥9車の条件に使う
let TENKAI = null;
try { TENKAI = require("./tenkai.js").load(JSON.parse(fs.readFileSync(path.join(__dirname, "tenkai-model.json"), "utf8"))); }
catch (e) { console.log("展開モデルなし(離れる確率は出さない):", e.message); }

// 🔥の3人がいるラインで、番手か3番手のどちらかが前について行けない確率 = 1 − (1−p番手)(1−p3番手)。
// 入力の作り方は index.html の tenkaiInput と同じ。分析(analysis/tenkai/hanare_bet.py)と同じく、
// 3人を全部含むラインの2人目・3人目で計算する(競りで1人飛ばした3人でも、ラインの並び順のまま)。
function lineBreakOf(p, r, bank, rankBase, trio) {
  if (!TENKAI || !Array.isArray(trio) || trio.length < 3) return null;
  const ent = {}; for (const e of p.entries) ent[e.car] = e;
  const lines = (p.lines || []).map((l) => l.filter((c) => ent[c])).filter((l) => l.length);
  const seen = new Set(lines.flat()); for (const e of p.entries) if (!seen.has(e.car)) lines.push([e.car]);
  const ln = lines.find((l) => trio.every((c) => l.includes(c)));
  if (!ln || ln.length < 3) return null;
  const R = {};
  for (const e of p.entries) R[e.car] = [e.kyaku, e.k.nige, e.k.makuri, e.k.sashi, e.k.mark, e.S, e.B, e.score, rankBase[e.car] || 9, e.rate.sanren, e.age];
  const det = TENKAI.detach({ n: p.entries.length, bank: bank ? bank[0] : 400, klass: r.klass, seri: p.seri || [], lines, R });
  if (det[ln[1]] == null || det[ln[2]] == null) return null;
  return Math.round((1 - (1 - det[ln[1]]) * (1 - det[ln[2]])) * 1000) / 1000;
}

// 🔥の3人のラインの先頭の B率(B回数 ÷ 着度数の合計)が、2人以上のラインの先頭どうしでいちばんか(同じ値も1位)。
// 2022〜2026年の🔥9車(5〜15倍・離れる17%以上)で 1位 139% / それ以外 116%(hikitsugi §4-31・§4-32)。分析(analysis/s2/hot2.py)と同じ計算
function headB1Of(p, trio) {
  if (!Array.isArray(trio) || trio.length < 3) return null;
  const ent = {}; for (const e of p.entries) ent[e.car] = e;
  const lines = (p.lines || []).map((l) => l.filter((c) => ent[c])).filter((l) => l.length >= 2);
  const ln = lines.find((l) => trio.every((c) => l.includes(c)));
  if (!ln) return null;
  const rate = (c) => { const e = ent[c], s = e.seiseki || {}; const tot = (s.win1 || 0) + (s.win2 || 0) + (s.win3 || 0) + (s.out || 0); return tot ? (e.B || 0) / tot : 0; };
  const mine = rate(ln[0]);
  return lines.every((l) => rate(l[0]) <= mine + 1e-12);
}

// 競走得点の日次ログ。Kドリームスには前得点が無いので、ここから scoreDiff を復元する。
// この実行で書き足すより前の状態を読む(当日ぶんは prevMeetScore が見ないので順序は問わない)。
let SCORE_LOG = null;
try { SCORE_LOG = JSON.parse(fs.readFileSync(path.join(__dirname, "scores.json"), "utf8")); }
catch (e) { console.log("得点ログなし(scoreDiff は0のまま)"); }

let LEARN_W = null;
try { LEARN_W = JSON.parse(fs.readFileSync(path.join(__dirname, "weights.json"), "utf8"));
  console.log("学習補正を適用:", LEARN_W.updatedAt || "(日付なし)"); } catch { console.log("学習補正なし"); }


const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CONCURRENCY = 2;            // WINTICKET のページは1枚 700KB あるので、同時2本・0.5秒あけて取る
const WAIT_MS = 500;
const FETCH_TIMEOUT = 25000;
const MAX_RETRY = 2;
const DEADLINE_MS = 40 * 60 * 1000;      // 40分で打ち切り(通常は数分で終わる)
const startedAt = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getOnce(url) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: c.signal });
    if (res.status === 429 || res.status === 503) { const e = new Error(String(res.status)); e.retryable = true; throw e; }
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally { clearTimeout(t); }
}
async function get(url) {
  for (let a = 0; ; a++) {
    try { return await getOnce(url); }
    catch (e) { if (e.retryable && a < MAX_RETRY) { await sleep(2500 * (a + 1)); continue; } throw e; }
  }
}
async function pool(items, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) {
      if (Date.now() - startedAt > DEADLINE_MS) return;
      const idx = i++;
      try { await worker(items[idx]); } catch (e) { console.error("  取得失敗:", items[idx].place, items[idx].raceNo, e.message); }
      await sleep(WAIT_MS);
    }
  }));
}

// HTML → テキスト、並び予想の読み取りは cardtext.js(scorefill.js と共用)
// compactCard(ページを予想に必要な部分だけのテキストにする)も cardtext.js(pastcard.js と共用)
const { compactCard, htmlToText, withNarabiText } = require("./cardtext.js");
const WT = require("./wt.js");

// ---- 楽天Kドリームス(2026-10-22 まで使っていた取得元。2026-11-15 から WINTICKET が取れないときの予備・hikitsugi §4-57) ----
//   日別一覧: https://keirin.kdreams.jp/odds/YYYY/MM/DD/ ← 1回でその日の全レースURLが取れる
//   レース  : https://keirin.kdreams.jp/{場名}/racedetail/{16桁ID}/ ← 出走表・並び予想が全部入っている(1レース1リクエスト)
const VENUE_PIDS = [11,12,13,21,22,23,24,25,26,27,28,31,32,34,35,36,37,38,42,43,44,45,46,47,48,51,53,54,55,56,61,62,63,71,73,74,75,81,83,84,85,86,87];
const PID2NAME = {};
if (TRACK_NAMES.length === VENUE_PIDS.length) TRACK_NAMES.forEach((n, i) => { PID2NAME[VENUE_PIDS[i]] = n; });
function parseDayIndex(html) {
  const seen = new Set(), out = [];
  for (const m of html.matchAll(/\/([a-z]+)\/racedetail\/(\d{16})\//g)) {
    const roma = m[1], rid = m[2];
    if (seen.has(rid)) continue; seen.add(rid);
    const pid = parseInt(rid.slice(0, 2), 10);
    const rno = parseInt(rid.slice(-4), 10);
    const place = PID2NAME[pid];
    if (!place || !(rno >= 1 && rno <= 12)) continue;
    out.push({ src: "kd", place, raceNo: rno + "R", rno, url: `https://keirin.kdreams.jp/${roma}/racedetail/${rid}/` });
  }
  return out;
}

const MARK_COUNT = { races: 0, withHon: 0, inferred: 0 };   // ログ用(数だけ)
function buildEntry(text, item) {
  const p = parseCard(text, TRACK_NAMES);
  if (!p || !Array.isArray(p.entries) || p.entries.length < 5) throw new Error("選手データ不足 " + (p?.entries?.length ?? 0));
  // 欠車の選手は出走表から消えるが、並び予想には車番が残る。残したままだと予想が止まる(2026-09-28 岐阜9R・12R)
  const cars = new Set(p.entries.map((e) => e.car));
  const lost = (p.lines || []).flat().filter((c) => !cars.has(c));
  if (lost.length) console.warn("  ★並びにいて出走表に無い車番:", item.place, item.raceNo, lost.join(","), "(欠車か、選手の読み取り漏れ)");
  p.lines = (p.lines || []).map((l) => l.filter((c) => cars.has(c))).filter((l) => l.length);
  for (const e of p.entries) if (!e.seiseki) e.seiseki = { win1: 0, win2: 0, win3: 0, out: 0 };
  applyScoreLog(p, SCORE_LOG);                   // 前回開催の得点から scoreDiff を復元
  if (!p.place) p.place = item.place;
  p.raceNo = item.raceNo;                        // レース番号はURLの値を正とする
  const bank = T[p.place];
  if (!bank) console.warn("  バンクデータなし:", p.place);
  const r = predict(p, bank, p.place, LEARN_W);
  let sx = null;
  try { sx = sujiExpect(p, r, bank ? bank[10] : null); } catch (e) { console.error("  sujiExpect:", e.message); }

  const posOf = {};
  for (const line of p.lines || []) {
    if (line.length === 1) posOf[line[0]] = 3;
    else line.forEach((car, i) => { posOf[car] = Math.min(i, 2); });
  }
  const rankOf = {};
  (r.scores || []).forEach((s, i) => { rankOf[s.car] = i + 1; });
  // 初手の前受けの予想(front.js)。lines と同じ順のライン別の確率。predict が評価点に足す前の順位で計算したもの
  let front = null;
  try {
    const fp = r.front || FRONT.probs(p.lines || [], FRONT.fromEntries(p.entries, r.rankBase || rankOf));
    if (fp) front = fp.map((v) => Math.round(v * 1000) / 1000);
  } catch (e) { console.error("  前受けの予想:", e.message); }
  // riders[4](評価順位)・riders[5](評価点)は前受けを足す前のもの(モデルD・期待値がこれで作ってある)。足した後の順位は riders[11](◎○▲・🔥はこちら)
  const rankBase = r.rankBase || rankOf;
  // riders = [車番, 年齢, 期, ライン内位置, 評価順位, 評価点, 競走得点, 府県, 3連対率, 着度数の合計, 得点の変化, 前受けを足した評価順位, H]
  // 13番目(H = ホーム回数)は 2026-10-23 に追加(WINTICKET から。Kドリームスには無かった。まだ予想には使っていない)
  // 12番目(前受けを足した評価順位)は 2026-10-01 に追加(hikitsugi §4-18)。◎○▲・🔥はこれ。無い記録は 5番目を使う
  // 8番目(府県)は 2026-09-26 に追加(期待値の「地元」「同県の番手」に使う。ev.js)。それより前のデータには無い
  // 9〜11番目も 2026-09-26 に追加(期待値 v2)。得点の変化 = 今の得点 − 90〜365日前の最後の得点(scores.json から。無ければ null)
  // 7番目(競走得点)は 2026-09-21 に追加。それ以前のデータには入っていないので、
  // 読む側は rd[6] が undefined でも動くようにすること。
  // 評価点(6番目)は採点の総合点で、競走得点とは別物。後から
  // 「得点の序列と並びの序列が食い違うラインは機能しないのでは」といった検証を
  // するには生の競走得点が要るため、保存しておく。
  const d8 = (() => { const m = String(p.date || "").match(/(\d{4})年(\d{1,2})月(\d{1,2})日/); return m ? m[1] + m[2].padStart(2, "0") + m[3].padStart(2, "0") : null; })();
  const scoreChangeOf = (en) => {
    if (!SCORE_LOG || !SCORE_LOG.riders || !en.name || !en.ki) return null;
    return EV.scoreChange(SCORE_LOG.riders[en.name + "|" + String(en.ki).replace(/期$/, "")], d8, en.score);
  };
  const plan = f3PlanFrom((r.scores || []).map((sc) => sc.car), p.lines || [], { ss: p.entries.some((e) => e.grade === "SS"), seri: p.seri });
  if (plan && plan.trio) {
    try { plan.brk = lineBreakOf(p, r, bank, rankBase, plan.trio); } catch (e) { console.error("  離れる確率:", e.message); plan.brk = null; }
    try { plan.b1 = headB1Of(p, plan.trio); } catch (e) { console.error("  B率:", e.message); plan.b1 = null; }
  }
  // 予想印はページ全体のテキストから読む(短くした raw には1番車の印が入らない)。印が無いページ(WINTICKET・印がまだ)は付けない
  const mk = HOTCONF.marksFromText(text), cm = HOTCONF.toStr(mk.cm);
  MARK_COUNT.races++; if (/◎/.test(cm)) MARK_COUNT.withHon++; if (mk.inferred) MARK_COUNT.inferred++;
  const riders = p.entries.map((en) => {
    const sc = (r.scores || []).find((x) => x.car === en.car);
    return [en.car, en.age || 0, parseInt(en.ki, 10) || 0, posOf[en.car] ?? 3, rankBase[en.car] || 9,
            Number((sc?.totalBase ?? sc?.total ?? 0).toFixed(1)), en.score > 0 ? Number(en.score.toFixed(2)) : null,
            en.pref ? String(en.pref).replace(/[\s　]/g, "") : null,
            en.rate && en.rate.sanren != null ? en.rate.sanren : null,
            en.seiseki ? (en.seiseki.win1 || 0) + (en.seiseki.win2 || 0) + (en.seiseki.win3 || 0) + (en.seiseki.out || 0) : 0,
            scoreChangeOf(en), rankOf[en.car] || 9, en.home != null ? en.home : null];
  });
  return {
    key: (p.place || "?") + "_" + (p.raceNo || "?"),
    place: p.place, raceNo: p.raceNo, startTime: p.startTime || "", grade: p.grade, date: p.date,
    klass: r.klass, fLabel: r.fLabel, pattern: r.linePattern,
    score: sx ? sx.score : null, verdict: sx ? sx.verdict : "対象外",
    reasons: sx ? sx.reasons : ["ガールズ(ライン無し)"],
    marks: (r.marks || []).slice(0, 3).map((mk) => `${mk.mark}${mk.car} ${mk.name}`).join(" / "),
    lines: p.lines || [], marksCars: (r.marks || []).map((mk) => mk.car), riders,
    front,          // ラインごとの前受け確率(lines と同じ順・front.js)。2026-09-30 から
    // 買い目の判定。これまではアプリ(index.html)がブラウザ側で計算するだけで
    // ファイルに残っていなかった。自動投票クライアントが f3PlanFrom の3つ目の
    // コピーを持たずに済むよう、ここで確定させて書き出す。
    // ★needOdds が true(7車立て)のときは、買う前にオッズが bandLo〜bandHi に
    //   入っているか確認すること。帯を外すと実測87.7%でマイナスになる。
    // ss: S級S班の選手がいるか(🔥の9車は見送り。engine.js の f3PlanFrom)
    ss: p.entries.some((e) => e.grade === "SS"),
    seri: p.seri && p.seri.length ? p.seri.filter((q) => q.every((c) => cars.has(c))) : undefined,   // 競り [[カッコの前, 後], ...]。2026-09-30 から
    cm: cm || undefined,   // 出走表の予想印 "◎3○5▲1△7×2"(hotconf.js。2026-11-24〜)。1番車の印は読めなければ推定(◎○▲△× のうち1つだけ空いているとき)
    plan,           // plan.brk: 🔥の3人のラインが切れる確率(lineBreakOf)。2026-10-13 から / plan.b1: 先頭のB率がいちばん(headB1Of)。2026-10-14 から
    // WINTICKET の AI予想の4車(wt.js の aiCars)。Ⓐ(aifav.js)の判定に使う。2026-11-03 から。無いレースは付けない
    ai: Array.isArray(item.ai) && item.ai.length === 4 ? item.ai : undefined,
    gap: r.scores && r.scores[1] ? Number((r.scores[0].total - r.scores[1].total).toFixed(1)) : null,
    nishatan: r.bets?.nishatan, sanrentan: r.bets?.sanrentan,
    raw: compactCard(text, p.place, p.raceNo), url: item.url,
  };
}

async function main() {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  // FETCH_DATE=YYYY-MM-DD: 過去の日を作り直す(wtday.js。予想が残っていない日のため)。RACES_OUT と一緒に使う(races.json・scores.json は書かない)
  const FETCH_DATE = process.env.FETCH_DATE || "";
  // --pending: 今日の races.json にまだ無いレース(ミッドナイトなど、朝は出走表が出ていない)だけを取りに行き、今の races.json に足す
  //   (2026-11-24〜・hikitsugi §4-67)。live.yml が日中30分おきに呼ぶ。足せるものが無ければ何も書かない。得点ログ(scores.json)には触らない
  const PENDING_ONLY = process.argv.includes("--pending");
  if (PENDING_ONLY && (FETCH_DATE || process.env.RACES_OUT)) { console.error("--pending は今日の races.json にだけ使えます"); process.exit(1); }
  if (FETCH_DATE && (!/^\d{4}-\d{2}-\d{2}$/.test(FETCH_DATE) || !process.env.RACES_OUT)) { console.error("FETCH_DATE は YYYY-MM-DD で、RACES_OUT と一緒に指定してください"); process.exit(1); }
  const d = FETCH_DATE || jst.toISOString().slice(0, 10), d8 = d.replace(/-/g, "");
  console.log("========================================");
  const SRC = String(process.env.KEIRIN_SOURCE || "").toLowerCase();   // "kd" = Kドリームスだけ / "wt" = WINTICKET だけ / 空 = WINTICKET → だめなら Kドリームス
  console.log(" 全レース更新(取得元: " + (SRC === "kd" ? "Kドリームス" : SRC === "wt" ? "WINTICKET" : "WINTICKET → 取れなければ Kドリームス") + ")");
  console.log(" 対象日:", d);
  console.log("========================================");

  let list = [];
  const firstPage = {};
  if (SRC !== "kd") {
    // 今日開催の場(トップページのリンク)→ 場ごとに1R の出走表を開き、開催の全レースから今日の分を拾う
    let cups = [];
    try {
      if (FETCH_DATE) {
        // 過去の日はトップページに無いので、43場それぞれでその日の開催を探す(wt.js の findCup。開催の無い場は 404 が続くだけ)
        const cache = {};
        for (const place of TRACK_NAMES) {
          const c = await WT.findCup(place, d8, cache);
          if (c) cups.push({ slug: c.slug, cupId: c.cupId, index: c.index });
        }
      } else cups = await WT.todayCups();
      console.log((FETCH_DATE ? d + " に" : "今日") + "開催の場(WINTICKET):", cups.map((c) => c.slug).join(" ") || "なし");
    } catch (e) {
      console.error("WINTICKET の開催の一覧の取得に失敗:", e.message + (/403/.test(e.message) ? "(海外からのアクセスは止められている。GitHub からは取れない)" : ""));
      if (SRC === "wt") process.exit(1);
    }
    for (const c of cups) {
      try {
        const url1 = WT.urlOf("racecard", c.slug, c.cupId, c.index, 1);
        const html = await get(url1);
        const S = WT.stateOf(html);
        if (WT.isMaintenance(S)) { console.error("WINTICKET がメンテナンス中です"); break; }
        const CR = WT.query(S, "FETCH_KEIRIN_CUP_RACES");
        const sch = CR && (CR.schedules || []).find((x) => x.date === d8);
        const place = CR && CR.cup ? WT.placeOf(CR.cup.venueId) : null;
        if (!sch || !place) { console.log("  " + c.slug + ": 今日のレースなし(" + (place || "場名不明") + ")"); continue; }
        if (sch.index === c.index) firstPage[c.slug] = html;
        const rs = (CR.races || []).filter((r) => r.scheduleId === sch.id);
        for (const r of rs) {
          if (r.cancel) { console.log("  中止:", place, r.number + "R", r.cancelReason || ""); continue; }
          list.push({ src: "wt", place, raceNo: r.number + "R", rno: r.number, slug: c.slug, url: WT.urlOf("racecard", c.slug, c.cupId, sch.index, r.number) });
        }
        console.log("  " + place + "(" + c.slug + ") " + sch.day + "日目 " + rs.length + "R");
      } catch (e) { console.error("  " + c.slug + ": 開催の取得に失敗", e.message); }
      await sleep(WAIT_MS);
    }
  }
  if (!list.length && SRC !== "wt") {
    // WINTICKET から1件も取れない(海外から止められている・メンテナンス・開催なし)→ Kドリームス
    if (SRC !== "kd") console.log("→ Kドリームスで取ります");
    const idxUrl = `https://keirin.kdreams.jp/odds/${d.slice(0, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}/`;
    let idxHtml = "";
    try { idxHtml = await get(idxUrl); list = parseDayIndex(idxHtml); }
    catch (e) { console.error("Kドリームスの日別一覧の取得に失敗:", e.message); process.exit(1); }
    // Kドリームスは夜中(月曜 1:00〜7:00 など)にメンテナンスがあり、そのあいだは 200 で「メンテナンス中」のページだけを返す(2026-11-16 に確認)
    if (!list.length && /メンテナンス/.test(idxHtml)) {
      const m = idxHtml.replace(/<[^>]+>/g, " ").match(/メンテナンス時間[：:]\s*([\d:：～〜~\s-]+)/);
      console.error("Kドリームスはメンテナンス中です" + (m ? "(" + m[1].trim() + ")" : "") + "。終わってから取り直してください");
      process.exit(3);
    }
    console.log("Kドリームスの日別一覧からレース:", list.length, "件");
  }
  console.log("今日のレース:", list.length, "件");
  if (!list.length) { console.error("レースが1件も見つかりません。開催が無いか、ページ構造が変わっています。"); process.exit(1); }
  const sameDay = (x) => { const m = String(x.date || "").match(/(\d{4})年(\d{1,2})月(\d{1,2})日/); return !!m && m[1] + m[2].padStart(2, "0") + m[3].padStart(2, "0") === d8; };
  if (PENDING_ONLY) {
    let have = null;
    try { have = new Set((DF.read(path.join(__dirname, "races.json")).races || []).filter(sameDay).map((x) => x.key)); } catch (e) { /* 読めない */ }
    if (!have || !have.size) { console.log("今日の races.json がまだ無いので、取り直し(全部)に任せます"); return; }
    list = list.filter((it) => !have.has(it.place + "_" + it.raceNo));
    console.log("出走表待ちのレース:", list.length, "件");
    if (!list.length) return;
  }

  const races = [], failed = [];
  await pool(list, async (item) => {
    try { await buildOne(item); } catch (err) { failed.push(item); throw err; }
  });
  async function buildOne(item) {
    let e;
    if (item.src === "kd") {
      // Kドリームス: 並び予想を1行のテキストに直してからページ全体をテキストに(2026-10-22 までと同じ。AI予想・H は無い)
      const text = htmlToText(withNarabiText(await get(item.url)));
      e = buildEntry(text, item);
    } else {
      const html = item.rno === 1 && firstPage[item.slug] ? firstPage[item.slug] : await get(item.url);
      const R = WT.query(WT.stateOf(html), "FETCH_KEIRIN_RACE");
      if (!R || !R.race) throw new Error("出走表の JSON が無い");
      const text = WT.cardText(R, item.place);
      e = buildEntry(text, { ...item, ai: WT.aiCars(R) });
    }
    if (races.some((x) => x.key === e.key)) return;
    races.push(e);
    console.log("  OK", e.place, e.raceNo, (e.score != null ? e.score + "%" : "ガールズ"), "ライン=" + JSON.stringify(e.lines));
  }
  console.log(" 出走表の予想印: ◎が読めた " + MARK_COUNT.withHon + " / " + MARK_COUNT.races + " レース(1番車の印を推定 " + MARK_COUNT.inferred + ")");
  if (PENDING_ONLY && !races.length) { console.log("まだ出走表が出ていません(" + failed.length + "件)。次の回でまた見ます"); return; }
  const builtN = races.length;

  // 同じ日の races.json にあって今回取れなかったレース(トップページから消えた場など)は残す
  try {
    const prev = DF.read(process.env.RACES_OUT || path.join(__dirname, "races.json"));
    const same = (prev.races || []).filter(sameDay);
    const have = new Set(races.map((x) => x.key));
    const kept = same.filter((x) => !have.has(x.key));
    if (kept.length) { races.push(...kept); console.log(" 前回の races.json から残したレース:", kept.length, "件"); }
    // Kドリームスで取り直すと AI予想が無い。PC が送って aimerge.js が足した ai は残す(2026-11-15〜・hikitsugi §4-58)
    const prevAi = new Map(same.filter((x) => Array.isArray(x.ai) && x.ai.length === 4).map((x) => [x.key, x.ai]));
    let keptAi = 0;
    for (const e of races) if (!(Array.isArray(e.ai) && e.ai.length === 4) && prevAi.has(e.key) && e.klass === "s") { e.ai = prevAi.get(e.key); keptAi++; }
    if (keptAi) console.log(" 前回の races.json から残した AI予想:", keptAi, "件");
  } catch (e) { /* 前回が無い・読めない(合言葉なし)ときは今回の分だけ */ }

  races.sort((a, b) => (a.startTime || "99:99").localeCompare(b.startTime || "99:99") || a.place.localeCompare(b.place));
  if (!races.length) {
    // 空で上書きするとアプリの一覧が消えるので、1件も作れなかったときは書かない
    console.error("1件も作れませんでした。races.json はそのままにします。");
    process.exit(1);
  }
  // 出走表待ち: 今日の一覧にあるのに出走表が取れなかったレース(ミッドナイトなど、朝は出走表が出ていない)。アプリが「出走表待ち」と出す。
  //   live.yml が日中30分おきに --pending で取りに行く(2026-11-24〜・hikitsugi §4-67)
  const haveKeys = new Set(races.map((x) => x.key));
  const pending = failed.filter((it) => !haveKeys.has(it.place + "_" + it.raceNo)).map((it) => ({ place: it.place, raceNo: it.raceNo }));
  if (pending.length) console.log(" 出走表待ち:", pending.length, "件(" + new Set(pending.map((x) => x.place)).size + "場)");
  // アプリは { updatedAt, count, races } の形を期待している(配列そのままだと読めない)
  // RACES_OUT を指定したときはそこに書き、得点ログ(scores.json)には触らない。
  // PC の予備取得(pc/runner.js)が、GitHub の朝の更新が遅れた日に手元だけで使うため。
  // main のファイルを書き換えると、次に GitHub から取り込むときにぶつかる。
  const outPath = process.env.RACES_OUT || path.join(__dirname, "races.json");
  // races.json は合言葉があれば暗号化して置く(datafile.js・hikitsugi §4-22)。RACES_OUT(PC の手元用・git に入らない)はそのまま
  const racesObj = Object.assign({ updatedAt: new Date().toISOString(), count: races.length, races }, pending.length ? { pending } : {});
  if (process.env.RACES_OUT) fs.writeFileSync(outPath, JSON.stringify(racesObj));
  else if (!DF.write(outPath, racesObj, { updatedAt: racesObj.updatedAt })) console.log(" (合言葉が無いので races.json は暗号化していません)");
  // 競走得点の日次ログを更新する(ネットワークには出ない。いま作った races を読み直すだけ)。
  // Kドリームスには前得点が無いので、毎日の得点を貯めて「前回の開催との差」で代用する。
  // ★ここが失敗してもレース取得自体は成功させる(races.json は既に書いてある)。
  if (process.env.RACES_OUT) { console.log(" 書き出し先:", outPath, "(得点ログは更新しない)"); return; }
  if (PENDING_ONLY) { console.log(" 出走表待ちだったレースを足しました:", builtN, "件(得点ログは次の取り直しで)"); return; }
  try {
    const SL = require("./scorelog.js");
    const store = SL.load();
    const r = SL.updateFromRaces(store, races);
    SL.finalize(store);
    fs.writeFileSync(SL.SCORES, JSON.stringify(store));
    console.log(" 競走得点ログ:", r.added, "件追加 / 累計", store.dates.length, "日");
  } catch (e) {
    console.error(" 競走得点ログの更新に失敗(レース取得は成功しています):", e.message);
  }

  console.log("\n========================================");
  console.log(" 書き出し:", races.length, "レース /", list.length, "件中");
  console.log(" 所要:", Math.round((Date.now() - startedAt) / 1000), "秒");
  console.log("========================================");
}

if (require.main === module) main();
module.exports = { buildEntry };
