# モデルDの過去の買い目(その年より前で作ったモデル)。全年ぶんを allpicks.json、2025〜2026-09-25 を d-past.json に
import json, numpy as np, feat, collections, sys
LOM = -4.264394023053231
names = ["K", "er", "single", "banme", "age50", "home", "young", "samepref", "dsc", "has_dsc", "r120", "has_r", "lo2", "lo3", "lo9", "scz", "head", "srk"]
RI = {k: j for j, k in enumerate(feat.RIDER_F)}
SS = set(json.load(open("ss_ids.json")))
agg = collections.defaultdict(lambda: [0, 0, 0.0])
def picks(src, coef, lo_id, hi_id):
    b = dict(zip(names, np.load(coef))); out = {}
    for l in open(src, encoding="utf-8"):
        r = json.loads(l)
        if not (lo_id <= r["id"] < hi_id): continue
        keep, lo, RX, TX, wi, cd, info = feat.race_rows(r)
        if len(keep) < len(feat.TRIOS[r["n"]]) * 0.8: continue
        lo = np.array(lo); lc = lo - LOM; is9 = 1.0 if r["n"] >= 8 else 0.0
        u = b["K"] * lo + b["lo2"] * lc**2 + b["lo3"] * lc**3 + b["lo9"] * lo * is9
        for k in ["er", "single", "banme", "age50", "home", "young", "samepref", "dsc", "has_dsc", "r120", "has_r", "scz", "head", "srk"]:
            u = u + b[k] * RX[:, RI[k]]
        p = np.exp(u - u.max()); p /= p.sum(); odds = np.exp(-lo); ev = p * odds
        ok = (ev >= 1.1) & (odds >= 10) & (odds <= 30)
        if not ok.any(): continue
        j = int(np.argmax(np.where(ok, ev, -1))); t = "=".join(map(str, keep[j]))
        out[r["id"]] = [t, round(float(ev[j]), 3), round(float(odds[j]), 1)]
        w = "=".join(map(str, sorted(r["fin"]))); pay = 0
        if w == t: pay = r["p3f"][1] if (r.get("p3f") and r["p3f"][0] == w) else odds[j] * 100
        for key in [(r["y"], "全体"), (r["y"], "SSあり" if r["id"] in SS else "SSなし")]:
            a = agg[key]; a[0] += 1; a[1] += w == t; a[2] += pay
    return out
allp = {}
for y in [2023, 2024, 2025]: allp.update(picks("races.jsonl", f"cf_{y}_D.npy", str(y), str(y + 1)))
allp.update(picks("races26.jsonl", "cf_2026_D.npy", "2026", "2027"))
for y in range(2023, 2027):
    print(y, " | ".join(f"{g} {agg[(y,g)][0]:>4}R 的中{100*agg[(y,g)][1]/max(1,agg[(y,g)][0]):4.1f}% 回収{agg[(y,g)][2]/max(1,agg[(y,g)][0]):6.1f}%" for g in ["全体", "SSなし", "SSあり"]))
json.dump(allp, open("allpicks.json", "w"), ensure_ascii=False)
if "--write" in sys.argv:
    old = json.load(open(sys.argv[-1]))
    dp = {k: v for k, v in allp.items() if "2025" <= k < "20260926"}
    json.dump({"note": old["note"], "picks": dp}, open(sys.argv[-1], "w"), ensure_ascii=False)
    print("d-past", len(dp), "(前は", len(old["picks"]), ")")
