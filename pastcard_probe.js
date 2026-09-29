// 一時的な点検(probe-formation ブランチだけ)
"use strict";
const { htmlToText } = require("./cardtext.js");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const get = async (u) => { try { const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, redirect: "follow" }); return [r.status, await r.text(), r.url]; } catch (e) { return [0, "", String(e)]; } };
const lines = (h) => htmlToText(h).split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
(async () => {
  const url = "https://keirin.kdreams.jp/gifu/racedetail/4320260926030012/";
  const [st, html] = await get(url);
  const L = lines(html);
  console.log("----- 結果の周り", L.slice(4960, 5260).join(" ¦ "));
  const hrefs = [...new Set([...html.matchAll(/href="([^"#]+)"/g)].map((m) => m[1]))];
  console.log("aokei系 " + hrefs.filter((h) => /aokei|kisha|yosou|detailresult|kekka/i.test(h)).join(" "));
  const k = html.indexOf("詳細結果"); console.log("詳細結果 HTML", html.slice(Math.max(0, k - 400), k + 100).replace(/\s+/g, " "));
  // ほかのサイト(つながるか・周回があるか)
  for (const u of ["https://keirin.jp/", "https://keirin.netkeiba.com/", "https://www.winticket.jp/keirin", "https://www.oddspark.com/keirin/", "https://www.chariloto.com/keirin"]) {
    const [s, h, fu] = await get(u);
    console.log("SITE", u, s, h.length, fu, (h.match(/周回/g) || []).length);
  }
})();
