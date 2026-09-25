// ============================================================
// snap_pack.js — snap.js が貯めた締切前オッズを1日1ファイルにまとめる
//
//   snapwork/YYYYMMDD.jsonl(git に入れない。snap.js が1行ずつ足す)
//     → <出力先>/YYYYMMDD.json.gz   {"date":"20260926","rows":[{t,k,rid,left,upd,n,o}, ...]}
//
// ・出力先は odds-snap ブランチ(main に入れると GitHub Pages の作り直しと履歴の膨らみが起きるため)
// ・既にあるファイルとは足し合わせる(同じ行は (t,k) で重複を除く)。何度まとめても消えない
// ・元の jsonl は消さない(Actions の実行が終われば一緒に消える。途中で何度まとめても同じ結果)
//
// 使い方: node snap_pack.js <出力先ディレクトリ>
// ============================================================
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SRC = path.join(__dirname, "snapwork");
const OUT = process.argv[2];
if (!OUT) { console.error("使い方: node snap_pack.js <出力先ディレクトリ>"); process.exit(1); }

let files = [];
try { files = fs.readdirSync(SRC).filter((f) => /^\d{8}\.jsonl$/.test(f)); } catch (e) {}
if (!files.length) { console.log("まとめる記録なし"); process.exit(0); }
fs.mkdirSync(OUT, { recursive: true });
for (const f of files.sort()) {
  const date = f.slice(0, 8);
  const rows = [];
  let bad = 0;
  for (const line of fs.readFileSync(path.join(SRC, f), "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch (e) { bad++; }   // 書きかけで落ちた行は捨てる
  }
  const out = path.join(OUT, date + ".json.gz");
  let old = [];
  try { old = JSON.parse(zlib.gunzipSync(fs.readFileSync(out)).toString("utf8")).rows || []; } catch (e) {}
  const seen = new Set(old.map((r) => r.t + "|" + r.k));
  const merged = old.concat(rows.filter((r) => !seen.has(r.t + "|" + r.k)));
  merged.sort((a, b) => a.k.localeCompare(b.k) || a.t.localeCompare(b.t));
  fs.writeFileSync(out, zlib.gzipSync(JSON.stringify({ date, rows: merged })));
  const nr = new Set(merged.map((r) => r.k)).size;
  console.log(date + ": " + merged.length + "回ぶん / " + nr + "レース → " + out + (bad ? "(壊れた行 " + bad + ")" : ""));
}
