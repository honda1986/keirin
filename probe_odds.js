// probe_odds.js — 締切前オッズが取れるかの下調べ(読み取りのみ・書き込みなし)
//   node probe_odds.js [YYYY-MM-DD]
// 日別一覧から最初の数レースを選び、3連複・3連単・2車単のオッズページを1回ずつ読んで
// 本文の長さ・取れた組数・更新時刻らしき表記・欠車らしき表記を出す。
const d = process.argv[2] || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" } });
  const html = await res.text();
  return { status: res.status, html, ms: Date.now() - t0 };
}
const toText = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
(async () => {
  const [y, m, dd] = d.split("-");
  const idx = await get(`https://keirin.kdreams.jp/odds/${y}/${m}/${dd}/`);
  console.log("日別一覧", idx.status, idx.html.length, "文字", idx.ms + "ms");
  const seen = new Set(), list = [];
  for (const mm of idx.html.matchAll(/\/([a-z]+)\/racedetail\/(\d{16})\//g)) if (!seen.has(mm[2])) { seen.add(mm[2]); list.push([mm[1], mm[2]]); }
  console.log("レース", list.length, "件  例:", list.slice(0, 3).map((x) => x.join("/")).join(" "));
  // 場ごとに1レースずつ、最大4場
  const byPlace = new Map(); for (const x of list) if (!byPlace.has(x[0])) byPlace.set(x[0], x);
  for (const [roma, rid] of [...byPlace.values()].slice(0, 4)) {
    for (const kind of ["3renhuku", "3rentan", "2rentan"]) {
      const url = `https://keirin.kdreams.jp/${roma}/racedetail/${rid}/?pageType=odds&kakeshikiType=${kind}`;
      const r = await get(url);
      const text = toText(r.html);
      const re = kind === "3renhuku" ? /(\d)\s*=\s*(\d)\s*=\s*(\d)[^\d]{0,24}?([\d,]+(?:\.\d+)?)/g
               : kind === "3rentan" ? /(\d)\s*-\s*(\d)\s*-\s*(\d)[^\d]{0,24}?([\d,]+(?:\.\d+)?)/g
               : /(?<![\d-])(\d)\s*-\s*(\d)(?!\s*-)[^\d]{0,24}?([\d,]+(?:\.\d+)?)/g;
      const got = new Set(); let sample = [];
      for (const mm of text.matchAll(re)) { got.add(mm.slice(1, -1).join("-")); if (sample.length < 4) sample.push(mm[0].slice(0, 40)); }
      const upd = (text.match(/(\d{1,2}:\d{2})\s*(?:現在|時点|更新)|(?:更新|現在)[^0-9]{0,10}(\d{1,2}:\d{2})/) || [])[0];
      const status = (text.match(/(発売中|発売前|締切|確定|前売|オッズ未発表|発売締切)[^ ]{0,10}/g) || []).slice(0, 6);
      const kek = (text.match(/欠車|欠場|取消|---|－－/g) || []).length;
      console.log(`\n[${roma} ${rid} ${kind}] ${r.status} ${r.html.length}文字 ${r.ms}ms 組=${got.size} 更新=${upd || "?"} 状態=${JSON.stringify(status)} 欠車等=${kek}`);
      console.log("  例:", sample.join(" | "));
      // 表の構造を知るため、最初の組の前後を少し出す
      const i = text.search(re === null ? /x/ : (kind === "3renhuku" ? /\d\s*=\s*\d\s*=\s*\d/ : /\d\s*-\s*\d/));
      if (i >= 0) console.log("  前後:", text.slice(Math.max(0, i - 200), i + 300));
      await sleep(800);
    }
  }
})().catch((e) => { console.error("失敗:", e.message); process.exit(1); });
