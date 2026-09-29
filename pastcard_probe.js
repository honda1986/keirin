// 一時的な点検(probe-formation ブランチだけ): 結果の表(着順・S/B)の HTML の形。新しいレースと2022年のレース
"use strict";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const get = async (u) => { const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "ja" } }); return [r.status, await r.text()]; };
const strip = (s) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
async function show(url) {
  const [st, html] = await get(url);
  const i = html.indexOf("勝敗因");
  console.log("=====", url, st, "勝敗因の位置", i);
  if (i < 0) return;
  const t0 = html.lastIndexOf("<table", i), t1 = html.indexOf("</table>", i);
  const tb = html.slice(t0, t1);
  console.log("TABLE-OPEN", tb.slice(0, 300).replace(/\s+/g, " "));
  const rows = [...tb.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  for (const r of rows.slice(0, 4)) console.log("ROW-HTML", r.replace(/\s+/g, " ").slice(0, 1500));
  for (const r of rows) console.log("ROW", [...r.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => strip(m[1])).join(" | "));
  const j = html.indexOf("戦い終わって"); console.log("戦い終わって", j);
}
(async () => {
  await show("https://keirin.kdreams.jp/gifu/racedetail/4320260926030012/");
  for (const d of ["2022/03/15", "2024/06/15"]) {
    const [, idx] = await get("https://keirin.kdreams.jp/odds/" + d + "/");
    const u = [...idx.matchAll(/https?:\/\/keirin\.kdreams\.jp\/[a-z]+\/racedetail\/\d{16}\/|\/[a-z]+\/racedetail\/\d{16}\//g)].map((m) => m[0])[3];
    if (u) await show(u.startsWith("http") ? u : "https://keirin.kdreams.jp" + u); else console.log("no url", d);
  }
})();
