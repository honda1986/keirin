# 比較: 競りの無い7車で「評価1位を含む全組」「評価1位のライン先頭-番手-全」の回収率
import json, itertools, collections, sys
sys.path.insert(0, "../rv"); import feat
from seri_lib import parse, NB
RB = json.load(open("../pc/rbss.json")); agg = collections.defaultdict(lambda: [0, 0, 0.0])
def buy(key, r, trios):
    T = feat.TRIOS[r["n"]]; fin = tuple(sorted(r["fin"]))
    for t in set(tuple(sorted(t)) for t in trios):
        if t not in T: continue
        od = r["o"][T.index(t)]
        if not od: continue
        a = agg[key]; a[0] += 1; w = t == fin; a[1] += w
        a[2] += (r["p3f"][1] if r.get("p3f") and r["p3f"][0] == "=".join(map(str, t)) else od * 100) if w else 0
for l in itertools.chain(open("../rv/races.jsonl", encoding="utf-8"), open("../rv/races26.jsonl", encoding="utf-8")):
    r = json.loads(l); v = NB.get(r["id"])
    if v is None or "(" in v["nb"] or r["n"] != 7 or not r.get("o") or not r.get("fin") or len(r["fin"]) < 3: continue
    rb = RB.get(r["id"]); ranked = rb and rb.get("ranked")
    if not ranked: continue
    h = ranked[0]; cars = range(1, 8)
    buy("評価1位を含む全組", r, [(h,) + p for p in itertools.combinations([c for c in cars if c != h], 2)])
    buy("全組", r, list(itertools.combinations(cars, 3)))
    L = parse(v["nb"]); ln = next((x for x in L if any(h in p for p in x)), None)
    if ln and len(ln) >= 3 and ln[0][0] == h:
        a, b = ln[1][0], ln[2][0]; oth = [c for c in cars if c not in (h, a, b)]
        buy("評価1位が先頭の3人以上ライン: 先頭-番手-全", r, [(h, a, x) for x in oth + [b]])
        buy("同: 先頭-3番手-全", r, [(h, b, x) for x in oth + [a]])
for k2, (n, h2, p) in agg.items(): print(f"  {k2}: {n}点 的中{100*h2/n:.1f}% 回収{p/n:.0f}%")
