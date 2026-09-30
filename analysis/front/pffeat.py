# 前受け確率の特徴(1行=1組。d2225.npz / d26.npz と同じ並び): 3人のラインの前受け確率の和 / 同じラインの2人組ごとの前受け確率の和
import json, sys, numpy as np, feat
PF = json.load(open("../fl/pf.json"))
src, dst = sys.argv[1], sys.argv[2]
out = []; have = 0; n = 0
for l in open(src, encoding="utf-8"):
    r = json.loads(l)
    if r["n"] < 5: continue
    keep, lo, RX, TX, wi, cd, info = feat.race_rows(r)
    if wi < 0 or len(keep) < len(feat.TRIOS[r["n"]]) * 0.8: continue
    n += 1; v = PF.get(r["id"])
    pl, li = {}, {}
    if v:
        have += 1
        for i, x in enumerate(v["lines"]):
            for c in x: pl[c] = v["p"][i]; li[c] = i
    for t in keep:
        s = sum(pl.get(c, 0.0) for c in t)
        pr = sum(pl.get(a, 0.0) for i, a in enumerate(t) for b in t[i + 1:] if a in li and li.get(a) == li.get(b))
        out.append([s, pr])
np.save(dst, np.array(out, np.float32)); print(dst, len(out), "前受け確率あり", have, "/", n)
