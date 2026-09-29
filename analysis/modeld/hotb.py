# 🔥9車5〜15倍(SS無し)を、本命ラインの先頭のB率(レース内の順位)で分ける
import json, feat, collections
SS = set(json.load(open("ss_ids.json"))); SB = json.load(open("sb.json")); RB = json.load(open("../pc/rbss.json"))
agg = collections.defaultdict(lambda: [0, 0, 0.0])
for f in ["races.jsonl", "races26.jsonl"]:
    for l in open(f, encoding="utf-8"):
        r = json.loads(l); b = RB.get(r["id"])
        if not b or not b.get("hot") or not b.get("trio") or r["n"] < 8 or r["id"] in SS: continue
        t = tuple(sorted(b["trio"])); T = [tuple(x) for x in feat.TRIOS[r["n"]]]
        if t not in T or not r.get("o"): continue
        od = r["o"][T.index(t)]
        if not od or not (5 <= od <= 15): continue
        rd = {x[0]: x for x in r["riders"]}; sb = SB.get(r["id"], {})
        rate = {c: (sb[str(c)][1] / rd[c][9]) if (str(c) in sb and rd[c][9]) else 0 for c in rd}
        heads = [l2[0] for l2 in r["lines"] if len(l2) >= 2]
        h = b["trio"][0]  # 本命ラインの先頭
        rk = sorted(heads, key=lambda c: -rate.get(c, 0)).index(h) + 1 if h in heads else 9
        grp = "先頭のB率 1位" if rk == 1 else "2位以下"
        win = tuple(sorted(r["fin"])) == t
        pay = (r["p3f"][1] if r.get("p3f") and r["p3f"][0] == "=".join(map(str, t)) else od * 100) if win else 0
        a = agg[(r["y"], grp)]; a[0] += 1; a[1] += win; a[2] += pay
for g in ["先頭のB率 1位", "2位以下"]:
    print(g, " | ".join(f"{y}: {agg[(y,g)][0]}R 的中{100*agg[(y,g)][1]/max(1,agg[(y,g)][0]):.1f}% 回収{agg[(y,g)][2]/max(1,agg[(y,g)][0]):.0f}%" for y in range(2022, 2027)))
