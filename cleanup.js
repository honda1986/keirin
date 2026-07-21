// ============================================================
// ワンショット掃除: 誤マッチで混入した「未来のレース結果」を削除する
// 対象: 本日(JST)の日付を持つ history エントリのうち、
//        今日の払戻ページに実在しないレース(=別日の結果が誤って紐付いたもの)
// 使い方: node cleanup.js → 削除件数を表示して history.json を更新
// ============================================================
const fs = require("fs");
const path = require("path");
const dir = __dirname;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const FETCH_TIMEOUT = 20000;
async function get(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(res.status + " " + url);
    return await res.text();
  } finally { clearTimeout(t); }
}
function parseHaraiList(html) {
  const out = {};
  const tokenRe = /([぀-ヿ一-龥]{2,5})競輪|class="race"[^>]*>\s*(\d{1,2})R[\s\S]{0,300}?class="order"([\s\S]{0,600}?)<\/td>[\s\S]{0,200}?class="refund"[^>]*>\s*([\d,]+)/g;
  let m, venue = null;
  while ((m = tokenRe.exec(html))) {
    if (m[1]) { venue = m[1]; continue; }
    if (!venue) continue;
    const cars = [...m[3].matchAll(/class="n(\d)"[^>]*>\s*(\d)\s*</g)].map((x) => +x[2]);
    if (!cars.length) continue;
    const key = venue + "_" + m[2] + "R";
    const o = (out[key] = out[key] || {});
    if (cars.length === 3 && o.first == null) { o.first = cars[0]; o.p3pay = +m[4].replace(/,/g, ""); }
  }
  return out;
}
(async () => {
  const hist = JSON.parse(fs.readFileSync(path.join(dir, "history.json"), "utf8"));
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const today8 = jst.toISOString().slice(0, 10).replace(/-/g, "");
  const [y, mo, d] = [today8.slice(0, 4), today8.slice(4, 6), today8.slice(6, 8)];
  const todayEntries = hist.entries.filter((e) => e.date === today8);
  if (!todayEntries.length) { console.log("本日(" + today8 + ")のエントリなし。掃除不要。"); return; }
  console.log("本日のエントリ:", todayEntries.length, "件を検証中...");
  let confirmed = {};
  try {
    const html = await get(`https://keirin.kdreams.jp/harailist/${y}/${mo}/${d}/`);
    confirmed = parseHaraiList(html);
  } catch (e) { console.error("本日の払戻ページ取得失敗。掃除を中止(安全側):", e.message); return; }
  const before = hist.entries.length;
  hist.entries = hist.entries.filter((e) => {
    if (e.date !== today8) return true;
    const ok = confirmed[e.place + "_" + e.raceNo] && confirmed[e.place + "_" + e.raceNo].first != null;
    if (!ok) console.log("削除(未確定なのに結果あり=誤マッチ):", e.place, e.raceNo);
    return ok;
  });
  const removed = before - hist.entries.length;
  fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify(hist));
  console.log("掃除完了:", removed, "件削除 / 残り", hist.entries.length, "件");
  console.log(removed ? "→ この後、結果収集を1回実行してstats.jsonを再生成してください" : "");
})();
