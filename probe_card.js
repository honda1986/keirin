// probe_card.js — 過去のレースの出走表ページに、その当時の競走得点が残っているかを確かめる(読み取りのみ)
//   node probe_card.js YYYY-MM-DD [件数]
const { parseCard } = require("./engine.js");
const { TRACK_NAMES } = require("./bankdata.js");
const d = process.argv[2], N = +(process.argv[3] || 3);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
// fetch.js と同じ HTML→テキスト(fetch.js は読み込むと走り出すので、関数の部分だけ取り出して使う)
const src = require("fs").readFileSync(__dirname + "/fetch.js", "utf8");
const fnSrc = src.slice(src.indexOf("function htmlToText"), src.indexOf("// ---- ページは4万字あるので"));
const { htmlToText, withNarabiText } = new Function(fnSrc + "\nreturn { htmlToText, withNarabiText };")();
const toText = (h) => htmlToText(withNarabiText(h));
(async () => {
  const [y, m, dd] = d.split("-");
  const idx = await (await fetch(`https://keirin.kdreams.jp/odds/${y}/${m}/${dd}/`, { headers: { "User-Agent": UA } })).text();
  const seen = new Map(); for (const mm of idx.matchAll(/\/([a-z]+)\/racedetail\/(\d{16})\//g)) if (!seen.has(mm[2])) seen.set(mm[2], mm[1]);
  let c = 0;
  for (const [rid, roma] of seen) {
    if (c++ >= N) break;
    const html = await (await fetch(`https://keirin.kdreams.jp/${roma}/racedetail/${rid}/`, { headers: { "User-Agent": UA } })).text();
    let p; try { p = parseCard(toText(html), TRACK_NAMES); } catch (e) { console.log(rid, "読めない:", e.message, "本文", html.length); continue; }
    console.log(d, roma, rid, p.entries.map((e) => e.car + ":" + e.name + "(" + e.ki + ") 得点" + e.score + " 3連対" + (e.rate && e.rate.sanren)).join(" / "));
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
