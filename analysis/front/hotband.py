# 🔥(本命=評価1位のラインの先頭3人の3連複)を、今の評価順位 / 前受けを足した評価順位で作り、倍率帯ごとに5年の成績を出す
import json, itertools, collections, sys, feat
SS = set(json.load(open("ss_ids.json")))
def load(fs):
    out = []
    for f in fs:
        for l in open(f, encoding="utf-8"):
            r = json.loads(l)
            if not r.get("o") or not r.get("fin") or len(r["fin"]) < 3 or r["id"] in SS: continue
            rk = sorted(r["riders"], key=lambda x: (x[4] or 9)); top = rk[0][0]; ranks = {x[0]: x[4] or 9 for x in r["riders"]}
            ln = next((x for x in r["lines"] if top in x), None)
            if not ln or len(ln) < 3: continue
            solo = sum(len(x) == 1 for x in r["lines"]); n = r["n"]
            t = tuple(sorted(ln[:3])); T = feat.TRIOS[n]
            if t not in T or not r["o"][T.index(t)]: continue
            od = r["o"][T.index(t)]; win = t == tuple(sorted(r["fin"]))
            pay = (r["p3f"][1] if r.get("p3f") and r["p3f"][0] == "=".join(map(str, t)) else od * 100) if win else 0
            kind = "9車" if n >= 8 and solo <= 1 else "7車" if n == 7 and sum(ranks[c] for c in ln[:3]) >= 12 else None
            if kind: out.append((kind, r["y"], od, win, pay))
    return out
CUR = load(["races.jsonl", "races26.jsonl"]); NEW = load(["races_f.jsonl", "races26_f.jsonl"])
def stat(rows, kind, lo, hi, yrs=None):
    n = h = 0; p = 0.0; by = collections.defaultdict(lambda: [0, 0.0])
    for k, y, od, w, pay in rows:
        if k != kind or not (lo <= od <= hi) or (yrs and y not in yrs): continue
        n += 1; h += w; p += pay; by[y][0] += 1; by[y][1] += pay
    return n, h, p, by
for kind, bands in [("9車", [(5, 15), (4, 15), (5, 12), (5, 20), (6, 15), (6, 20), (4, 20), (3, 15), (7, 20)]), ("7車", [(4, 15), (5, 15), (6, 20), (8, 20), (10, 30)])]:
    print(f"■ {kind}")
    for lo, hi in bands:
        for tag, rows in [("いま", CUR), ("前受け", NEW)]:
            n, h, p, by = stat(rows, kind, lo, hi)
            yr = " ".join(f"{y}:{by[y][1]/max(1,by[y][0]):.0f}%" for y in [2022, 2023, 2024, 2025, 2026])
            lose = sum(1 for y in [2022, 2023, 2024, 2025, 2026] if by[y][1] < 100 * by[y][0])
            print(f"  {lo:>2}〜{hi:<2}倍 {tag:<4} {n:>5}R 的中{100*h/max(1,n):4.1f}% 回収{p/max(1,n):5.1f}% 収支{p-100*n:+8,.0f} マイナスの年{lose} | {yr}")
