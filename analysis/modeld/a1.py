# 見直し1: 評価値(評価順位)の当たり方。競走得点順・市場(3連複から見た3着内確率)の人気順と比べる
import json, itertools, collections, numpy as np
rows = [json.loads(l) for l in open("races.jsonl", encoding="utf-8")]
def trios(n): return list(itertools.combinations(range(1, n + 1), 3))
st = collections.defaultdict(lambda: collections.Counter())
for r in rows:
    n = r["n"]
    if n < 7: continue
    grp = (r["y"], "9車" if n >= 8 else "7車")
    rd = {x[0]: x for x in r["riders"]}
    fin = r["fin"]
    # 評価1位
    ev1 = min(rd, key=lambda c: rd[c][4] or 99)
    # 競走得点1位
    sc1 = max(rd, key=lambda c: rd[c][6] or 0)
    # 市場の3着内確率
    o = r["o"]; cs = trios(n)
    q = collections.Counter(); tot = 0
    for c, v in zip(cs, o):
        if v and 0 < v < 9999:
            w = 1 / v; tot += w
            for x in c: q[x] += w
    mk1 = max(q, key=lambda c: q[c])
    s = st[grp]; s["n"] += 1
    for nm, c in (("評価1位", ev1), ("得点1位", sc1), ("市場1位", mk1)):
        s[nm + "_1着"] += fin[0] == c
        s[nm + "_3着内"] += c in fin
    s["評価1位=市場1位"] += ev1 == mk1
    s["評価1位=得点1位"] += ev1 == sc1
    # 評価上位3人がそのまま3着内(3連複)
    top3 = sorted(rd, key=lambda c: rd[c][4] or 99)[:3]
    s["評価上位3人で3連複"] += set(top3) == set(fin)
    # 評価1位の市場3着内確率(正規化)と実際
    s["評価1位_市場確率"] += q[ev1] / tot
for g in sorted(st):
    s = st[g]; n = s["n"]
    print(f"{g[0]} {g[1]} {n}R | " + " ".join(f"{k} {100*s[k]/n:.1f}%" for k in
          ["評価1位_1着", "得点1位_1着", "市場1位_1着", "評価1位_3着内", "得点1位_3着内", "市場1位_3着内", "評価1位=市場1位", "評価1位=得点1位", "評価上位3人で3連複"]) +
          f" | 評価1位の市場の3着内確率 {100*s['評価1位_市場確率']/n:.1f}%")
