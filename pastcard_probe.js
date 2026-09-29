// 一時的な点検(probe-formation ブランチだけ): 終わったレースのページに「実際の並び(周回・初手)」があるか
"use strict";
const { htmlToText } = require("./cardtext.js");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const URLS = [
  "https://keirin.kdreams.jp/gifu/racedetail/3420260928000012/",
  "https://keirin.kdreams.jp/gifu/racedetail/3420260928000010/",
];
const KEY = /周回|初手|赤板|打鐘|レース経過|展開|位置|前受|並び|ＨＳ|ＢＳ|HS|BS|ジャン|誘導|決まり手|勝敗因|S\/B|Ｓ|Ｂ/;
(async () => {
  for (const u of URLS) {
    const res = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "ja" } });
    const html = await res.text();
    console.log("=====", u, res.status, html.length);
    const links = [...new Set([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => /result|kekka|race|movie|syukai|shukai|keika/i.test(h)))].slice(0, 60);
    console.log("LINKS", links.join(" "));
    const L = htmlToText(html).split("\n").map((s) => s.trim()).filter(Boolean);
    L.forEach((s, i) => { if (KEY.test(s)) console.log("L" + i + ": " + L.slice(Math.max(0, i - 1), i + 6).join(" | ").slice(0, 300)); });
    // 表の見出し
    for (const m of html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)) { const t = m[1].replace(/<[^>]+>/g, "").trim(); if (t) process.stdout.write("[TH " + t + "] "); }
    console.log();
    const cls = [...new Set([...html.matchAll(/class="([^"]+)"/g)].map((m) => m[1]))].filter((c) => /result|syukai|shukai|round|lap|narabi|line|tenkai|keika/i.test(c));
    console.log("CLASSES", cls.join(" "));
  }
})();
