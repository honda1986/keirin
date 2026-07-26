// ============================================================
// dbg_harai.js — 払戻ページの生HTML構造を調べる(3連単の行が取れない原因を特定)
// 使い方: node dbg_harai.js 2026-06-03
// ============================================================
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const d = (process.argv[2] || "2026-06-03").replace(/-/g, "");
const url = `https://keirin.kdreams.jp/harailist/${d.slice(0,4)}/${d.slice(4,6)}/${d.slice(6,8)}/`;

(async () => {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" } });
  const html = await res.text();
  console.log("URL:", url, "/ サイズ:", (html.length / 1024).toFixed(0) + "KB");

  const cnt = (re) => (html.match(re) || []).length;
  console.log("\n=== 出現数 ===");
  console.log('  class="race"  :', cnt(/class="race"/g));
  console.log('  class="order" :', cnt(/class="order"/g));
  console.log('  class="refund":', cnt(/class="refund"/g));
  console.log('  class="symbol":', cnt(/class="symbol"/g));
  console.log('  ○○競輪       :', cnt(/[぀-ヿ一-龥]{2,5}競輪/g));

  // 現行パーサーが何行取れているか
  const tokenRe = /([぀-ヿ一-龥]{2,5})競輪|class="race"[^>]*>\s*(\d{1,2})R[\s\S]{0,300}?class="order"([\s\S]{0,600}?)<\/td>[\s\S]{0,200}?class="refund"[^>]*>\s*([\d,]+)/g;
  let m, rows = 0, venues = 0;
  while ((m = tokenRe.exec(html))) { if (m[1]) venues++; else rows++; }
  console.log("\n=== 現行パーサーの結果 ===");
  console.log("  場名マーカー:", venues, "件 / レース行:", rows, "件");
  console.log("  → class=\"race\"が" + cnt(/class="race"/g) + "個あるのに" + rows + "行しか取れていなければ、取りこぼしています");

  // 最初のレース行の生HTMLを表示(構造確認用)
  const i = html.indexOf('class="race"');
  if (i >= 0) {
    console.log("\n=== 最初のレース行の生HTML(1200字) ===");
    console.log(html.slice(i - 100, i + 1200).replace(/\s+/g, " "));
  }

  // 3連単セクションの位置と、その直後のレース行
  const labels = ["3連単", "2車単", "3連複", "2車複", "ワイド"];
  console.log("\n=== 賭式ラベルの出現位置(先頭3件ずつ) ===");
  for (const L of labels) {
    const idxs = [];
    let p = -1;
    while ((p = html.indexOf(L, p + 1)) !== -1 && idxs.length < 3) idxs.push(p);
    console.log("  " + L + ":", idxs.join(", ") || "(なし)");
  }

  // 各 class="race" の直後にrefundが取れるかを個別チェック(最初の5件)
  console.log("\n=== 個別チェック(最初の5行) ===");
  const raceRe = /class="race"[^>]*>\s*(\d{1,2})R/g;
  let r, n = 0;
  while ((r = raceRe.exec(html)) && n < 5) {
    n++;
    const seg = html.slice(r.index, r.index + 1400);
    const hasOrder = seg.indexOf('class="order"');
    const hasRefund = seg.indexOf('class="refund"');
    const payM = seg.match(/class="refund"[^>]*>\s*([\d,]+)/);
    const nums = [...seg.slice(0, hasRefund > 0 ? hasRefund : 800).matchAll(/class="n(\d)"[^>]*>\s*(\d)\s*</g)].map((x) => x[2]);
    console.log("  " + n + ") " + r[1] + "R  order位置:" + hasOrder + " refund位置:" + hasRefund +
      " 車番:[" + nums.join(",") + "] 配当:" + (payM ? payM[1] : "取れず"));
  }
})();
