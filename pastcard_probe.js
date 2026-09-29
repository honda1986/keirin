// 一時的な点検(probe-formation ブランチだけ): 結果表示(pageType=showResult)に実際の周回があるか
"use strict";
const { htmlToText } = require("./cardtext.js");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const get = async (u) => { const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "ja" } }); return [r.status, await r.text()]; };
const lines = (h) => htmlToText(h).split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
(async () => {
  for (const url of ["https://keirin.kdreams.jp/gifu/racedetail/4320260926030012/?pageType=showResult",
                     "https://keirin.kdreams.jp/aomori/racedetail/1220220101010001/?pageType=showResult"]) {
    const [st, html] = await get(url);
    const L = lines(html);
    console.log("=====", url, st, "行", L.length);
    const idx = L.map((s, i) => [s, i]).filter(([s]) => /周回|初手|レース結果|決まり手|並び予想|最終|打鐘|赤板|ＨＳ|ＢＳ/.test(s)).map(([s, i]) => i + ":" + s.slice(0, 40));
    console.log("見出し", idx.slice(0, 40).join(" ¦ "));
    const a = L.findIndex((s) => /周回/.test(s));
    if (a >= 0) console.log("----- 周回", L.slice(a - 3, a + 90).join(" ¦ "));
    const r = L.findIndex((s, i) => /着順|着 順/.test(s));
    if (r >= 0) console.log("----- 着順", L.slice(r - 3, r + 150).join(" ¦ "));
    const imgs = [...new Set([...html.matchAll(/<img[^>]+(?:alt|src)="([^"]{0,120})"/g)].map((m) => m[1]))].filter((s) => /syukai|shukai|round|lap|周回|narabi/i.test(s));
    console.log("画像 " + imgs.slice(0, 20).join(" "));
    const m = html.indexOf("周回");
    if (m >= 0) console.log("----- HTML 周回付近", html.slice(m - 300, m + 3000).replace(/\s+/g, " "));
  }
})();
