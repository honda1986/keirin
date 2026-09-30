# 評価点(riders[5])に「競りの先頭 +a・カッコの前 -b・カッコの後 -c」を足して並べ直すと、◎・上位3人がどれだけ当たるか
import json, collections, itertools
from seri_lib import parse, NB
RB = json.load(open("../pc/rbss.json"))
data = []
for k, v in NB.items():
    rb = RB.get(k)
    if not rb or not rb.get("riders") or not rb.get("fin") or len(rb["fin"]) < 3 or "(" not in v["nb"]: continue
    L = parse(v["nb"]); head, fr, bk = set(), set(), set()
    for ln in L:
        prs = [p for p in ln if len(p) >= 2]
        if not prs or len(ln[0]) != 1: continue
        head.add(ln[0][0]); fr |= {p[0] for p in prs}; bk |= {c for p in prs for c in p[1:]}
    if not head: continue
    tot = {x[0]: (x[5] if x[5] is not None else 0) for x in rb["riders"]}
    data.append((k[:4], tot, head, fr, bk, rb["fin"]))
def ev(a, b, c, yrs):
    n = w = t3 = bx = 0
    for y, tot, head, fr, bk, fin in data:
        if y not in yrs: continue
        s = {x: v + (a if x in head else 0) - (b if x in fr else 0) - (c if x in bk else 0) for x, v in tot.items()}
        rk = sorted(s, key=lambda x: -s[x]); n += 1; w += rk[0] == fin[0]; t3 += rk[0] in fin; bx += set(rk[:3]) == set(fin)
    return n, 100 * w / n, 100 * t3 / n, 100 * bx / n
print("いま", {y: ev(0, 0, 0, {y}) for y in ["2022", "2025", "2026"]})
best = []
for a in [0, 5, 10, 15, 20, 30]:
    for b in [0, 3, 6, 10]:
        for c in [0, 3, 6, 10, 15]:
            best.append((ev(a, b, c, {"2025"})[1] + ev(a, b, c, {"2025"})[3], a, b, c))
best.sort(reverse=True)
for sc, a, b, c in best[:8]:
    print(f"a={a} b={b} c={c} 2025:", ev(a, b, c, {"2025"}), " 2022:", ev(a, b, c, {"2022"}), " 2026:", ev(a, b, c, {"2026"}))
