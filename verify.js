// ============================================================
// verify.js — 保存されている配当データが妥当かを点検する
// 「バックテストの回収率が高すぎないか?」を data 側から検証する。
//   ・2車単配当(p2pay)と3連単配当(p3pay)の水準比較
//   ・実際のレースを数件抜き出して、公式ページと突き合わせられる形で表示
// 使い方: node verify.js
// ============================================================
const fs = require("fs");
const path = require("path");
const hist = JSON.parse(fs.readFileSync(path.join(__dirname, "history.json"), "utf8"));
const E = hist.entries || [];
const med = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const avg = (a) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;

const p2 = E.filter((e) => e.p2pay != null).map((e) => e.p2pay);
const p3 = E.filter((e) => e.p3pay != null).map((e) => e.p3pay);
console.log("=== 配当データの水準 ===");
console.log("全エントリ:", E.length, "件");
console.log("2車単配当あり:", p2.length, "件 / 平均", avg(p2).toLocaleString() + "円 / 中央値", med(p2).toLocaleString() + "円");
console.log("3連単配当あり:", p3.length, "件 / 平均", avg(p3).toLocaleString() + "円 / 中央値", med(p3).toLocaleString() + "円");
console.log("");
console.log("【判定の目安】");
console.log("  実際の競輪では 2車単の配当は 3連単のおよそ 1/4〜1/6 です。");
const ratio = med(p3) ? (med(p2) / med(p3)) : 0;
console.log("  → 中央値の比 2車単/3連単 =", ratio.toFixed(2),
  ratio > 0.4 ? "⚠ 高すぎます(2車単に別の賭式の配当が入っている可能性)" :
  ratio < 0.08 ? "⚠ 低すぎます" : "✓ 妥当な範囲");
console.log("");

// 2車単配当が極端に高いものを列挙(誤って3連単配当が入っていないか)
const susp = E.filter((e) => e.p2pay != null && e.p3pay != null && e.p2pay >= e.p3pay);
console.log("2車単配当 ≥ 3連単配当 の異常データ:", susp.length, "件",
  susp.length > E.length * 0.02 ? "⚠ 多すぎます(データ破損の疑い)" : "(少数なら同着等で起こり得ます)");
if (susp.length) {
  console.log("  例:");
  for (const e of susp.slice(0, 5)) {
    console.log("   ", e.date, e.place, e.raceNo, e.f + "-" + e.s + "-" + e.t,
      "3連単", (e.p3pay || 0).toLocaleString() + "円 /", "2車単", (e.p2pay || 0).toLocaleString() + "円");
  }
}
console.log("");

// 直近日のサンプルを表示(公式ページと突き合わせて確認するため)
const dates = [...new Set(E.map((e) => e.date))].sort().reverse();
const d = dates[1] || dates[0];
console.log("=== " + d + " のサンプル(公式ページと見比べてください) ===");
console.log("keirin.kdreams.jp/harailist/" + d.slice(0, 4) + "/" + d.slice(4, 6) + "/" + d.slice(6, 8) + "/");
for (const e of E.filter((x) => x.date === d).slice(0, 8)) {
  console.log("  " + (e.place + " " + e.raceNo).padEnd(10),
    "着順 " + (e.f + "-" + e.s + "-" + e.t).padEnd(7),
    "3連単", String((e.p3pay || 0).toLocaleString() + "円").padStart(10),
    " 2車単", String((e.p2pay || 0).toLocaleString() + "円").padStart(9));
}
console.log("");

// 「2車単スジ相手」を全レースに素直に適用した場合の回収率(基準値)
const sjm = (L, c) => { const l = (L || []).find((x) => x.includes(c)); if (!l || l.length < 2) return []; const i = l.indexOf(c); const o = []; if (i > 0) o.push(l[i - 1]); if (i < l.length - 1) o.push(l[i + 1]); return o; };
let n = 0, bet = 0, hit = 0, ret = 0;
for (const e of E) {
  if (e.p2pay == null || !Array.isArray(e.ranks) || !e.ranks.length || !e.lines) continue;
  const m = sjm(e.lines, e.ranks[0]);
  if (!m.length) continue;
  const t = m.map((c) => e.ranks[0] + "-" + c);
  n++; bet += t.length;
  if (t.includes(e.f + "-" + e.s)) { hit++; ret += e.p2pay; }
}
console.log("=== 参考: 2車単スジ相手を全レースに適用 ===");
console.log("  対象", n, "R / 的中率", (hit / n * 100).toFixed(1) + "% / 回収率", (ret / (bet * 100) * 100).toFixed(1) + "%");
console.log("  ※ 競輪の控除率は25%。無条件で買えば回収率は75%前後になるのが自然です。");
console.log("     ここが100%を大きく超えている場合、配当データが実際より高い可能性があります。");

// ===== 実ページと突き合わせ(原因の切り分け) =====
// 保存されている値と、いま払戻ページを取得して新パーサーで読んだ値を並べて表示する。
//  ・両者が一致 → パーサーはページ通りに読んでいる(=別の原因/ページ側の並び)
//  ・両者が不一致 → 保存データが古い(修正が未反映=コミット漏れ 等)
(async () => {
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
  const get = async (url) => {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 20000);
    try { const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: c.signal }); return r.ok ? await r.text() : null; }
    catch (e) { return null; } finally { clearTimeout(t); }
  };
  const parseHL = (html) => {
    const out = {};
    const parts = html.split(/([぀-ヿ一-龥]{2,5})競輪/);
    for (let i = 1; i < parts.length; i += 2) {
      const v = parts[i], block = parts[i + 1] || "";
      const heads = [];
      const raceRe = /class="race"[^>]*>\s*(\d{1,2})R/g;
      let hm;
      while ((hm = raceRe.exec(block))) heads.push({ pos: hm.index, rno: hm[1] });
      for (let k = 0; k < heads.length; k++) {
        const segEnd = k + 1 < heads.length ? heads[k + 1].pos : Math.min(block.length, heads[k].pos + 1500);
        const seg = block.slice(heads[k].pos, segEnd);
        const payM = seg.match(/class="refund"[^>]*>\s*([\d,]+)/);
        if (!payM) continue;
        const ordM = seg.match(/class="order"([\s\S]*?)<\/td>/);
        if (!ordM) continue;
        const chunk = ordM[1], pay = +payM[1].replace(/,/g, "");
        const cars = [...chunk.matchAll(/class="n(\d)"[^>]*>\s*(\d)\s*</g)].map((x) => +x[2]);
        if (!cars.length || !pay) continue;
        const syms = [...chunk.matchAll(/class="symbol"[^>]*>([\s\S]{0,8}?)<\//g)].map((x) => x[1]);
        const fuku = syms.some((s) => s.includes("=") || s.includes("＝"));
        const key = v + "_" + heads[k].rno + "R";
        const o = (out[key] = out[key] || { raw: [] });
        o.raw.push({ cars: cars.join(fuku ? "=" : "-"), pay, fuku });
        if (fuku) continue;
        if (cars.length === 3 && o.first == null) { o.first = cars[0]; o.second = cars[1]; o.third = cars[2]; o.p3pay = pay; }
        else if (cars.length === 2 && o.p2pay == null) { o.p2pay = pay; }
      }
    }
    return out;
  };

  const bad = E.filter((e) => e.p2pay != null && e.p3pay != null && e.p2pay >= e.p3pay);
  if (!bad.length) { console.log("\n(異常データなし。突き合わせ不要)"); return; }
  const targets = [];
  const seen = new Set();
  for (const e of bad) { if (!seen.has(e.date)) { seen.add(e.date); targets.push(e); } if (targets.length >= 3) break; }

  console.log("\n=== 実ページとの突き合わせ(異常データ" + bad.length + "件のうち代表" + targets.length + "件) ===");
  for (const e of targets) {
    const d = e.date, url = `https://keirin.kdreams.jp/harailist/${d.slice(0,4)}/${d.slice(4,6)}/${d.slice(6,8)}/`;
    const html = await get(url);
    if (!html) { console.log("  " + d + " " + e.place + e.raceNo + ": ページ取得失敗"); continue; }
    const t = parseHL(html)[e.place + "_" + e.raceNo];
    console.log("\n  【" + d + " " + e.place + " " + e.raceNo + "】 " + url);
    console.log("    保存値  : 着順 " + e.f + "-" + e.s + "-" + e.t + " / 3連単 " + (e.p3pay||0).toLocaleString() + "円 / 2車単 " + (e.p2pay||0).toLocaleString() + "円");
    if (!t) { console.log("    ページ  : このレースが見つかりません(場名・R番号が一致しない)"); continue; }
    console.log("    ページ  : 着順 " + (t.first!=null ? t.first+"-"+t.second+"-"+t.third : "—") + " / 3連単 " + (t.p3pay||0).toLocaleString() + "円 / 2車単 " + (t.p2pay||0).toLocaleString() + "円");
    console.log("    ページ内の全行(賭式ごと):");
    for (const r of (t.raw || []).slice(0, 8)) console.log("      " + (r.fuku ? "[複式]" : "[単式]") + " " + r.cars + " → " + r.pay.toLocaleString() + "円");
    const same = t.first === e.f && t.second === e.s && t.third === e.t && t.p3pay === e.p3pay && (t.p2pay ?? null) === (e.p2pay ?? null);
    console.log("    判定: " + (same ? "保存値=ページ値(パーサーはページ通りに読んでいる)" : "⚠ 不一致 → 保存データが古い(fixpayの結果が未コミットの可能性)"));
  }
})();
