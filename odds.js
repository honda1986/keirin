// ============================================================
// odds.js — 発走前オッズ(確定オッズ)を取り込む
//
// 楽天Kドリームスのレース詳細ページには、過去レースのオッズが残っている。
//   日別一覧 : https://keirin.kdreams.jp/odds/YYYY/MM/DD/
//   レース別 : https://keirin.kdreams.jp/{場名}/racedetail/{16桁ID}/?pageType=odds&kakeshikiType=3renhuku
//
// これまで「自分の買い目が外れたレースの配当」が分からず、
// 顔ぶれごとの平均値(推定表)で代用していた。オッズがあればそれが不要になる。
//
// 保存先: odds-YYYYMM.json(月ごとに分割。1ファイルが巨大にならないように)
//   { updatedAt, races: { "<id>": { cars: 7, o: [オッズ, ...] } } }
//   o は車番の組み合わせを昇順に並べた順(1=2=3, 1=2=4, ... )の1点あたり倍率。
//   id は history.json と同じ「YYYYMMDD_場名_1R」。
//
// 【安全装置】既定は点検のみ。--apply を付けたときだけ書き込む。
//
// 使い方:
//   node odds.js                          … 直近1日を点検(書き込まない)
//   node odds.js 2026-07-15               … その日を点検
//   node odds.js 2026-07-01 2026-07-31 --apply   … 期間を取り込む
//   node odds.js 30 --apply               … 直近30日
//   オプション: --conc=6 --wait=150       … 同時本数と間隔(ミリ秒)
// ============================================================
const fs = require("fs");
const path = require("path");
const dir = __dirname;
const { TRACK_NAMES } = require("./bankdata.js");

const VENUE_PIDS = [11,12,13,21,22,23,24,25,26,27,28,31,32,34,35,36,37,38,42,43,44,45,46,47,48,51,53,54,55,56,61,62,63,71,73,74,75,81,83,84,85,86,87];
const PID2NAME = {};
if (TRACK_NAMES.length === VENUE_PIDS.length) TRACK_NAMES.forEach((n, i) => { PID2NAME[VENUE_PIDS[i]] = n; });

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const numOpt = (k, d) => { const a = argv.find((x) => x.startsWith("--" + k + "=")); return a ? parseInt(a.split("=")[1], 10) : d; };
const CONCURRENCY = Math.max(1, Math.min(10, numOpt("conc", 6)));
const WAIT_MS     = Math.max(0, numOpt("wait", 150));
const FETCH_TIMEOUT = 20000;
const MAX_RETRY = 2;
const DEADLINE_MS = 5 * 60 * 60 * 1000;   // 5時間で打ち切り(Actionsの6時間上限に余裕)
const startedAt = Date.now();
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getOnce(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: ctrl.signal });
    if (res.status === 429 || res.status === 503) { const e = new Error(String(res.status)); e.retryable = true; throw e; }
    if (!res.ok) throw new Error(String(res.status));
    return await res.text();
  } finally { clearTimeout(t); }
}
async function get(url) {
  for (let a = 0; ; a++) {
    try { return await getOnce(url); }
    catch (e) {
      if (e.retryable && a < MAX_RETRY) { console.log("  混雑のため待機(" + (a + 1) + "回目)"); await sleep(3000 * (a + 1)); continue; }
      throw e;
    }
  }
}
async function pool(items, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) {
      if (Date.now() - startedAt > DEADLINE_MS) return;
      const idx = i++;
      try { await worker(items[idx], idx); } catch (e) { /* 個別の失敗は上位で数える */ }
      if (WAIT_MS) await sleep(WAIT_MS);
    }
  }));
}

// ---- HTML → テキスト(タグは空白に置換。<span>1</span>= が "1 =" になる) ----
const toText = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]*>/g, " ")
  .replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ");

// ---- 3連複オッズの抽出 ----
// 「1 = 4 = 5 430」のような並びを拾う。数字が円(100円あたり)か倍かは呼び出し側で判定。
function parseOdds(html) {
  const text = toText(html);
  const out = new Map();
  const re = /(\d)\s*=\s*(\d)\s*=\s*(\d)[^\d]{0,24}?([\d,]+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(text))) {
    const a = +m[1], b = +m[2], c = +m[3];
    if (a === b || b === c || a === c) continue;
    const v = parseFloat(m[4].replace(/,/g, ""));
    if (!isFinite(v) || v <= 0) continue;
    const key = [a, b, c].sort((x, y) => x - y).join("=");
    if (!out.has(key)) out.set(key, v);   // 最初に出たものを採用(重複表示対策)
  }
  return out;
}

// n車立ての組み合わせを昇順に並べる(保存する配列の順序を決める)
function combos(n) {
  const o = [];
  for (let a = 1; a <= n; a++) for (let b = a + 1; b <= n; b++) for (let c = b + 1; c <= n; c++) o.push(a + "=" + b + "=" + c);
  return o;
}

// ---- 日別一覧からレースURLを取り出す ----
function parseDayIndex(html, d8) {
  const seen = new Set(), out = [];
  const re = /\/([a-z]+)\/racedetail\/(\d{16})\//g;
  let m;
  while ((m = re.exec(html))) {
    const roma = m[1], rid = m[2];
    if (seen.has(rid)) continue; seen.add(rid);
    const pid = parseInt(rid.slice(0, 2), 10);
    const rno = parseInt(rid.slice(-4), 10);
    const place = PID2NAME[pid];
    if (!place || !(rno >= 1 && rno <= 12)) continue;
    out.push({ rid, roma, place, rno, id: d8 + "_" + place + "_" + rno + "R",
      url: "https://keirin.kdreams.jp/" + roma + "/racedetail/" + rid + "/?pageType=odds&kakeshikiType=3renhuku" });
  }
  return out;
}

// ---- 日付リストの組み立て(backfill.js と同じ書式) ----
const ymd = (d) => d.toISOString().slice(0, 10);
function buildDates(args) {
  const a = args.filter((x) => !x.startsWith("--"));
  const out = [];
  if (a.length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(a[0]) && /^\d{4}-\d{2}-\d{2}$/.test(a[1])) {
    const s = new Date(a[0] + "T00:00:00Z"), e = new Date(a[1] + "T00:00:00Z");
    for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) out.push(ymd(new Date(d)));
  } else if (a.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(a[0])) {
    out.push(a[0]);
  } else {
    const n = parseInt(a[0] || "1", 10);
    if (!(n > 0 && n < 5000)) { console.log("日数の指定が不正です:", a[0]); process.exit(1); }
    const base = new Date(Date.now() + 9 * 3600 * 1000);
    for (let i = 1; i <= n; i++) { const d = new Date(base); d.setUTCDate(d.getUTCDate() - i); out.push(ymd(d)); }
  }
  return out.sort();      // 常に古い日から処理する(範囲指定でも日数指定でも同じ順)
}

// ---- 月別ファイルの読み書き ----
const monthPath = (d8) => path.join(dir, "odds-" + d8.slice(0, 6) + ".json");
const monthCache = new Map();
function loadMonth(d8) {
  const k = d8.slice(0, 6);
  if (monthCache.has(k)) return monthCache.get(k);
  let o = { updatedAt: null, races: {} };
  try { o = JSON.parse(fs.readFileSync(monthPath(d8), "utf8")); if (!o.races) o.races = {}; } catch (e) {}
  monthCache.set(k, o);
  return o;
}
function saveMonths() {
  if (!APPLY) return;
  for (const [k, o] of monthCache) {
    o.updatedAt = new Date().toISOString();
    fs.writeFileSync(path.join(dir, "odds-" + k + ".json"), JSON.stringify(o));
  }
}

(async () => {
  console.log(APPLY ? "※ applyモード: odds-YYYYMM.json に書き込みます" : "※ 点検のみ。ファイルは書き換えません(--apply で書き込み)");
  console.log("  同時" + CONCURRENCY + "本 / 間隔" + WAIT_MS + "ms\n");
  if (!Object.keys(PID2NAME).length) { console.log("場コードの対応表が作れませんでした(bankdata.js を確認)"); process.exit(1); }

  // 検算用に history.json を読む(的中した組のオッズが払戻金と一致するかを見る)
  let HIST = {};
  try {
    const h = JSON.parse(fs.readFileSync(path.join(dir, "history.json"), "utf8"));
    for (const e of h.entries || []) if (e.id) HIST[e.id] = e;
    console.log("history.json を検算に使用:", Object.keys(HIST).length, "件\n");
  } catch (e) { console.log("history.json が読めませんでした(検算なしで続行)\n"); }

  const dates = buildDates(argv);
  console.log("対象:", dates[0], "〜", dates[dates.length - 1], "(" + dates.length + "日)\n");

  let tRace = 0, tSaved = 0, tSkip = 0, tErr = 0, tNoOdds = 0;
  let vOk = 0, vNg = 0, vNone = 0;
  const ngSamples = [], unitGuess = [];

  for (const dH of dates) {
    if (Date.now() - startedAt > DEADLINE_MS) { console.log("時間切れで終了"); break; }
    const d8 = dH.replace(/-/g, "");
    const [y, mo, dd] = dH.split("-");
    let idx;
    try { idx = parseDayIndex(await get(`https://keirin.kdreams.jp/odds/${y}/${mo}/${dd}/`), d8); }
    catch (e) { console.log(dH, "一覧の取得に失敗:", e.message); continue; }
    if (!idx.length) { console.log(dH, "開催なし"); await sleep(200); continue; }

    const month = loadMonth(d8);
    // 既に取得済みのレースは飛ばす。history.json に無いレース(=分析に使えない)も取りに行かない。
    const known = Object.keys(HIST).length > 0;
    const todo = idx.filter((r) => !month.races[r.id] && (!known || HIST[r.id]));
    tSkip += idx.length - todo.length;
    if (!todo.length) { console.log(dH, idx.length + "R すべて取得済み"); continue; }

    let ok = 0, ng = 0, noOdds = 0;
    await pool(todo, async (r) => {
      let html;
      try { html = await get(r.url); } catch (e) { ng++; tErr++; return; }
      const map = parseOdds(html);
      if (!map.size) {
        noOdds++; tNoOdds++;
        // 最初の1件だけ、中身が読めなかった原因を追えるように抜粋を出す
        if (!global.__dbg) {
          global.__dbg = true;
          const t = toText(html);
          const i = t.search(/\d\s*=\s*\d/);
          console.log("  【診断】" + r.url);
          console.log("  【診断】HTML長 " + html.length + " / '=' の並びの位置 " + i);
          console.log("  【診断】本文抜粋: " + (i >= 0 ? t.slice(Math.max(0, i - 120), i + 400) : t.slice(0, 500)));
        }
        return;
      }

      // 車立ては、出てきた車番の最大値から判断する
      let maxCar = 0;
      for (const k of map.keys()) for (const c of k.split("=")) maxCar = Math.max(maxCar, +c);
      const cars = maxCar;
      const order = combos(cars);
      const arr = order.map((k) => (map.has(k) ? map.get(k) : null));
      const filled = arr.filter((x) => x != null).length;

      // 検算: 実際に来た組のオッズが、払戻金(p3fpay)と一致するか
      const e = HIST[r.id];
      if (e && e.f && e.s && e.t && e.p3fpay != null) {
        const key = [e.f, e.s, e.t].sort((a, b) => a - b).join("=");
        const v = map.get(key);
        if (v == null) vNone++;
        else {
          // 値が「円(100円あたり)」なら p3fpay とほぼ一致、「倍」なら p3fpay/100 と一致
          const asYen = Math.abs(v - e.p3fpay) / e.p3fpay;
          const asBai = Math.abs(v * 100 - e.p3fpay) / e.p3fpay;
          const best = Math.min(asYen, asBai);
          unitGuess.push(asYen <= asBai ? "円" : "倍");
          if (best <= 0.05) vOk++;
          else { vNg++; if (ngSamples.length < 10) ngSamples.push(r.id + " ページ" + v + " / 払戻" + e.p3fpay); }
        }
      }
      if (APPLY) month.races[r.id] = { cars, o: arr };
      ok++; tSaved++;
      if (filled < order.length) {
        if (ngSamples.length < 10) ngSamples.push(r.id + " 組合せ不足 " + filled + "/" + order.length);
      }
    });
    tRace += todo.length;
    console.log(dH, "取得", ok + "/" + todo.length + "R" + (ng ? " 失敗" + ng : "") + (noOdds ? " オッズ無し" + noOdds : "") +
      "  経過" + Math.round((Date.now() - startedAt) / 1000) + "秒");
    saveMonths();
    await sleep(200);
  }

  console.log("\n============ 結果 ============");
  console.log("処理したレース:", tRace, " / 取得成功:", tSaved, " / 取得済みで飛ばした:", tSkip);
  console.log("取得失敗:", tErr, " / オッズが読めず:", tNoOdds);
  console.log("\n【検算】ページのオッズ vs 払戻金(history.json)");
  console.log("  一致(誤差5%以内):", vOk, "件");
  console.log("  不一致          :", vNg, "件  ← ここが多いとパーサーが間違っています");
  console.log("  照合できず       :", vNone, "件");
  if (unitGuess.length) {
    const yen = unitGuess.filter((x) => x === "円").length;
    console.log("  数値の単位      :", yen > unitGuess.length / 2 ? "円(100円あたりの払戻)" : "倍", "と判断");
  }
  if (ngSamples.length) { console.log("  気になった例:"); ngSamples.forEach((s) => console.log("    " + s)); }
  console.log(APPLY ? "\n→ 書き込み済み。odds-YYYYMM.json を確認してください" : "\n→ 書き込んでいません。検算に納得したら --apply を付けて実行してください");
})();
