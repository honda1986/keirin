# 🔥9車5〜15倍(SS無し)を、本命ラインが前受けする確率(その年を見ていないモデル)で分ける。5年
import json, itertools, collections, sys
sys.path.insert(0, "../rv"); import feat
PF = json.load(open("pf.json")); SS = set(json.load(open("../rv/ss_ids.json"))); RB = json.load(open("../pc/rbss.json"))
agg = collections.defaultdict(lambda: [0, 0, 0.0])
for l in itertools.chain(open("../rv/races.jsonl", encoding="utf-8"), open("../rv/races26.jsonl", encoding="utf-8")):
    r = json.loads(l); v = PF.get(r["id"])
    if not v: continue
    b = RB.get(r["id"])
    if not b or not b.get("hot") or not b.get("trio") or r["n"] < 8 or r["id"] in SS: continue
    t = tuple(sorted(b["trio"])); T = [tuple(x) for x in feat.TRIOS[r["n"]]]
    if t not in T or not r.get("o"): continue
    od = r["o"][T.index(t)]
    if not od or not (5 <= od <= 15): continue
    mi = next(i for i, x in enumerate(v["lines"]) if v["rank1"] in x); pm = v["p"][mi]
    g = "高い(0.5以上)" if pm >= 0.5 else "中(0.3〜0.5)" if pm >= 0.3 else "低い(0.3未満)"
    win = tuple(sorted(r["fin"])) == t
    pay = (r["p3f"][1] if r.get("p3f") and r["p3f"][0] == "=".join(map(str, t)) else od * 100) if win else 0
    for k in [(g, r["y"]), (g, "計"), ("本番で前受け" if v["si"] == mi else "本番で前受けせず", "計")]:
        a = agg[k]; a[0] += 1; a[1] += win; a[2] += pay
for g in ["高い(0.5以上)", "中(0.3〜0.5)", "低い(0.3未満)"]:
    print(g, " | ".join(f"{y}: {agg[(g,y)][0]}R {100*agg[(g,y)][1]/max(1,agg[(g,y)][0]):.1f}% {agg[(g,y)][2]/max(1,agg[(g,y)][0]):.0f}%" for y in [2022, 2023, 2024, 2025, 2026, "計"]))
for g in ["本番で前受け", "本番で前受けせず"]:
    n, h, p = agg[(g, "計")]; print(g, f"{n}R 的中{100*h/n:.1f}% 回収{p/n:.0f}%")
