# 全レース・全組の行列を作って npz に保存
import json, sys, numpy as np, feat
src, dst = sys.argv[1], sys.argv[2]
X, W, G, ODDS, CD, PAY = [], [], [], [], [], []
META = []   # レースごと: y, m, n, solo, 🔥の組の行番号(なければ-1), 🔥か, 7車帯内か, rankSum
TRIO_ID = []
row = 0
for li, l in enumerate(open(src, encoding="utf-8")):
    r = json.loads(l)
    if r["n"] < 5: continue
    keep, lo, RX, TX, wi, cd, info = feat.race_rows(r)
    if wi < 0 or len(keep) < len(feat.TRIOS[r["n"]]) * 0.8: continue
    gi = len(META)
    ranks = {x[0]: x[4] or 9 for x in r["riders"]}
    ranked = sorted(ranks, key=lambda c: ranks[c])
    ml = next((l2 for l2 in r["lines"] if ranked[0] in l2), None)
    hot_i, hot, band, rsum = -1, 0, 1, 0
    if ml and len(ml) >= 3:
        t = tuple(sorted(ml[:3])); rsum = sum(ranks[c] for c in ml[:3])
        if t in keep:
            hot_i = row + keep.index(t)
            ov = 1 / np.exp(lo[keep.index(t)])
            if r["n"] >= 8 and info["solo"] < 2: hot = 1
            elif r["n"] == 7 and rsum >= 12: hot = 1; band = 1 if 4 <= ov <= 15 else 0
    META.append((r["y"], r["m"], r["n"], info["solo"], hot_i, hot, band, rsum))
    win_t = "=".join(map(str, sorted(r["fin"])))
    for j, c in enumerate(keep):
        X.append(np.concatenate([[lo[j]], RX[j], TX[j]]))
        W.append(1 if j == wi else 0); G.append(gi)
        ov = 1 / np.exp(lo[j]); ODDS.append(ov); CD.append(cd[j])
        pay = 0.0
        if j == wi:
            pay = r["p3f"][1] if (r.get("p3f") and r["p3f"][0] == win_t) else ov * 100
        PAY.append(pay)
    row += len(keep)
np.savez_compressed(dst, X=np.array(X, np.float32), W=np.array(W, np.int8), G=np.array(G, np.int32), ODDS=np.array(ODDS, np.float32),
                    CD=np.array(CD, np.float32), PAY=np.array(PAY, np.float32), META=np.array(META, np.int32))
print("レース", len(META), "組", row)
