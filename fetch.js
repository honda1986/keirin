// ============================================================
// fetch.js — 本日の全レースを取得して races.json に書き出す
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
const { compactCard } = require("./cardtext.js");
const WT = require("./wt.js");

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
    plan,           // plan.brk: 🔥の3人のラインが切れる確率(lineBreakOf)。2026-10-13 から / plan.b1: 先頭のB率がいちばん(headB1Of)。2026-10-14 から
    gap: r.scores && r.scores[1] ? Number((r.scores[0].total - r.scores[1].total).toFixed(1)) : null,
    nishatan: r.bets?.nishatan, sanrentan: r.bets?.sanrentan,
    raw: compactCard(text, p.place, p.raceNo), url: item.url,
  };
}

async function main() {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  // FETCH_DATE=YYYY-MM-DD: 過去の日を作り直す(wtday.js。予想が残っていない日のため)。RACES_OUT と一緒に使う(races.json・scores.json は書かない)
  const FETCH_DATE = process.env.FETCH_DATE || "";
  if (FETCH_DATE && (!/^\d{4}-\d{2}-\d{2}$/.test(FETCH_DATE) || !process.env.RACES_OUT)) { console.error("FETCH_DATE は YYYY-MM-DD で、RACES_OUT と一緒に指定してください"); process.exit(1); }
  const d = FETCH_DATE || jst.toISOString().slice(0, 10), d8 = d.replace(/-/g, "");
  console.log("========================================");
  console.log(" 全レース更新(取得元: WINTICKET)");
  console.log(" 対象日:", d);
  console.log("========================================");

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
  } catch (e) { console.error("開催の一覧の取得に失敗:", e.message); process.exit(1); }
  console.log((FETCH_DATE ? d + " に" : "今日") + "開催の場:", cups.map((c) => c.slug).join(" ") || "なし");
  const list = [], firstPage = {};
  for (const c of cups) {
    try {
      const url1 = WT.urlOf("racecard", c.slug, c.cupId, c.index, 1);
      const html = await get(url1);
      const S = WT.stateOf(html);
      if (WT.isMaintenance(S)) { console.error("WINTICKET がメンテナンス中です"); process.exit(1); }
      const CR = WT.query(S, "FETCH_KEIRIN_CUP_RACES");
      const sch = CR && (CR.schedules || []).find((x) => x.date === d8);
      const place = CR && CR.cup ? WT.placeOf(CR.cup.venueId) : null;
      if (!sch || !place) { console.log("  " + c.slug + ": 今日のレースなし(" + (place || "場名不明") + ")"); continue; }
      if (sch.index === c.index) firstPage[c.slug] = html;
      const rs = (CR.races || []).filter((r) => r.scheduleId === sch.id);
      for (const r of rs) {
        if (r.cancel) { console.log("  中止:", place, r.number + "R", r.cancelReason || ""); continue; }
        list.push({ place, raceNo: r.number + "R", rno: r.number, slug: c.slug, url: WT.urlOf("racecard", c.slug, c.cupId, sch.index, r.number) });
      }
      console.log("  " + place + "(" + c.slug + ") " + sch.day + "日目 " + rs.length + "R");
    } catch (e) { console.error("  " + c.slug + ": 開催の取得に失敗", e.message); }
    await sleep(WAIT_MS);
  }
  console.log("今日のレース:", list.length, "件");
  if (!list.length) { console.error("レースが1件も見つかりません。開催が無いか、ページ構造が変わっています。"); process.exit(1); }

  const races = [];
  await pool(list, async (item) => {
    const html = item.rno === 1 && firstPage[item.slug] ? firstPage[item.slug] : await get(item.url);
    const R = WT.query(WT.stateOf(html), "FETCH_KEIRIN_RACE");
    if (!R || !R.race) throw new Error("出走表の JSON が無い");
    const text = WT.cardText(R, item.place);
    const e = buildEntry(text, item);
    if (races.some((x) => x.key === e.key)) return;
    races.push(e);
    console.log("  OK", e.place, e.raceNo, (e.score != null ? e.score + "%" : "ガールズ"), "ライン=" + JSON.stringify(e.lines));
  });

  // 同じ日の races.json にあって今回取れなかったレース(トップページから消えた場など)は残す
  try {
    const prev = DF.read(process.env.RACES_OUT || path.join(__dirname, "races.json"));
    const same = (prev.races || []).filter((x) => { const m = String(x.date || "").match(/(\d{4})年(\d{1,2})月(\d{1,2})日/); return m && m[1] + m[2].padStart(2, "0") + m[3].padStart(2, "0") === d8; });
    const have = new Set(races.map((x) => x.key));
    const kept = same.filter((x) => !have.has(x.key));
    if (kept.length) { races.push(...kept); console.log(" 前回の races.json から残したレース:", kept.length, "件"); }
  } catch (e) { /* 前回が無い・読めない(合言葉なし)ときは今回の分だけ */ }

  races.sort((a, b) => (a.startTime || "99:99").localeCompare(b.startTime || "99:99") || a.place.localeCompare(b.place));
  if (!races.length) {
    // 空で上書きするとアプリの一覧が消えるので、1件も作れなかったときは書かない
    console.error("1件も作れませんでした。races.json はそのままにします。");
    process.exit(1);
  }
  // アプリは { updatedAt, count, races } の形を期待している(配列そのままだと読めない)
  // RACES_OUT を指定したときはそこに書き、得点ログ(scores.json)には触らない。
  // PC の予備取得(pc/runner.js)が、GitHub の朝の更新が遅れた日に手元だけで使うため。
  // main のファイルを書き換えると、次に GitHub から取り込むときにぶつかる。
  const outPath = process.env.RACES_OUT || path.join(__dirname, "races.json");
  // races.json は合言葉があれば暗号化して置く(datafile.js・hikitsugi §4-22)。RACES_OUT(PC の手元用・git に入らない)はそのまま
  const racesObj = { updatedAt: new Date().toISOString(), count: races.length, races };
  if (process.env.RACES_OUT) fs.writeFileSync(outPath, JSON.stringify(racesObj));
  else if (!DF.write(outPath, racesObj, { updatedAt: racesObj.updatedAt })) console.log(" (合言葉が無いので races.json は暗号化していません)");
  // 競走得点の日次ログを更新する(ネットワークには出ない。いま作った races を読み直すだけ)。
  // Kドリームスには前得点が無いので、毎日の得点を貯めて「前回の開催との差」で代用する。
  // ★ここが失敗してもレース取得自体は成功させる(races.json は既に書いてある)。
  if (process.env.RACES_OUT) { console.log(" 書き出し先:", outPath, "(得点ログは更新しない)"); return; }
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
