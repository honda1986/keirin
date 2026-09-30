# 🔥(9車・単騎1人以下・5〜15倍・SS無し)を「全部買う」と「本命ラインの前受け予想が0.5以上だけ買う」で比べる。年別・収支・最大の落ち込み
import json, itertools, collections, sys
sys.path.insert(0, "../rv"); import feat
PF = json.load(open("pf.json")); SS = set(json.load(open("../rv/ss_ids.json"))); RB = json.load(open("../pc/rbss.json"))
rows = []
for l in itertools.chain(open("../rv/races.jsonl", encoding="utf-8"), open("../rv/races26.jsonl", encoding="utf-8")):
    r = json.loads(l); v = PF.get(r["id"]); b = RB.get(r["id"])
    if not v or not b or not b.get("hot") or not b.get("trio") or r["n"] < 8 or r["id"] in SS or not r.get("o"): continue
    t = tuple(sorted(b["trio"])); T = feat.TRIOS[r["n"]]
    if t not in T: continue
    od = r["o"][T.index(t)]
    if not od or not (5 <= od <= 15): continue
    mi = next(i for i, x in enumerate(v["lines"]) if v["rank1"] in x); pm = v["p"][mi]
    win = tuple(sorted(r["fin"])) == t
    pay = (r["p3f"][1] if r.get("p3f") and r["p3f"][0] == "=".join(map(str, t)) else od * 100) if win else 0
    rows.append((r["id"], r["y"], pm, win, pay))
rows.sort()
def summ(name, sel):
    by = collections.defaultdict(lambda: [0, 0, 0.0]); bal = peak = dd = 0
    for rid, y, pm, w, pay in rows:
        if not sel(pm): continue
        for k in (y, "計"): a = by[k]; a[0] += 1; a[1] += w; a[2] += pay
        bal += pay - 100; peak = max(peak, bal); dd = max(dd, peak - bal)
    n, h, p = by["計"]
    print(f"{name}: {n}R 的中{100*h/n:.1f}% 回収{p/n:.1f}% 収支{p-100*n:+,.0f}円 最大の落ち込み -{dd:,.0f}円")
    print("   年別: " + " | ".join(f"{y}: {by[y][0]}R 回収{by[y][2]/by[y][0]:.0f}% 収支{by[y][2]-100*by[y][0]:+,.0f}" for y in [2022, 2023, 2024, 2025, 2026]))
summ("全部買う(いま)", lambda pm: True)
summ("前受け◎(0.5以上)だけ", lambda pm: pm >= 0.5)
summ("前受け◎△(0.3以上)だけ", lambda pm: pm >= 0.3)
summ("前受け△×(0.5未満)", lambda pm: pm < 0.5)
