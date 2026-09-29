// 一時的な点検(probe-formation ブランチだけ): 終わったレースのページの「レース結果」の中身
"use strict";
const { htmlToText } = require("./cardtext.js");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const get = async (u) => { const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "ja" } }); return [r.status, await r.text()]; };
const lines = (h) => htmlToText(h).split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
(async () => {
  for (const url of ["https://keirin.kdreams.jp/gifu/racedetail/4320260926030012/", "https://keirin.kdreams.jp/gifu/racedetail/4320260926030004/"]) {
    const [st, html] = await get(url);
    const L = lines(html);
    console.log("=====", url, st, "行", L.length);
    const a = L.findIndex((s) => /並び予想/.test(s));
    console.log("----- 並び予想", L.slice(a, a + 25).join(" ¦ "));
    const b = L.findIndex((s, i) => i > a + 30 && /レース評|周回|初手|展開|記者/.test(s));
    console.log("----- 後半", L.slice(Math.max(a + 25, b - 5), b + 60).join(" ¦ "));
    const c = L.findIndex((s) => /^レース結果$/.test(s));
    console.log("----- レース結果", L.slice(c, c + 160).join(" ¦ "));
    const hrefs = [...new Set([...html.matchAll(/href="([^"#]+)"/g)].map((m) => m[1]))].filter((h) => /result|detail|syosai|aokei|kekka|movie|digest/i.test(h) && !/racedetail\/\d+\/\?l-id=l-pc-srdi-srdi-raceinfo_kaisai_detail_race_nav/.test(h));
    console.log("LINKS " + hrefs.slice(0, 40).join(" "));
    // 周回の図(画像や class)を探す
    const m = html.match(/(syukai|shukai|narabi|lap|round)[^"]{0,40}/gi);
    console.log("CLASS候補 " + [...new Set(m || [])].slice(0, 30).join(" "));
  }
})();
