import json, feat, collections, sys
SS = set(json.load(open("ss_ids.json")))
RB = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "../pc/rbss.json"))   # pastcard_rebuild.js の出力
agg = collections.defaultdict(lambda: [0, 0, 0.0])
for f in ["races.jsonl", "races26.jsonl"]:
    for l in open(f, encoding="utf-8"):
        r = json.loads(l); b = RB.get(r["id"])
        if not b or not b.get("hot") or not b.get("trio") or r["n"] < 8: continue
        t = tuple(sorted(b["trio"])); T = [tuple(x) for x in feat.TRIOS[r["n"]]]
        if t not in T or not r.get("o"): continue
        od = r["o"][T.index(t)]
        if not od or not (5 <= od <= 15): continue
        win = tuple(sorted(r["fin"])) == t
        pay = (r["p3f"][1] if r.get("p3f") and r["p3f"][0] == "=".join(map(str, t)) else od * 100) if win else 0
        k = (r["y"], r["id"] in SS); a = agg[k]; a[0] += 1; a[1] += win; a[2] += pay
for y in range(2022, 2027):
    out = []
    for ss in (False, True):
        n, h, p = agg[(y, ss)]
        out.append(f"{'SSあり' if ss else 'SSなし'} {n:>4}R 的中{100*h/max(1,n):4.1f}% 回収{p/max(1,n):6.1f}%")
    print(y, " | ".join(out))
