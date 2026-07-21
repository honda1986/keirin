// ============================================================
// 汚染データ掃除(強化版): 別日の結果が誤って紐付いた本日エントリを除去する。
// 判定: 本日の払戻ページを取得し、各本日エントリの着順(f-s-t)が
//        今日の実際の結果と一致するか照合。一致しない/存在しないものを削除。
// これにより「7/20の結果が7/21に紐付いた」ような汚染を確実に除去できる。
// node cleanup.js
// ============================================================
const fs = require("fs");
const path = require("path");
const dir = __dirname;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
async function get(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
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
    if (cars.length === 3 && o.first == null) { o.first = cars[0]; o.second = cars[1]; o.third = cars[2]; o.p3pay = +m[4].replace(/,/g, ""); }
  }
  return out;
}
(async () => {
  const hist = JSON.parse(fs.readFileSync(path.join(dir, "history.json"), "utf8"));
  // 本日と、念のため直近数日を検証対象にする(連日開催の汚染は複数日に及ぶ可能性)
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const checkDates = [];
  for (let i = 0; i < 3; i++) {
    const dt = new Date(jst.getTime() - i * 86400000);
    checkDates.push(dt.toISOString().slice(0, 10).replace(/-/g, ""));
  }
  console.log("検証対象日:", checkDates.join(", "));

  // 各日の正しい結果を取得
  const truth = {}; // "YYYYMMDD_場_nR" -> {first,second,third}
  for (const d8 of checkDates) {
    const [y, mo, d] = [d8.slice(0, 4), d8.slice(4, 6), d8.slice(6, 8)];
    try {
      const html = await get(`https://keirin.kdreams.jp/harailist/${y}/${mo}/${d}/`);
      const day = parseHaraiList(html);
      for (const [k, v] of Object.entries(day)) if (v.first != null) truth[d8 + "_" + k] = v;
      console.log(d8, "→ 確定", Object.keys(day).length, "レース");
    } catch (e) { console.error(d8, "取得失敗(この日はスキップ=削除しない):", e.message); checkDates.splice(checkDates.indexOf(d8), 1); }
  }

  const before = hist.entries.length;
  let removed = 0, fixed = 0;
  hist.entries = hist.entries.filter((e) => {
    if (!checkDates.includes(e.date)) return true; // 検証対象外の日はそのまま
    const key = e.date + "_" + e.place + "_" + e.raceNo;
    const tr = truth[key];
    if (!tr) { console.log("削除(本日ページに結果なし=未確定or誤登録):", e.date, e.place, e.raceNo); removed++; return false; }
    // 着順が食い違う=別日の結果が紛れ込んでいた → 削除して正しいresults.jsで取り直す
    if (e.f !== tr.first || e.s !== tr.second || e.t !== tr.third) {
      console.log("削除(着順不一致=汚染):", e.date, e.place, e.raceNo, `保存${e.f}-${e.s}-${e.t} / 正${tr.first}-${tr.second}-${tr.third}`);
      removed++; return false;
    }
    return true;
  });
  fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify(hist));
  console.log("\n掃除完了:", removed, "件削除 / 残り", hist.entries.length, "件(元" + before + ")");
})();
