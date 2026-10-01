// 🔥の買い方6通りの5年成績(確定オッズ)。🔥は前受けを足した評価順位(races_f)、期待値は ev.js(races の評価順位)
const fs = require("fs"); const EV = require("/home/user/keirin/ev.js");
const SS = new Set(JSON.parse(fs.readFileSync("ss_ids.json", "utf8")));
const rd = (f) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
const A = rd("races.jsonl").concat(rd("races26.jsonl")), F = rd("races_f.jsonl").concat(rd("races26_f.jsonl"));
const agg = {}; const add = (k, w, pay) => { const a = agg[k] || (agg[k] = [0, 0, 0]); a[0]++; a[1] += w; a[2] += pay; };
const trios = (n) => EV.trioCombos(n).map((c) => c.join("="));
for (let i = 0; i < A.length; i++) {
  const r = JSON.parse(A[i]), f = JSON.parse(F[i]);
  if (r.id !== f.id || SS.has(r.id) || !r.o || !r.fin || r.fin.length < 3) continue;
  const n = r.n; if (n < 7) continue;
  const rk = Object.fromEntries(f.riders.map((x) => [x[0], x[4] || 9]));
  const top = Object.keys(rk).map(Number).sort((a, b) => rk[a] - rk[b])[0];
  const ln = f.lines.find((l) => l.includes(top)); if (!ln || ln.length < 3) continue;
  const solo = f.lines.filter((l) => l.length === 1).length;
  const t3 = ln.slice(0, 3), rsum = t3.reduce((s, c) => s + rk[c], 0);
  const side = n >= 8 ? (solo <= 1 ? "9車" : null) : n === 7 && rsum >= 12 ? "7車" : null;
  if (!side) continue;
  const ticket = t3.slice().sort((a, b) => a - b).join("="), cs = trios(n), j = cs.indexOf(ticket);
  const od = r.o[j]; if (!(od > 0 && od < 9999)) continue;
  const delta = EV.deltaFromRiders(r.riders, r.lines, r.place);
  const ev = delta ? EV.evOf(delta, ticket, r.o, n) : null;
  const [lo, hi] = side === "9車" ? [5, 15] : [4, 15];
  const band = od >= lo && od <= hi, evok = ev != null && ev >= 1;
  const win = ticket === r.fin.slice().sort((a, b) => a - b).join("=");
  const pay = win ? (r.p3f && r.p3f[0] === ticket ? r.p3f[1] : od * 100) : 0;
  const M = { both: evok && band, ev: evok, band, either: evok || band, all: true };
  for (const [m, ok] of Object.entries(M)) if (ok) { add(side + "|" + m + "|" + r.y, win, pay); add(side + "|" + m + "|計", win, pay); }
}
const L = { both: "1.両方", ev: "2.期待値だけ", band: "3.帯だけ", either: "4.どちらか", all: "5.全部" };
for (const side of ["9車", "7車"]) for (const m of Object.keys(L)) {
  const t = agg[side + "|" + m + "|計"]; if (!t) continue;
  const ys = [2022, 2023, 2024, 2025, 2026].map((y) => { const a = agg[side + "|" + m + "|" + y]; return a ? Math.round(a[2] / a[0]) + "%" : "-"; });
  console.log(side, L[m].padEnd(8), `${t[0]}R 的中${(100 * t[1] / t[0]).toFixed(1)}% 回収${(t[2] / t[0]).toFixed(1)}% 収支${Math.round(t[2] - 100 * t[0]).toLocaleString()}`, ys.join(" "), "マイナスの年", ys.filter((v) => parseInt(v) < 100).length);
}
