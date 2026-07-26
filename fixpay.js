// ============================================================
// fixpay.js — 保存済みの着順・配当を、正しいパーサーで取り直して修正する
//
// 背景: 旧パーサーは賭式を「数字の個数」だけで判別していたため、
//   3連複(3=5=7)を3連単、2車複(3=7)を2車単として取り込むことがあった。
//   複式は着順ではなく番号順に並ぶため、着順(f/s/t)まで壊れていた。
//   → 区切り文字("-"=単 / "="=複)で判別する新パーサーで全期間を取り直す。
//
// 払戻ページは1日1リクエストなので、数百日でも数分で完了する。
// 使い方: node fixpay.js [days]  (省略時は全期間)
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
    if (!res.ok) return null;
    return await res.text();
  } catch (e) { return null; } finally { clearTimeout(t); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseHaraiList(html) {
  const out = {};
  const tokenRe = /([぀-ヿ一-龥]{2,5})競輪|class="race"[^>]*>\s*(\d{1,2})R[\s\S]{0,300}?class="order"([\s\S]{0,600}?)<\/td>[\s\S]{0,200}?class="refund"[^>]*>\s*([\d,]+)/g;
  let m, venue = null;
  while ((m = tokenRe.exec(html))) {
    if (m[1]) { venue = m[1]; continue; }
    if (!venue) continue;
    const orderChunk = m[3];
    const pay = +m[4].replace(/,/g, "");
    const cars = [...orderChunk.matchAll(/class="n(\d)"[^>]*>\s*(\d)\s*</g)].map((x) => +x[2]);
    if (!cars.length || !pay) continue;
    // 区切り文字で賭式判別: "-"=順序あり(3連単/2車単) / "="=順序なし(複式)は無視
    const syms = [...orderChunk.matchAll(/class="symbol"[^>]*>([\s\S]{0,8}?)<\//g)].map((x) => x[1]);
    if (syms.some((s) => s.includes("=") || s.includes("＝"))) continue;
    const key = venue + "_" + m[2] + "R";
    const o = (out[key] = out[key] || {});
    if (cars.length === 3 && o.first == null) { o.first = cars[0]; o.second = cars[1]; o.third = cars[2]; o.p3pay = pay; }
    else if (cars.length === 2 && o.p2pay == null) { o.p2pay = pay; }
  }
  return out;
}

(async () => {
  const hist = JSON.parse(fs.readFileSync(path.join(dir, "history.json"), "utf8"));
  const arg = parseInt(process.argv[2] || "0", 10);
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const fromD8 = arg ? new Date(jst.getTime() - arg * 86400000).toISOString().slice(0, 10).replace(/-/g, "") : "00000000";

  const byDate = {};
  for (const e of hist.entries) {
    if (e.date < fromD8) continue;
    (byDate[e.date] = byDate[e.date] || []).push(e);
  }
  const dates = Object.keys(byDate).sort().reverse();
  console.log("対象:", dates.length, "日 /", Object.values(byDate).reduce((a, b) => a + b.length, 0), "レース");

  let fixedOrder = 0, fixedP3 = 0, fixedP2 = 0, notFound = 0, checked = 0;
  for (let i = 0; i < dates.length; i++) {
    const d8 = dates[i];
    const url = `https://keirin.kdreams.jp/harailist/${d8.slice(0, 4)}/${d8.slice(4, 6)}/${d8.slice(6, 8)}/`;
    const html = await get(url);
    if (!html) { console.log("  " + d8 + ": 取得失敗(スキップ)"); await sleep(200); continue; }
    const truth = parseHaraiList(html);
    let fo = 0, f3 = 0, f2 = 0, nf = 0;
    for (const e of byDate[d8]) {
      checked++;
      const t = truth[e.place + "_" + e.raceNo];
      if (!t || t.first == null) { nf++; notFound++; continue; }
      if (e.f !== t.first || e.s !== t.second || e.t !== t.third) { e.f = t.first; e.s = t.second; e.t = t.third; fo++; fixedOrder++; }
      if (e.p3pay !== t.p3pay) { e.p3pay = t.p3pay; f3++; fixedP3++; }
      const np2 = t.p2pay != null ? t.p2pay : null;
      if (e.p2pay !== np2) { e.p2pay = np2; f2++; fixedP2++; }
    }
    if ((i + 1) % 10 === 0 || fo || f3 || f2) {
      console.log(`  [${i + 1}/${dates.length}] ${d8}: 着順修正${fo} / 3連単修正${f3} / 2車単修正${f2}` + (nf ? ` / 該当なし${nf}` : ""));
    }
    if ((i + 1) % 20 === 0) fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify(hist));
    await sleep(200);
  }
  fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify(hist));
  console.log("\n完了: 検査", checked, "件");
  console.log("  着順を修正:", fixedOrder, "件");
  console.log("  3連単配当を修正:", fixedP3, "件");
  console.log("  2車単配当を修正:", fixedP2, "件");
  console.log("  払戻ページに該当なし:", notFound, "件");
  console.log("\n→ この後 verify.js で妥当性を再確認し、シミュレーターを回し直してください");
})();
