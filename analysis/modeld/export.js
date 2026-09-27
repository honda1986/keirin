// 分析用に1レース1行の JSONL を書く: 出走表(riders)・並び・着順・3連複の全組オッズ・3連複配当
//   node export.js <rb.json> <out.jsonl>
"use strict";
const fs = require("fs"), path = require("path");
const K = require("path").join(__dirname, "..", "..");
const RB = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = fs.createWriteStream(process.argv[3]);
const oc = {};
const odds3 = (id) => { const ym = id.slice(0, 6); if (!(ym in oc)) { try { oc[ym] = JSON.parse(fs.readFileSync(path.join(K, "odds-" + ym + ".json"), "utf8")).races; } catch (e) { oc[ym] = {}; } } return oc[ym][id]; };
let n = 0, skip = 0;
for (const [id, r] of Object.entries(RB)) {
  const O = odds3(id);
  if (!r.fin || !O || O.cars !== r.n || !r.riders || r.riders.some((x) => !x[7])) { skip++; continue; }
  const [d8, place, rno] = id.split("_");
  out.write(JSON.stringify({ id, y: +d8.slice(0, 4), m: +d8.slice(4, 6), place, n: r.n, lines: r.lines, riders: r.riders, fin: r.fin,
    p3f: r.p3f || null, o: O.o }) + "\n");
  n++;
}
out.end(() => console.log("書いた", n, "飛ばした", skip));
