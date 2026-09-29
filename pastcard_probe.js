// 一時的な点検(probe-formation ブランチだけ): 終わったレースのページに「実際の並び(周回・初手)」があるか
"use strict";
const { htmlToText } = require("./cardtext.js");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const get = async (u) => { const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "ja" } }); return [r.status, await r.text()]; };
const lines = (h) => htmlToText(h).split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
const abs = (h) => (h.startsWith("http") ? h : "https://keirin.kdreams.jp" + (h.startsWith("/") ? "" : "/") + h);
(async () => {
  const [, idx] = await get("https://keirin.kdreams.jp/odds/2026/09/28/");
  const urls = [...new Set([...idx.matchAll(/\/gifu\/racedetail\/\d{16}\//g)].map((m) => m[0]))];
  console.log("岐阜のURL", urls.join(" "));
  const url = abs(urls.find((u) => u.endsWith("0012/")) || urls[urls.length - 1]);
  const [st, html] = await get(url);
  const L = lines(html);
  console.log("=====", url, st, html.length, "行", L.length);
  const hrefs = [...new Set([...html.matchAll(/href="([^"#]+)"/g)].map((m) => m[1]))].filter((h) => /gifu|result|kekka|syosai|detail|aokei|race/i.test(h));
  console.log("LINKS\n" + hrefs.slice(0, 80).join("\n"));
  const i0 = L.findIndex((s) => /出走表|並び予想/.test(s));
  console.log("----- 本文(並び予想の前後)");
  console.log(L.slice(Math.max(0, i0 - 5), i0 + 220).join(" ¦ "));
  const hit = L.map((s, i) => [s, i]).filter(([s]) => /周回|初手|赤板|打鐘|経過|前受|詳細結果|レース結果|決まり手/.test(s)).slice(0, 40);
  console.log("----- キーワード", hit.map(([s, i]) => i + ":" + s).join(" ¦ "));
  for (const h of hrefs.filter((h) => /result|kekka|syosai|aokei/i.test(h) && !/odds/i.test(h)).slice(0, 4)) {
    const [s2, h2] = await get(abs(h));
    const L2 = lines(h2);
    console.log("===== リンク先", abs(h), s2, "行", L2.length);
    const j = L2.findIndex((s) => /周回|初手|並び|結果/.test(s));
    console.log(L2.slice(Math.max(0, j - 5), j + 200).join(" ¦ "));
  }
})();
