# 🔥(9車・単騎1人以下・3連複5〜15倍・SS無し)のレースで、本命ラインの2車複(先頭=番手)を買う。前受け予想・本番の前受けで分ける
import json, itertools, collections, glob, sys
sys.path.insert(0, "../rv"); import feat
PF = json.load(open("pf.json")); SS = set(json.load(open("../rv/ss_ids.json"))); RB = json.load(open("../pc/rbss.json"))
O2 = {}
for f in glob.glob("../pc/o2/o2f-*.json"): O2.update(json.load(open(f))["races"])
agg = collections.defaultdict(lambda: [0, 0, 0.0]); bal = collections.defaultdict(list)
for l in itertools.chain(open("../rv/races.jsonl", encoding="utf-8"), open("../rv/races26.jsonl", encoding="utf-8")):
    r = json.loads(l); v = PF.get(r["id"]); b = RB.get(r["id"])
    if not v or not b or not b.get("hot") or not b.get("trio") or r["n"] < 8 or r["id"] in SS or not r.get("o"): continue
    n = r["n"]; t3 = tuple(sorted(b["trio"])); T = feat.TRIOS[n]
    if t3 not in T or not r["o"][T.index(t3)] or not (5 <= r["o"][T.index(t3)] <= 15): continue
    o2 = O2.get(r["id"])
    if not o2 or o2.get("cars") != n: continue
    mi = next(i for i, x in enumerate(v["lines"]) if v["rank1"] in x); pm = v["p"][mi]
    t2 = tuple(sorted(b["trio"][:2])); P2 = list(itertools.combinations(range(1, n + 1), 2)); od = o2["o"][P2.index(t2)]
    if not od: continue
    w = t2 == tuple(sorted(r["fin"][:2])); pay = od * 100 if w else 0
    g = "前受け◎(0.5以上)" if pm >= 0.5 else "前受け△(0.3〜0.5)" if pm >= 0.3 else "前受け×(0.3未満)"
    real = "(後から)本番で前受けした" if v["si"] == mi else "(後から)本番で前受けしなかった"
    b2 = "2車複〜4倍" if od < 4 else "2車複4〜8倍" if od < 8 else "2車複8倍〜"
    for k in [("全部", r["y"]), ("全部", "計"), (g, r["y"]), (g, "計"), (real, "計"), (b2, "計"), (g + "・" + b2, "計")]:
        a = agg[k]; a[0] += 1; a[1] += w; a[2] += pay
for g in ["全部", "前受け◎(0.5以上)", "前受け△(0.3〜0.5)", "前受け×(0.3未満)", "(後から)本番で前受けした", "(後から)本番で前受けしなかった",
          "2車複〜4倍", "2車複4〜8倍", "2車複8倍〜"] + [f"{a}・{b}" for a in ["前受け◎(0.5以上)", "前受け△(0.3〜0.5)", "前受け×(0.3未満)"] for b in ["2車複〜4倍", "2車複4〜8倍", "2車複8倍〜"]]:
    n, h, p = agg[(g, "計")]
    if not n: continue
    yr = " ".join(f"{y}:{agg[(g,y)][2]/agg[(g,y)][0]:.0f}%" for y in [2022, 2023, 2024, 2025, 2026] if agg[(g, y)][0])
    print(f"{g:<32} {n:>5}R 的中 {100*h/n:5.1f}% 回収 {p/n:5.1f}% 収支 {p-100*n:+8,.0f}円 {yr}")
