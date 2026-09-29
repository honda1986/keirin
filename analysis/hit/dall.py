# モデルD「期待値1.05以上・20倍以下を全部」を jsonl から(アプリの d-past と同じ計算)。その年より前で作ったモデル
import json, numpy as np, feat, collections, sys
LOM = -4.264394023053231
names = ["K", "er", "single", "banme", "age50", "home", "young", "samepref", "dsc", "has_dsc", "r120", "has_r", "lo2", "lo3", "lo9", "scz", "head", "srk"]
RI = {k: j for j, k in enumerate(feat.RIDER_F)}
MIN_EV, HI = float(sys.argv[1]), float(sys.argv[2])
agg = collections.defaultdict(lambda: [0, 0, 0, 0.0]); npts = collections.Counter(); band = collections.defaultdict(lambda: [0, 0.0])
allp = {}
def run(src, coef, lo_id, hi_id):
    b = dict(zip(names, np.load(coef)))
    for l in open(src, encoding="utf-8"):
        r = json.loads(l)
        if not (lo_id <= r["id"] < hi_id): continue
        keep, lo, RX, TX, wi, cd, info = feat.race_rows(r)
        if len(keep) < len(feat.TRIOS[r["n"]]) * 0.8: continue
        lo = np.array(lo); lc = lo - LOM; is9 = 1.0 if r["n"] >= 8 else 0.0
        u = b["K"] * lo + b["lo2"] * lc**2 + b["lo3"] * lc**3 + b["lo9"] * lo * is9
        for k in RI: u = u + b[k] * RX[:, RI[k]]
        p = np.exp(u - u.max()); p /= p.sum(); odds = np.exp(-lo); ev = p * odds
        sel = np.flatnonzero((ev >= MIN_EV) & (odds <= HI))
        if not len(sel): continue
        sel = sel[np.argsort(-ev[sel])]
        w = "=".join(map(str, sorted(r["fin"]))); y = r["y"]; a = agg[y]; a[0] += 1; a[1] += len(sel); npts[min(len(sel), 4)] += 1
        hit = False; picks = []
        for j in sel:
            t = "=".join(map(str, keep[j])); picks.append([t, round(float(ev[j]), 3), round(float(odds[j]), 1)])
            pay = 0
            if t == w: hit = True; pay = r["p3f"][1] if (r.get("p3f") and r["p3f"][0] == w) else odds[j] * 100
            a[3] += pay; bk = (y, "〜10倍" if odds[j] < 10 else "10〜20倍"); band[bk][0] += 1; band[bk][1] += pay
        a[2] += hit; allp[r["id"]] = picks
for y in [2023, 2024, 2025]: run("races.jsonl", f"cf_{y}_D.npy", str(y), str(y + 1))
run("races26.jsonl", "cf_2026_D.npy", "2026", "2027")
for y in sorted(agg):
    n, pts, h, ret = agg[y]
    print(y, f"{n}R {pts}点(1レース{pts/n:.2f}点) 的中{100*h/n:.1f}% 回収{ret/pts:.1f}% | " + " / ".join(f"{k}: {band[(y,k)][0]}点 {band[(y,k)][1]/max(1,band[(y,k)][0]):.0f}%" for k in ["〜10倍", "10〜20倍"]))
print("1レースの点数", dict(npts))
json.dump(allp, open(f"../hit/dall_{MIN_EV}_{HI}.json", "w"), ensure_ascii=False)
