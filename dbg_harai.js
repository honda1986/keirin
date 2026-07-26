// ============================================================
// dbg_harai.js v3 — 新パーサー(場分割方式)が実ページで機能するか検証する
// 使い方: node dbg_harai.js 2026-06-03 前橋 5
// ============================================================
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const d = (process.argv[2] || "2026-06-03").replace(/-/g, "");
const wantVenue = process.argv[3] || "前橋";
const wantRace = (process.argv[4] || "5") + "R";
const url = `https://keirin.kdreams.jp/harailist/${d.slice(0,4)}/${d.slice(4,6)}/${d.slice(6,8)}/`;

// ---- 新パーサー(場ごとに分割してから行を読む) ----
function parseNew(html) {
  const out = {};
  const parts = html.split(/([぀-ヿ一-龥]{2,5})競輪/);
  for (let i = 1; i < parts.length; i += 2) {
    const venue = parts[i], block = parts[i + 1] || "";
    const rowRe = /class="race"[^>]*>\s*(\d{1,2})R[\s\S]{0,300}?class="order"([\s\S]{0,600}?)<\/td>[\s\S]{0,200}?class="refund"[^>]*>\s*([\d,]+)/g;
    let m;
    while ((m = rowRe.exec(block))) {
      if ((m[0].match(/class="race"/g) || []).length > 1) continue;
      const chunk = m[2], pay = +m[3].replace(/,/g, "");
      const cars = [...chunk.matchAll(/class="n(\d)"[^>]*>\s*(\d)\s*</g)].map((x) => +x[2]);
      if (!cars.length || !pay) continue;
      const syms = [...chunk.matchAll(/class="symbol"[^>]*>([\s\S]{0,8}?)<\//g)].map((x) => x[1]);
      const fuku = syms.some((s) => s.includes("=") || s.includes("＝"));
      const key = venue + "_" + m[1] + "R";
      const o = (out[key] = out[key] || { raw: [] });
      o.raw.push({ cars: cars.join(fuku ? "=" : "-"), pay, fuku });
      if (fuku) continue;
      if (cars.length === 3 && o.first == null) { o.first = cars[0]; o.second = cars[1]; o.third = cars[2]; o.p3pay = pay; }
      else if (cars.length === 2 && o.p2pay == null) { o.p2pay = pay; }
    }
  }
  return out;
}

(async () => {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" } });
  const html = await res.text();
  console.log("パーサー版: v3(場分割方式)");
  console.log("URL:", url, "/", (html.length / 1024).toFixed(0) + "KB");

  const r = parseNew(html);
  const keys = Object.keys(r);
  const with3 = keys.filter((k) => r[k].first != null).length;
  const with2 = keys.filter((k) => r[k].p2pay != null).length;
  console.log("\n=== 新パーサーの結果 ===");
  console.log("  レース数:", keys.length, "/ 3連単あり:", with3, "/ 2車単あり:", with2);
  console.log("  → 3連単ありがレース数とほぼ同じなら成功");

  const key = wantVenue + "_" + wantRace;
  console.log("\n=== 指定レース [" + key + "] ===");
  if (!r[key]) {
    console.log("  見つかりません。この日のこの場の全レース:");
    console.log("   ", keys.filter((k) => k.startsWith(wantVenue + "_")).join(" ") || "(この場のレースが1つもない)");
    console.log("  ページに含まれる場(先頭20):");
    console.log("   ", [...new Set(keys.map((k) => k.split("_")[0]))].slice(0, 20).join(" "));
  } else {
    const x = r[key];
    console.log("  着順:", x.first != null ? x.first + "-" + x.second + "-" + x.third : "—",
      "/ 3連単:", (x.p3pay || 0).toLocaleString() + "円 / 2車単:", (x.p2pay || 0).toLocaleString() + "円");
    console.log("  読み取った全行:");
    for (const y of x.raw) console.log("    " + (y.fuku ? "[複式]" : "[単式]") + " " + y.cars + " → " + y.pay.toLocaleString() + "円");
  }

  // 指定場の生HTMLを確認(3連単テーブルがどう書かれているか)
  const vi = html.indexOf(wantVenue + "競輪");
  console.log("\n=== 「" + wantVenue + "競輪」1回目の出現直後の生HTML(900字) ===");
  console.log(vi >= 0 ? html.slice(vi, vi + 900).replace(/\s+/g, " ") : "(見つからず)");
  const vi2 = html.indexOf(wantVenue + "競輪", vi + 1);
  console.log("\n=== 「" + wantVenue + "競輪」2回目の出現直後の生HTML(500字) ===");
  console.log(vi2 >= 0 ? html.slice(vi2, vi2 + 500).replace(/\s+/g, " ") : "(2回目なし)");
})();
