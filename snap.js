// ============================================================
// snap.js — 締切前の3連複オッズ(全組)を記録する
//
// 手元の過去オッズ(odds-YYYYMM.json)は確定オッズだけ。買い目をオッズで選ぶ改善は
// 「確定オッズで選んで確定オッズで払う」形でしか測れておらず、実際に買う時点
// (締切の数分前)のオッズで同じになるかが分からない(hikitsugi §4-3・§5-H)。
// その差を測るため、締切15〜2分前のレースを3分おきに見て、3連複の全組を残す。
// 競艇 v24 の snap_odds / snap_pack と同じ考え方(引き継ぎ資料 §2-4・§2-5)。
//
// ・取得元: Kドリームスのレース詳細のオッズ画面。3連複は「人気順」の一覧に全組が出る
//   (9車84組・7車35組)。前売りで票が無い組は 9999.9 と出るので、そのまま残す
//   (使う側で「9999.9 は無効」と扱う。記録の段階で捨てない)
// ・締切 = 発走の5分前(races.json の startTime は発走)
// ・見たレースは買う/買わないに関係なく全部残す(買い目だけだと偏るため)
// ・記録は snapwork/YYYYMMDD.jsonl に1行ずつ足す。git には入れない。
//   snap_pack.js が odds-snap ブランチの snap/YYYYMMDD.json.gz にまとめる
// ・取れなかった理由は必ずログに出す。記録が失敗しても落ちない
//
// 1行の形:
//   {"t":"14:03:12","k":"熊本_7R","rid":"8720...","left":9.8,"upd":"14:02","n":7,"o":[35個]}
//   t=取得した時刻(JST) / left=締切まで何分 / upd=ページの「HH:MM現在」/ n=車立て
//   o=3連複オッズ。1=2=3, 1=2=4, … の昇順(odds-YYYYMM.json と同じ並び)。取れなかった組は null
//
// 使い方: node snap.js            … 窓に入っているレースを1周だけ見る(ワークフローが1分おきに呼ぶ)
//         node snap.js --dry      … 取得して表示するだけ(書き込まない)
//         node snap.js --win=0,600 … 窓を変える(動作確認用。締切0〜600分前)
// ============================================================
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "snapwork");
const STATE = path.join(DIR, "state.json");
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const winArg = (argv.find((a) => a.startsWith("--win=")) || "").slice(6);
const [WIN_LO, WIN_HI] = winArg ? winArg.split(",").map(Number) : [2, 15];   // 締切まで何分のレースを見るか
const EVERY_SEC = 170;          // 同じレースを見る間隔(3分弱。1分おきに呼ばれる前提)
const CLOSE_BEFORE = 5;         // 締切は発走の5分前(index.html と同じ)
const BUDGET_MS = 50 * 1000;    // 1回の持ち時間。超えたら残りは次の回へ
const WAIT_MS = 700;            // 1リクエストごとの間隔(並列にしない)
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const t0 = Date.now();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jst = () => new Date(Date.now() + 9 * 3600e3);
const hms = () => jst().toISOString().slice(11, 19);

async function fetchText(url) {
  // 1回失敗したら1秒あけてもう1回。それ以上は次の周に任せる(資料 §2-3 の4)
  let last;
  for (let a = 0; a < 2; a++) {
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: ctrl.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    } catch (e) { last = e; await sleep(1000); }
    finally { clearTimeout(tm); }
  }
  throw last;
}

const toText = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

function combos(n) {
  const o = [];
  for (let a = 1; a <= n; a++) for (let b = a + 1; b <= n; b++) for (let c = b + 1; c <= n; c++) o.push(a + "=" + b + "=" + c);
  return o;
}

// 3連複の「人気順」一覧を読む。{ odds: Map("1=2=3" → 倍), upd: "HH:MM" | null, len }
function parseTrio(html) {
  const text = toText(html);
  const upd = (text.match(/(\d{1,2}:\d{2})\s*現在/) || [])[1] || null;
  const i = text.indexOf("人気順");
  const j = i >= 0 ? text.indexOf("高配当順", i) : -1;
  const seg = i >= 0 ? text.slice(i, j > i ? j : undefined) : "";
  const odds = new Map();
  for (const m of seg.matchAll(/(\d)\s*=\s*(\d)\s*=\s*(\d)\s+([\d,]+(?:\.\d+)?)/g)) {
    const k = [+m[1], +m[2], +m[3]].sort((x, y) => x - y).join("=");
    const v = parseFloat(m[4].replace(/,/g, ""));
    if (isFinite(v) && v > 0 && !odds.has(k)) odds.set(k, v);
  }
  return { odds, upd, len: html.length };
}

function raceDay(x) {
  const j = String(x.date || "").match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (j) return j[1] + j[2].padStart(2, "0") + j[3].padStart(2, "0");
  return null;
}
function minsToClose(day8, hhmm) {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm || "")) return null;
  const [h, m] = hhmm.split(":").map(Number);
  const start = Date.UTC(+day8.slice(0, 4), +day8.slice(4, 6) - 1, +day8.slice(6, 8), h, m);
  return (start - jst().getTime()) / 60000 - CLOSE_BEFORE;
}

async function main() {
  let rj;
  try { rj = JSON.parse(fs.readFileSync(path.join(__dirname, "races.json"), "utf8")); }
  catch (e) { console.log("races.json が読めません:", e.message); return; }
  const today = jst().toISOString().slice(0, 10).replace(/-/g, "");
  const list = (rj.races || []).filter((x) => raceDay(x) === today);
  if (!list.length) { console.log(hms(), "races.json に今日(" + today + ")のレースがありません(まだ更新されていない)"); return; }

  let st = {};
  try { st = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch (e) {}
  if (st.date !== today) st = { date: today, last: {} };

  const todo = [];
  for (const x of list) {
    const left = minsToClose(today, x.startTime);
    if (left == null || left < WIN_LO || left > WIN_HI) continue;
    const prev = st.last[x.key] || 0;
    if (Date.now() - prev < EVERY_SEC * 1000) continue;
    const m = String(x.url || "").match(/keirin\.kdreams\.jp\/([a-z]+)\/racedetail\/(\d{16})/);
    if (!m) { console.log("  " + x.key + ": レースURLが無い"); continue; }
    todo.push({ x, left, roma: m[1], rid: m[2] });
  }
  if (!todo.length) return;
  todo.sort((a, b) => a.left - b.left);   // 締切が近い順
  console.log(hms(), "締切" + WIN_LO + "〜" + WIN_HI + "分前 " + todo.length + "レース");

  const rows = [];
  for (const { x, left, roma, rid } of todo) {
    if (Date.now() - t0 > BUDGET_MS) { console.log("  持ち時間切れ。残りは次の回へ"); break; }
    const n = Array.isArray(x.riders) && x.riders.length ? x.riders.length : (x.plan && x.plan.cars) || 0;
    const url = "https://keirin.kdreams.jp/" + roma + "/racedetail/" + rid + "/?pageType=odds&kakeshikiType=3renhuku";
    let p;
    try { p = parseTrio(await fetchText(url)); }
    catch (e) { console.log("  " + x.key + ": 取得失敗(" + e.message + ")"); await sleep(WAIT_MS); continue; }
    const cs = combos(n || 9);
    const o = cs.map((k) => (p.odds.has(k) ? p.odds.get(k) : null));
    const got = o.filter((v) => v != null).length;
    const extra = [...p.odds.keys()].filter((k) => !cs.includes(k)).length;   // 車立ての読み違い
    if (!got) {
      console.log("  " + x.key + ": オッズが読めない(本文 " + p.len + " 文字)");
      await sleep(WAIT_MS); continue;
    }
    const row = { t: hms(), k: x.key, rid, left: Math.round(left * 10) / 10, upd: p.upd, n: n || null, o };
    rows.push(row);
    st.last[x.key] = Date.now();
    const bad = o.filter((v) => v != null && v >= 9999).length;
    console.log("  " + x.key + " 締切" + row.left + "分前 " + (p.upd || "?") + "現在 " + got + "/" + cs.length + "組" +
      (bad ? " (9999.9=" + bad + ")" : "") + (extra ? " ★車立てと合わない組 " + extra : ""));
    await sleep(WAIT_MS);
  }
  if (DRY || !rows.length) return;
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(path.join(DIR, today + ".jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    fs.writeFileSync(STATE, JSON.stringify(st));
  } catch (e) { console.log("  記録に失敗:", e.message); }
}

if (require.main === module) main().catch((e) => { console.log("snap.js 失敗:", e.message); });
module.exports = { parseTrio, combos };
