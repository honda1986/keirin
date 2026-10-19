// モデルDの買う倍率の帯(hikitsugi §4-43): 締切2分前の倍率(自動投票が決める倍率)で選んだ組を帯で分け、確定の払戻で数える
//   node band_live.js <odds-snap ブランチの snap/ を置いたフォルダ>  (9/27〜10/18。history.json・odds-YYYYMM.json は main のもの)
const fs = require("fs"), zlib = require("zlib"), path = require("path");
const K = path.join(__dirname, "../.."), SD = process.argv[2], DEC = 2.0;
const EVD = require(path.join(K, "evd.js"));
const H = JSON.parse(fs.readFileSync(path.join(K, "history.json"), "utf8")).entries;
const OD = Object.assign({}, ...["202609", "202610"].map((m) => JSON.parse(fs.readFileSync(path.join(K, "odds-" + m + ".json"), "utf8")).races));
const days = fs.readdirSync(SD).map((f) => f.slice(0, 8)).filter((d) => d >= "20260927" && d <= "20261018");
const S = {};
for (const d of days) {
  for (const r of JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(SD, d + ".json.gz"))).toString("utf8")).rows || []) {
    const k = d + "_" + r.k, s = S[k] || (S[k] = {});
    if (r.left >= DEC && (!s.dec || r.left < s.dec.left)) s.dec = r;
  }
}
const P = []; let races = 0;
for (const e of H) {
  if (!days.includes(e.date) || e.t == null || !Array.isArray(e.riders) || e.riders.length < 5 || e.riders.some((r) => !r[7])) continue;
  const id = e.id || (e.date + "_" + e.place + "_" + e.raceNo), s = S[id], od = OD[id], n = e.riders.length;
  if (!s || !s.dec || !od || !Array.isArray(od.o) || (s.dec.n && s.dec.n !== n) || od.o.length !== s.dec.o.length) continue;
  races++;
  const fin = [e.f, e.s, e.t].sort((a, b) => a - b).join("=");
  const a = EVD.evAll(e.riders, e.lines, e.place, s.dec.o, n, e.seri) || [];
  const c = new Map((EVD.evAll(e.riders, e.lines, e.place, od.o, n, e.seri) || []).map((x) => [x.ticket, x]));
  for (const x of a) if (x.ev >= 1.10 && x.odds <= 40) {
    const cx = c.get(x.ticket);
    P.push({ id, t: x.ticket, ev: x.ev, o: x.odds, co: cx ? cx.odds : null, cev: cx ? cx.ev : null, pay: x.ticket === fin ? e.p3fpay || 0 : 0 });
  }
}
const f = (fl) => { const g = P.filter(fl), ret = g.reduce((s, p) => s + p.pay, 0); return `${String(g.length).padStart(4)}点 的中${String(g.filter((p) => p.pay > 0).length).padStart(3)} 回収${g.length ? (ret / g.length).toFixed(0).padStart(4) : "   —"}% 収支${String(ret - 100 * g.length).padStart(7)}円`; };
console.log(`${days[0]}〜${days[days.length - 1]} ${races}R(締切${DEC}分前の倍率で決める・払戻は確定)`);
console.log("いま 0〜20倍:", f((p) => p.o <= 20));
console.log("案  2〜18倍:", f((p) => p.o >= 2 && p.o <= 18));
for (const [lo, hi] of [[0, 5], [5, 10], [10, 15], [15, 18], [18, 20], [20, 25], [25, 40]]) console.log(`  ${lo}〜${hi}倍:`, f((p) => p.o >= lo && (hi === 40 ? p.o <= hi : p.o < hi || (hi === 20 && p.o === 20))));
// 決めたときと確定の倍率の動き
const g = P.filter((p) => p.o <= 20 && p.co != null);
const up = g.filter((p) => p.co > 20).length, dn = g.filter((p) => p.cev < 1.10).length;
console.log(`0〜20倍で決めた ${g.length}点のうち 確定で20倍超 ${up}点 / 確定で期待値1.10未満 ${dn}点`);
const g18 = P.filter((p) => p.o > 18 && p.o <= 20 && p.co != null);
console.log(`18〜20倍で決めた ${g18.length}点の確定倍率: ` + g18.map((p) => p.co).sort((a, b) => a - b).join(" "));
const med = (a) => { a = a.slice().sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
console.log("確定/決めたとき の倍率比(中央値):", med(g.map((p) => p.co / p.o)).toFixed(3));
