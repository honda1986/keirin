// probe_snap2.js — snap.js で読んだ倍率が odds-YYYYMM.json(確定オッズ)と一致するか(書き込みなし)
//   node probe_snap2.js YYYY-MM-DD [件数]
const fs = require("fs");
const { parseTrio, combos } = require("./snap.js");
const { TRACK_NAMES } = require("./bankdata.js");
const VENUE_PIDS = [11,12,13,21,22,23,24,25,26,27,28,31,32,34,35,36,37,38,42,43,44,45,46,47,48,51,53,54,55,56,61,62,63,71,73,74,75,81,83,84,85,86,87];
const PID2NAME = {}; TRACK_NAMES.forEach((n, i) => { PID2NAME[VENUE_PIDS[i]] = n; });
const d = process.argv[2], N = +(process.argv[3] || 12);
const d8 = d.replace(/-/g, "");
const saved = JSON.parse(fs.readFileSync("odds-" + d8.slice(0, 6) + ".json", "utf8")).races;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const [y, m, dd] = d.split("-");
  const idx = await (await fetch(`https://keirin.kdreams.jp/odds/${y}/${m}/${dd}/`, { headers: { "User-Agent": UA } })).text();
  const seen = new Map();
  for (const mm of idx.matchAll(/\/([a-z]+)\/racedetail\/(\d{16})\//g)) if (!seen.has(mm[2])) seen.set(mm[2], mm[1]);
  let ok = 0, ng = 0, cnt = 0;
  for (const [rid, roma] of seen) {
    if (cnt >= N) break;
    const id = d8 + "_" + PID2NAME[parseInt(rid.slice(0, 2), 10)] + "_" + parseInt(rid.slice(-4), 10) + "R";
    const s = saved[id]; if (!s) continue;
    cnt++;
    const p = parseTrio(await (await fetch(`https://keirin.kdreams.jp/${roma}/racedetail/${rid}/?pageType=odds&kakeshikiType=3renhuku`, { headers: { "User-Agent": UA } })).text());
    const cs = combos(s.cars);
    const diff = cs.filter((k, i) => (p.odds.get(k) ?? null) !== (s.o[i] || null));
    if (diff.length) ng++; else ok++;
    console.log(id, s.cars + "車", "一覧", p.pop + "+" + p.high, "一致", cs.length - diff.length + "/" + cs.length, diff.slice(0, 3).map((k) => k + ":" + p.odds.get(k) + " vs " + s.o[cs.indexOf(k)]).join(" "));
    await sleep(700);
  }
  console.log("全組一致", ok, "/ 不一致あり", ng);
})().catch((e) => { console.error(e); process.exit(1); });
