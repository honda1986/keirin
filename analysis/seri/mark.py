# 競りのレースで、アプリの評価1位(◎)と競りのラインの先頭のどちらが当たるか
import json, collections
from seri_lib import parse, NB
RB = json.load(open("../pc/rbss.json"))
c = collections.Counter(); who = collections.Counter(); whowin = collections.Counter()
for k, v in NB.items():
    rb = RB.get(k)
    if not rb or not rb.get("ranked") or not rb.get("fin") or len(rb["fin"]) < 3 or "(" not in v["nb"]: continue
    L = parse(v["nb"]); ln = next((x for x in L if any(len(p) == 2 for p in x)), None)
    if not ln or len(ln[0]) != 1: continue
    h = ln[0][0]; prs = [p for p in ln if len(p) == 2]; fr = {p[0] for p in prs}; bk = {p[1] for p in prs}
    r1 = rb["ranked"][0]; fin = rb["fin"]
    role = "先頭" if r1 == h else "カッコの前" if r1 in fr else "カッコの後" if r1 in bk else "ほかのライン"
    who[role] += 1; whowin[role] += r1 == fin[0]; c["n"] += 1
    c["r1win"] += r1 == fin[0]; c["r1top3"] += r1 in fin; c["hwin"] += h == fin[0]; c["htop3"] += h in fin
    c["box"] += set(rb["ranked"][:3]) == set(fin)
    alt = [h]
    for x in rb["ranked"]:
        if x == h: continue
        if any(x in p and any(y in alt for y in p if y != x) for p in prs): continue   # 競る相手がもう入っていれば飛ばす
        alt.append(x)
        if len(alt) == 3: break
    c["alt"] += set(alt) == set(fin)
n = c["n"]
print("競りのレース", n, " 評価1位の立場:", dict(who), " そのうち1着:", dict(whowin))
print(f"評価1位(◎): 1着 {100*c['r1win']/n:.1f}% 3着内 {100*c['r1top3']/n:.1f}% | 競りのラインの先頭: 1着 {100*c['hwin']/n:.1f}% 3着内 {100*c['htop3']/n:.1f}%")
print(f"評価上位3人の3連複 的中 {100*c['box']/n:.1f}% | 先頭＋評価順(競る2人は片方だけ) 的中 {100*c['alt']/n:.1f}%")
