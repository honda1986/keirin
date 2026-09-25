// probe_snap.js — snap.js の読み取りを実ページで確かめる(書き込みなし)
//   node probe_snap.js YYYY-MM-DD   … その日の各場の1Rと最終Rを読んで、組数・9999.9・更新時刻を出す
const { parseTrio, combos } = require("./snap.js");
const d = process.argv[2];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const [y, m, dd] = d.split("-");
  const idx = await (await fetch(`https://keirin.kdreams.jp/odds/${y}/${m}/${dd}/`, { headers: { "User-Agent": UA } })).text();
  const seen = new Map();
  for (const mm of idx.matchAll(/\/([a-z]+)\/racedetail\/(\d{16})\//g)) { const k = mm[2]; if (!seen.has(k)) seen.set(k, mm[1]); }
  const ids = [...seen.keys()];
  const pick = ids.filter((id, i) => i < 3 || /0012$|0011$|0009$/.test(id)).slice(0, 10);
  for (const rid of pick) {
    const html = await (await fetch(`https://keirin.kdreams.jp/${seen.get(rid)}/racedetail/${rid}/?pageType=odds&kakeshikiType=3renhuku`, { headers: { "User-Agent": UA } })).text();
    const p = parseTrio(html);
    if (!p.odds.size) { const t = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "); let k = -1; while ((k = t.indexOf("人気順", k + 1)) >= 0) console.log("   人気順@" + k + ": " + t.slice(k, k + 80)); }
    const keys = [...p.odds.keys()];
    const n = Math.max(...keys.flatMap((k) => k.split("=").map(Number)));
    const cs = combos(n);
    const miss = cs.filter((k) => !p.odds.has(k)).length;
    const big = [...p.odds.values()].filter((v) => v >= 9999).length;
    const inv = [...p.odds.values()].filter((v) => v < 9999).reduce((a, v) => a + 1 / v, 0);
    console.log(seen.get(rid), rid, "一覧", p.pop + "+" + p.high, "食い違い", p.clash, "更新", p.upd, "組", p.odds.size, "/", cs.length, "(最大車番", n + ")", "欠け", miss, "9999.9", big, "Σ1/オッズ", inv.toFixed(3), "最安", Math.min(...p.odds.values()));
    await sleep(700);
  }
})().catch((e) => { console.error(e); process.exit(1); });
