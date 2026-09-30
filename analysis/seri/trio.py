# 競りのラインから3連複の3人をどう選ぶと当たるか(年別)。先頭 h・カッコの前 f・カッコの後 b・その次の位置 n
import json, itertools, collections, sys
sys.path.insert(0, "../rv"); import feat
from seri_lib import parse, NB
RB = json.load(open("../pc/rbss.json")); OD = {}
for l in itertools.chain(open("../rv/races.jsonl", encoding="utf-8"), open("../rv/races26.jsonl", encoding="utf-8")):
    r = json.loads(l)
    if r["id"] in NB and "(" in NB[r["id"]]["nb"]: OD[r["id"]] = r
agg = collections.defaultdict(lambda: [0, 0, 0.0])
for k, v in NB.items():
    r = OD.get(k); rb = RB.get(k)
    if not r or not rb or not r.get("fin") or len(r["fin"]) < 3: continue
    L = parse(v["nb"]); ln = next((x for x in L if any(len(p) == 2 for p in x)), None)
    if not ln or len(ln[0]) != 1 or len(ln) < 2 or len(ln[1]) != 2: continue   # 番手を競る形だけ
    h, (f, b) = ln[0][0], ln[1]
    rest = ln[2] if len(ln) >= 3 else None           # 3番手の位置([x] か [x,y])
    rk = rb.get("ranked") or []
    oth = [c for c in rk if c not in (h, f, b)]
    cand = {"先頭-前-後(いま)": (h, f, b), "先頭-前-評価上位の他": (h, f, oth[0]) if oth else None,
            "先頭-後-評価上位の他": (h, b, oth[0]) if oth else None}
    if rest: cand["先頭-前-3番手(本線)"] = (h, f, rest[0])
    better = f if (rk.index(f) if f in rk else 9) < (rk.index(b) if b in rk else 9) else b
    cand["先頭-評価が上の方-評価上位の他"] = (h, better, oth[0]) if oth else None
    y = k[:4]; fin = tuple(sorted(r["fin"])); T = feat.TRIOS[r["n"]]
    for nm, t in cand.items():
        if not t: continue
        t = tuple(sorted(t)); w = t == fin
        od = r["o"][T.index(t)] if r.get("o") and t in T else None
        pay = (r["p3f"][1] if r.get("p3f") and r["p3f"][0] == "=".join(map(str, t)) else (od or 0) * 100) if w else 0
        for kk in [(nm, y), (nm, "計")]:
            a = agg[kk]; a[0] += 1; a[1] += w; a[2] += pay
ys = sorted({k[1] for k in agg if k[1] != "計"}) + ["計"]
for nm in sorted({k[0] for k in agg}):
    print(nm, " | ".join(f"{y}: {agg[(nm,y)][0]}R 的中{100*agg[(nm,y)][1]/max(1,agg[(nm,y)][0]):.1f}% 回収{agg[(nm,y)][2]/max(1,agg[(nm,y)][0]):.0f}%" for y in ys if agg[(nm, y)][0]))
