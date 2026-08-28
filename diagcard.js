// ============================================================
// diagcard.js — kdreamsのレース詳細ページが、プログラムからどう見えるかを出す
//   (読み取り専用・何も書き換えない)
//
// 出走表の取得元をGambooからkdreamsへ移すために、
// 実際に取れるテキストの並びを確認する。これを見てからパーサーを書く。
//
// 使い方: node diagcard.js              … 今日の最初のレース
//         node diagcard.js 2026-08-28   … 日付指定
//         node diagcard.js --len=6000   … 出力する文字数(既定4000)
// ============================================================
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const argv = process.argv.slice(2);
const LEN = (() => { const a = argv.find((x) => x.startsWith("--len=")); return a ? parseInt(a.split("=")[1], 10) : 4000; })();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 25000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: c.signal });
    return { status: r.status, body: await r.text() };
  } finally { clearTimeout(t); }
}
// index.html / fetch.js と同じ考え方でテキスト化する
function toText(html) {
  let s = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<img\b[^>]*\balt\s*=\s*["']([^"']*)["'][^>]*>/gi, (_, a) => {
    const v = a.replace(/\s+/g, " ").trim();
    return /^[1-9]$/.test(v) ? v : " ";
  });
  s = s.replace(/<(br|\/tr|\/td|\/th|\/p|\/div|\/li|\/h[1-6]|\/option)\b[^>]*>/gi, "\n")
       .replace(/<[^>]+>/g, " ")
       .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
       .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
  return s.replace(/ /g, " ")
    .replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n").trim();
}
(async () => {
  const arg = argv.find((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
  const d = arg || new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  console.log("対象日:", d, " 出力文字数:", LEN);
  const idxUrl = `https://keirin.kdreams.jp/odds/${d.slice(0,4)}/${d.slice(5,7)}/${d.slice(8,10)}/`;
  const idx = await get(idxUrl);
  console.log("日別一覧: HTTP", idx.status, "/", idx.body.length, "バイト");
  const m = [...idx.body.matchAll(/\/([a-z]+)\/racedetail\/(\d{16})\//g)];
  const uniq = [...new Map(m.map((x) => [x[2], x])).values()];
  console.log("見つかったレース:", uniq.length, "件");
  if (!uniq.length) { console.log("レースが見つかりません。日付を確認してください。"); return; }
  const one = uniq[0];
  const url = `https://keirin.kdreams.jp/${one[1]}/racedetail/${one[2]}/`;
  await sleep(500);
  const r = await get(url);
  const text = toText(r.body);
  console.log("\nレースページ:", url);
  console.log("HTTP", r.status, "/ HTML", r.body.length, "バイト / テキスト", text.length, "文字");
  for (const k of ["競走得点", "並び予想", "着外", "3連対率", "ギヤ", "選手コメント", "発走予定", "誘導員"]) {
    const i = text.indexOf(k);
    console.log("  目印「" + k + "」: " + (i >= 0 ? i + "文字目" : "★見つからない★"));
  }
  console.log("\n================ ここから本文(先頭" + LEN + "文字) ================");
  console.log(text.slice(0, LEN));
  console.log("================ 本文ここまで ================");
  const ni = text.indexOf("並び予想");
  if (ni >= 0 && ni > LEN) {
    console.log("\n---- 「並び予想」の周辺(本文の範囲外だったので抜粋) ----");
    console.log(text.slice(Math.max(0, ni - 200), ni + 400));
  }
  console.log("\n全" + text.length + "文字。足りなければ --len=8000 のように増やしてください。");
})();
