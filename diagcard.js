// ============================================================
// diagcard.js v3 — 選手ブロックと並び予想だけを狙って出す(読み取り専用)
//   「府県/年齢/期別」の行を目印に選手を見つけ、その前後だけを表示する。
//
// 使い方: node diagcard.js                … 今日の最初のレース
//         node diagcard.js --after=30     … 選手ごとに何行先まで出すか(既定26)
//         node diagcard.js --riders=3     … 何人分出すか(既定3)
//         node diagcard.js 2026-08-28
// ============================================================
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const argv = process.argv.slice(2);
const opt = (k, d) => { const a = argv.find((x) => x.startsWith("--" + k + "=")); return a ? parseInt(a.split("=")[1], 10) : d; };
const AFTER = opt("after", 26), NRIDERS = opt("riders", 3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 25000);
  try { const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: c.signal }); return { status: r.status, body: await r.text() }; }
  finally { clearTimeout(t); }
}
function toText(html) {
  let s = String(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<img\b[^>]*\balt\s*=\s*["']([^"']*)["'][^>]*>/gi, (_, a) => { const v = a.replace(/\s+/g, " ").trim(); return /^[1-9]$/.test(v) ? v : " "; });
  s = s.replace(/<(br|\/tr|\/td|\/th|\/p|\/div|\/li|\/h[1-6]|\/option|\/a|\/span)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ")
       .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
       .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
  return s.replace(/ /g, " ").replace(/[ \t]+/g, " ");
}
(async () => {
  const arg = argv.find((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
  const d = arg || new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const idx = await get(`https://keirin.kdreams.jp/odds/${d.slice(0,4)}/${d.slice(5,7)}/${d.slice(8,10)}/`);
  const m = [...idx.body.matchAll(/\/([a-z]+)\/racedetail\/(\d{16})\//g)];
  const uniq = [...new Map(m.map((x) => [x[2], x])).values()];
  if (!uniq.length) { console.log("レースが見つかりません"); return; }
  const one = uniq[0];
  const url = `https://keirin.kdreams.jp/${one[1]}/racedetail/${one[2]}/`;
  await sleep(400);
  const r = await get(url);
  const L = toText(r.body).split("\n").map((x) => x.trim()).filter(Boolean);
  console.log(url + "  HTTP " + r.status + " / 有効行 " + L.length + "\n");

  // 「府県/年齢/期別」の行(例: 三　重/31/117)を選手の目印にする
  const PROF = /^[^\/\s]{1,6}[\s　]?[^\/\s]{0,6}\/\d{1,2}\/\d{1,3}$/;
  const idxs = L.map((x, i) => (PROF.test(x) ? i : -1)).filter((i) => i >= 0);
  console.log("【選手らしき行】" + idxs.length + "件  行番号: " + idxs.slice(0, 12).map((i) => i + 1).join(", "));
  console.log("(この件数が出走人数と合っていれば、目印として使えます)\n");

  for (const i of idxs.slice(0, NRIDERS)) {
    console.log("──── 選手ブロック (" + (i + 1) + "行目のプロフィール行を中心に) ────");
    for (let j = Math.max(0, i - 4); j < Math.min(L.length, i + AFTER); j++) {
      console.log(String(j + 1).padStart(5) + "| " + (j === i ? "★" : " ") + L[j].slice(0, 70));
    }
    console.log("");
  }
  // 並び予想
  const ni = L.findIndex((x) => x === "並び予想" || x.includes("並び予想"));
  if (ni >= 0) {
    console.log("──── 並び予想 ────");
    for (let j = ni; j < Math.min(L.length, ni + 40); j++) {
      console.log(String(j + 1).padStart(5) + "| " + L[j].slice(0, 70));
      if (L[j].includes("レース評")) break;
    }
  }
  // ---- 研究所048の補正に必要な3項目があるか ----
  console.log("\n──── 研究所048に必要な項目の有無 ────");
  const joined = L.join("\n");
  const probe = [
    ["前得点(現/前)", /\/\s?\d{1,3}\.\d{2}/],
    ["「前得点」の語", /前得点/],
    ["上がりタイム(11.xのような値)", /^1[0-3]\.\d$/m],
    ["「上り」「上がり」の語", /上[がり]?り?タイム|上り/],
    ["前走成績の着順表記", /前走|前回出走/],
    ["今場所成績", /今場所/],
  ];
  for (const [n, re] of probe) console.log("  " + n.padEnd(28) + (re.test(joined) ? "あり" : "★なし★"));
  for (const k of ["前走", "今場所", "上り", "前得点"]) {
    const i = L.findIndex((x) => x.includes(k));
    if (i >= 0) {
      console.log("\n  ---- 「" + k + "」まわり(" + (i + 1) + "行目) ----");
      for (let j = i; j < Math.min(L.length, i + 18); j++) console.log("  " + String(j + 1).padStart(5) + "| " + L[j].slice(0, 60));
    }
  }

  // 着度数・成績まわりの見出し
  const hi = L.findIndex((x) => x === "着外");
  if (hi >= 0) { console.log("\n──── 「着外」まわり ────");
    for (let j = Math.max(0, hi - 14); j < Math.min(L.length, hi + 6); j++) console.log(String(j + 1).padStart(5) + "| " + L[j].slice(0, 70)); }
})();
