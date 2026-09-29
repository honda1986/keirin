// 一時的な点検(probe-formation ブランチだけ): 終わったレースのページに「実際の並び(周回・初手)」があるか
"use strict";
const { htmlToText } = require("./cardtext.js");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const get = async (u) => { const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "ja" } }); return [r.status, await r.text()]; };
(async () => {
  const [, idx] = await get("https://keirin.kdreams.jp/odds/2026/09/28/");
  const urls = [...new Set([...idx.matchAll(/https?:\/\/keirin\.kdreams\.jp\/gifu\/racedetail\/\d{16}\/|\/gifu\/racedetail\/\d{16}\//g)].map((m) => m[0]))];
  console.log("岐阜のURL", urls.join(" "));
  const u12 = urls.find((u) => u.endsWith("0012/")) || urls[urls.length - 1];
  const url = u12.startsWith("http") ? u12 : "https://keirin.kdreams.jp" + u12;
  const [st, html] = await get(url);
  console.log("=====", url, st, html.length);
  const links = [...new Set([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]))].filter((h) => /gifu|result|kekka|race/i.test(h)).slice(0, 80);
  console.log("LINKS", links.join(" "));
  const text = htmlToText(html);
  console.log(text.slice(0, 20000));
  // 結果ページらしいリンクがあれば中身も
  for (const h of links.filter((h) => /result|kekka/i.test(h)).slice(0, 3)) {
    const u2 = h.startsWith("http") ? h : "https://keirin.kdreams.jp" + h;
    const [s2, h2] = await get(u2);
    console.log("===== 結果?", u2, s2, h2.length);
    console.log(htmlToText(h2).slice(0, 15000));
  }
})();
