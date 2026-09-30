# 競りのあるレースで、単純な買い方の回収率(確定オッズの3連複)
import json, glob, itertools, collections, sys, re
sys.path.insert(0, "../rv"); import feat
from seri_lib import parse, NB
RB = json.load(open("../pc/rbss.json")); OD = {}
for l in itertools.chain(open("../rv/races.jsonl", encoding="utf-8"), open("../rv/races26.jsonl", encoding="utf-8")):
    r = json.loads(l)
    if r["id"] in NB: OD[r["id"]] = r
agg = collections.defaultdict(lambda: [0, 0, 0.0]); kind = collections.Counter(); rk = collections.Counter()
def buy(key, r, trios):
    T = feat.TRIOS[r["n"]]; fin = tuple(sorted(r["fin"]))
    for t in trios:
        t = tuple(sorted(t))
        if t not in T: continue
        od = r["o"][T.index(t)]
        if not od: continue
        a = agg[key]; a[0] += 1; w = t == fin; a[1] += w
        a[2] += (r["p3f"][1] if r.get("p3f") and r["p3f"][0] == "=".join(map(str, t)) else od * 100) if w else 0
for k, v in NB.items():
    r = OD.get(k); rb = RB.get(k)
    if not r or not r.get("o") or not r.get("fin") or len(r["fin"]) < 3: continue
    L = parse(v["nb"]); sl = [ln for ln in L if any(len(p) == 2 for p in ln)]
    if not sl: continue
    ln = sl[0]; h = ln[0][0]; pr = next(p for p in ln if len(p) == 2); f, b = pr[0], pr[1]
    cars = range(1, r["n"] + 1); ranked = rb.get("ranked") if rb else None
    kind[r["n"]] += 1
    if ranked: rk[ranked.index(h) + 1 if h in ranked else 0] += 1
    others = [c for c in cars if c not in (h, f, b)]
    buy("先頭-前-全(総流し)", r, [(h, f, x) for x in others])
    buy("先頭-後-全", r, [(h, b, x) for x in others])
    buy("先頭-前-後", r, [(h, f, b)])
    buy("先頭から全部(先頭を含む全組)", r, [(h,) + p for p in itertools.combinations([c for c in cars if c != h], 2)])
    buy("先頭-前-他(前と後の両方は買わない)", r, [(h, f, x) for x in others])
    if ranked:
        top = [c for c in ranked if c != h][:3]
        buy("先頭-評価上位3人のBOX2", r, [(h,) + p for p in itertools.combinations(top, 2)])
    buy("全組(控え)", r, list(itertools.combinations(cars, 3)))
print("車立て", dict(kind), " 先頭の評価順位", dict(sorted(rk.items())))
for k2, (n, h2, p) in agg.items(): print(f"  {k2}: {n}点 的中{100*h2/n:.1f}% 回収{p/n:.0f}%")
