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
console.log("=== 2車単データの点検 ===");
console.log("全エントリ:", E.length, "件");
console.log("2車単配当あり:", p2.length, "件 / 平均", avg(p2).toLocaleString() + "円 / 中央値", med(p2).toLocaleString() + "円");
console.log("");
console.log("【判定の目安】実際の競輪の2車単は 中央値 700〜1,200円 程度、平均 1,500〜2,500円 程度。");
const okMed = med(p2) >= 500 && med(p2) <= 2000;
console.log("  → 中央値", med(p2).toLocaleString() + "円:", okMed ? "✓ 妥当な範囲" : "⚠ 想定外(配当データを要確認)");
console.log("");
console.log("※3連単は現在の戦略(2車単スジ相手)で使わないため、点検対象から外しています。");
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
const baseRoi = bet ? (ret / (bet * 100) * 100) : 0;
console.log("=== 基準値: 2車単スジ相手を全レースに適用 ===");
console.log("  対象", n, "R / 的中率", (hit / n * 100).toFixed(1) + "% / 回収率", baseRoi.toFixed(1) + "%");
console.log("  ※ 競輪の控除率は25%。無条件で買えば回収率は75%前後になるのが自然です。");
console.log("  →", baseRoi > 95 ? "⚠ 100%近く/超えています。配当データが実際より高い可能性があります。"
  : baseRoi < 60 ? "⚠ 低すぎます。取りこぼしの可能性があります。"
  : "✓ 妥当な水準です(この基準値を上回る構成が本物の優位性)");

// ===== 月別の基準値(過去データ収集の「未来のぞき」を検出) =====
// backfillは過去日の出走表を後から取得するため、ページ上の競走得点・直近成績に
// そのレースの結果が反映されている可能性がある(未来の情報が予想に混入)。
// もし過去の月ほど回収率が高ければ、その汚染が起きている強い証拠になる。
{
  const sjm2 = (L, c) => { const l = (L || []).find((x) => x.includes(c)); if (!l || l.length < 2) return []; const i = l.indexOf(c); const o = []; if (i > 0) o.push(l[i - 1]); if (i < l.length - 1) o.push(l[i + 1]); return o; };
  const byMonth = {};
  for (const e of E) {
    if (e.p2pay == null || !Array.isArray(e.ranks) || !e.ranks.length || !e.lines || !e.date) continue;
    const m = sjm2(e.lines, e.ranks[0]);
    if (!m.length) continue;
    const t = m.map((c) => e.ranks[0] + "-" + c);
    const k = e.date.slice(0, 6);
    const v = (byMonth[k] = byMonth[k] || { n: 0, bet: 0, hit: 0, ret: 0 });
    v.n++; v.bet += t.length;
    if (t.includes(e.f + "-" + e.s)) { v.hit++; v.ret += e.p2pay; }
  }
  console.log("\n=== 月別の基準値(2車単スジ相手・全レース) ===");
  console.log("月        n      的中率   回収率");
  const keys = Object.keys(byMonth).sort();
  for (const k of keys) {
    const v = byMonth[k];
    if (v.n < 50) continue;
    const roi = v.bet ? (v.ret / (v.bet * 100) * 100) : 0;
    console.log("  " + k.slice(0, 4) + "/" + k.slice(4) + "  " + String(v.n).padStart(5) + "  " +
      (v.hit / v.n * 100).toFixed(1).padStart(6) + "%  " + roi.toFixed(1).padStart(6) + "%" +
      (roi >= 95 ? "  ⚠" : ""));
  }
  console.log("  ※ 本来はどの月も75%前後になるはず。");
  console.log("    古い月だけ高い場合 → 過去データ収集で結果反映後の成績を見てしまっている(未来のぞき)。");
  console.log("    その場合、信用できるのは「当日収集した最近の月」の数字です。");
}

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

  const bad = E.filter((e) => e.p2pay != null && (e.p2pay < 100 || e.p2pay > 100000));
  if (!bad.length) { console.log("\n(2車単配当に異常値なし。突き合わせ不要)"); return; }
  const targets = [];
  const seen = new Set();
  for (const e of bad) { if (!seen.has(e.date)) { seen.add(e.date); targets.push(e); } if (targets.length >= 3) break; }

  console.log("\n=== 実ページとの突き合わせ(2車単の異常値" + bad.length + "件のうち代表" + targets.length + "件) ===");
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
