// ============================================================
// snap_eval.js — 締切前オッズ(snap)と確定オッズのずれを測る(読み取りのみ)
//
// 引き継ぎ資料(競艇 v24)§2-4 の「目減り」を競輪で測る。v24 では
//   確定 ÷ 判定時 = 中央 0.96、判定時に買いだった組のうち確定でも条件を満たしたのは 53%
// だった。競輪の🔥(3連複・本命ライン3人)で同じことを見る。
//
// 見るもの(レースごとに、締切にいちばん近い記録を「判定時」とする):
//   1. 🔥の買い目の 確定オッズ ÷ 判定時オッズ(中央値・四分位)
//   2. 7車の帯(4〜15倍): 判定時に帯内だったのに確定で帯外になった/その逆 の件数
//   3. 全組の Σ(1/オッズ)(払戻率の確認。確定は約1.34)と、9999.9 の残り具合
//   4. 締切まで何分の時点で記録できたか(窓 2〜15分が回っているか)
//
// 使い方: node snap_eval.js <snapのディレクトリ>     … 例: odds-snap ブランチを snapbr に置いたなら snapbr/snap
//   確定オッズは odds-YYYYMM.json(毎月1日に取得)を読む。まだ取っていない日は 2・1 が出ない
// ============================================================
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { combos } = require("./snap.js");

const dir = process.argv[2];
if (!dir) { console.error("使い方: node snap_eval.js <snapのディレクトリ>"); process.exit(1); }
const BAND_LO = 4, BAND_HI = 15;

const odCache = {};
function finalOdds(id) {
  const ym = id.slice(0, 6);
  if (!(ym in odCache)) { try { odCache[ym] = JSON.parse(fs.readFileSync(path.join(__dirname, "odds-" + ym + ".json"), "utf8")).races; } catch (e) { odCache[ym] = {}; } }
  return odCache[ym][id] || null;
}
// その日の🔥の買い目は、git 履歴に残っている races.json から取るのが正確だが、ここでは簡単のため
// history.json の予想(riders・lines)から f3PlanFrom で作り直す
const { f3PlanFrom } = require("./engine.js");
const H = {};
try { for (const e of JSON.parse(fs.readFileSync(path.join(__dirname, "history.json"), "utf8")).entries) H[e.id] = e; } catch (e) {}
function planOf(id) {
  const e = H[id]; if (!e || !Array.isArray(e.lines)) return null;
  const rk = Array.isArray(e.riders) && e.riders.length ? [...e.riders].sort((a, b) => (a[4] || 99) - (b[4] || 99)).map((r) => r[0]) : e.ranks;
  return rk && rk.length >= 4 ? f3PlanFrom(rk, e.lines) : null;
}
const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const files = fs.readdirSync(dir).filter((f) => /^\d{8}\.json\.gz$/.test(f)).sort();
let nRace = 0, nSnap = 0;
const ratio = [], ratioHot = [], lefts = [], zSnap = [], zFinal = [], junk = [];
let bandIn2Out = 0, bandOut2In = 0, bandSame = 0;
for (const f of files) {
  const { date, rows } = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString("utf8"));
  const byK = {};
  for (const r of rows) (byK[r.k] = byK[r.k] || []).push(r);
  for (const [k, rs] of Object.entries(byK)) {
    nRace++; nSnap += rs.length;
    rs.sort((a, b) => a.left - b.left);
    const last = rs[0];                      // 締切にいちばん近い記録
    lefts.push(last.left);
    const valid = last.o.filter((v) => v != null && v < 9999);
    junk.push(last.o.filter((v) => v != null && v >= 9999).length / last.o.length);
    if (valid.length) zSnap.push(valid.reduce((a, v) => a + 1 / v, 0));
    const id = date + "_" + k;
    const fin = finalOdds(id);
    if (!fin) continue;
    zFinal.push(fin.o.filter((v) => v > 0).reduce((a, v) => a + 1 / v, 0));
    const cs = combos(fin.cars);
    cs.forEach((c, i) => { const a = last.o[i], b = fin.o[i]; if (a && a < 9999 && b > 0 && a < 100) ratio.push(b / a); });
    const pl = planOf(id);
    if (!pl || !pl.hot) continue;
    const i = cs.indexOf(pl.ticket);
    const a = last.o[i], b = fin.o[i];
    if (!(a && a < 9999 && b > 0)) continue;
    ratioHot.push(b / a);
    if (pl.needOdds) {
      const inA = a >= BAND_LO && a <= BAND_HI, inB = b >= BAND_LO && b <= BAND_HI;
      if (inA && !inB) bandIn2Out++; else if (!inA && inB) bandOut2In++; else bandSame++;
    }
  }
}
const fmt = (v, d = 3) => (v == null ? "—" : v.toFixed(d));
console.log("記録した日 " + files.length + " / レース " + nRace + " / 記録の回数 " + nSnap + "(1レース平均 " + fmt(nSnap / Math.max(1, nRace), 1) + "回)");
console.log("最後の記録は締切の何分前か: 中央 " + fmt(q(lefts, 0.5), 1) + " / 90%点 " + fmt(q(lefts, 0.9), 1));
console.log("最後の記録で 9999.9 の組の割合: 中央 " + fmt(q(junk, 0.5)) + " / 90%点 " + fmt(q(junk, 0.9)));
console.log("Σ(1/オッズ): 締切前 中央 " + fmt(q(zSnap, 0.5)) + " / 確定 中央 " + fmt(q(zFinal, 0.5)) + "(約1.34 = 払戻率75%)");
console.log("確定 ÷ 締切前(100倍未満の全組 " + ratio.length + "): 25% " + fmt(q(ratio, 0.25)) + " / 中央 " + fmt(q(ratio, 0.5)) + " / 75% " + fmt(q(ratio, 0.75)));
console.log("確定 ÷ 締切前(🔥の買い目 " + ratioHot.length + "): 25% " + fmt(q(ratioHot, 0.25)) + " / 中央 " + fmt(q(ratioHot, 0.5)) + " / 75% " + fmt(q(ratioHot, 0.75)));
const nb = bandIn2Out + bandOut2In + bandSame;
if (nb) console.log("7車の帯(" + BAND_LO + "〜" + BAND_HI + "倍): 締切前→確定で 帯内→帯外 " + bandIn2Out + " / 帯外→帯内 " + bandOut2In + " / 変わらず " + bandSame + "(" + nb + "件)");
