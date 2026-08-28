// ============================================================
// diagcard.js v2 — kdreamsのレース詳細ページの中身を、コンパクトに出す
//   (読み取り専用・何も書き換えない)
// 空行を潰し、行番号を付けて出力するのでログが短く済む。
//
// 使い方: node diagcard.js               … 今日の最初のレース(先頭160行)
//         node diagcard.js --lines=300   … 行数を増やす
//         node diagcard.js --from=200    … 200行目から表示
//         node diagcard.js 2026-08-28    … 日付指定
// ============================================================
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const argv = process.argv.slice(2);
const opt = (k, d) => { const a = argv.find((x) => x.startsWith("--" + k + "=")); return a ? parseInt(a.split("=")[1], 10) : d; };
const LINES = opt("lines", 160), FROM = opt("from", 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 25000);
  try { const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: c.signal }); return { status: r.status, body: await r.text() }; }
  finally { clearTimeout(t); }
}
function toText(html) {
  let s = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<img\b[^>]*\balt\s*=\s*["']([^"']*)["'][^>]*>/gi, (_, a) => {
    const v = a.replace(/\s+/g, " ").trim(); return /^[1-9]$/.test(v) ? v : " "; });
  s = s.replace(/<(br|\/tr|\/td|\/th|\/p|\/div|\/li|\/h[1-6]|\/option|\/a|\/span)\b[^>]*>/gi, "\n")
       .replace(/<[^>]+>/g, " ")
       .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
       .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
  return s.replace(/ /g, " ").replace(/[ \t]+/g, " ");
}
(async () => {
  const arg = argv.find((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
  const d = arg || new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const idx = await get(`https://keirin.kdreams.jp/odds/${d.slice(0,4)}/${d.slice(5,7)}/${d.slice(8,10)}/`);
  const m = [...idx.body.matchAll(/\/([a-z]+)\/racedetail\/(\d{16})\//g)];
  const uniq = [...new Map(m.map((x) => [x[2], x])).values()];
  console.log("対象日 " + d + " / レース " + uniq.length + "件");
  if (!uniq.length) return;
  const one = uniq[0];
  const url = `https://keirin.kdreams.jp/${one[1]}/racedetail/${one[2]}/`;
  await sleep(400);
  const r = await get(url);
  const raw = toText(r.body);
  // 空行を捨てて行番号を振る
  const L = raw.split("\n").map((x) => x.trim()).filter((x) => x.length > 0);
  console.log(url + "  HTTP " + r.status + " / 有効行 " + L.length + "行\n");
  const find = (k) => { const i = L.findIndex((x) => x.includes(k)); return i < 0 ? "なし" : (i + 1) + "行目"; };
  console.log("【目印の行番号】");
  for (const k of ["競走得点", "並び予想", "着外", "連対", "ギヤ", "コメント", "発走予定", "誘導員", "勝率", "レース評"])
    console.log("  " + k + " : " + find(k));
  const a = Math.max(0, FROM - 1), b = Math.min(L.length, a + LINES);
  console.log("\n===== " + (a + 1) + "〜" + b + "行目 =====");
  for (let i = a; i < b; i++) console.log(String(i + 1).padStart(4) + "| " + L[i].slice(0, 90));
  console.log("===== ここまで(全" + L.length + "行)=====");
  const ni = L.findIndex((x) => x.includes("並び予想"));
  if (ni >= 0 && (ni + 1 < a + 1 || ni + 1 > b)) {
    console.log("\n----- 並び予想のまわり -----");
    for (let i = Math.max(0, ni - 3); i < Math.min(L.length, ni + 12); i++) console.log(String(i + 1).padStart(4) + "| " + L[i].slice(0, 90));
  }
  console.log("\n続きは --from=" + (b + 1) + " で見られます。");
})();
