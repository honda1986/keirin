# 前受けラインは有利か / 前受けラインの2車複(先頭=番手)・3連複(ラインの3人)を買うとどうなるか
#   前受けの予想は pf.json(その年を見ていないモデル)、本番の前受けは S のライン(si)
import json, itertools, collections, glob, sys
sys.path.insert(0, "../rv"); import feat
PF = json.load(open("pf.json"))
O2 = {}
for f in glob.glob("../pc/o2/o2f-*.json"): O2.update(json.load(open(f))["races"])
agg = collections.defaultdict(lambda: [0, 0, 0.0])
def add(key, win, pay): a = agg[key]; a[0] += 1; a[1] += win; a[2] += pay
st = collections.defaultdict(lambda: [0, 0, 0])
for l in itertools.chain(open("../rv/races.jsonl", encoding="utf-8"), open("../rv/races26.jsonl", encoding="utf-8")):
    r = json.loads(l); v = PF.get(r["id"])
    if not v or not r.get("fin") or len(r["fin"]) < 3: continue
    L = v["lines"]; p = v["p"]; n = r["n"]; fin = r["fin"]; y = r["y"]
    if sum(len(x) >= 2 for x in L) < 2: continue          # ラインが2本以上あるレースだけ
    pi = max(range(len(L)), key=lambda i: p[i]); si = v["si"]
    mi = next(i for i, x in enumerate(L) if v["rank1"] in x)   # 本命ライン(評価1位のライン)
    # --- 有利か: ラインの先頭の1着・ラインから1着が出る率(本番の前受け / そうでないライン) ---
    for i, x in enumerate(L):
        if len(x) < 2 or si is None: continue
        k = "本番で前受けしたライン" if i == si else "前受けしなかったライン"
        a = st[k]; a[0] += 1; a[1] += x[0] == fin[0]; a[2] += fin[0] in x
    pr = "予想◎(0.5以上)" if p[pi] >= 0.5 else "予想○(0.3〜0.5)" if p[pi] >= 0.3 else "予想△(0.3未満)"
    o2 = O2.get(r["id"]); o3 = r.get("o")
    def buy2(tag, x):
        if len(x) < 2 or not o2 or o2.get("cars") != n: return
        t = tuple(sorted(x[:2])); P2 = list(itertools.combinations(range(1, n + 1), 2))
        if t not in P2: return
        od = o2["o"][P2.index(t)]
        if not od: return
        w = t == tuple(sorted(fin[:2])); add((tag, "2車複", y), w, od * 100 if w else 0); add((tag, "2車複", "計"), w, od * 100 if w else 0)
    def buy3(tag, x):
        if len(x) < 3 or not o3: return
        t = tuple(sorted(x[:3])); T = feat.TRIOS[n]
        if t not in T or not o3[T.index(t)]: return
        od = o3[T.index(t)]; w = t == tuple(sorted(fin))
        pay = (r["p3f"][1] if r.get("p3f") and r["p3f"][0] == "=".join(map(str, t)) else od * 100) if w else 0
        add((tag, "3連複", y), w, pay); add((tag, "3連複", "計"), w, pay)
    for tag, x in [("前受け予想のライン", L[pi]), ("並び予想の先頭ライン", L[0]), ("本命ライン(評価1位)", L[mi]),
                   ("前受け予想のライン " + pr, L[pi]), ("(後から分かる)本番の前受けライン", L[si] if si is not None else [])]:
        buy2(tag, x); buy3(tag, x)
    if pi == mi: buy2("本命ラインが前受け予想", L[pi]); buy3("本命ラインが前受け予想", L[pi])
    else: buy2("本命ラインが前受け予想でない", L[mi]); buy3("本命ラインが前受け予想でない", L[mi])
print("■ 有利か(2本以上ラインがあるレース)")
for k, (n, w, wl) in st.items(): print(f"  {k}: {n}本 先頭の1着 {100*w/n:.1f}% ラインから1着 {100*wl/n:.1f}%")
print("\n■ 買った場合(確定オッズ・100円ずつ)")
tags = sorted({k[0] for k in agg}, key=lambda s: (s.startswith("("), s))
for kind in ["2車複", "3連複"]:
    print(f" [{kind}]")
    for tg in tags:
        n, w, p = agg[(tg, kind, "計")]
        if not n: continue
        yr = " ".join(f"{y}:{agg[(tg,kind,y)][2]/max(1,agg[(tg,kind,y)][0]):.0f}%" for y in [2022, 2023, 2024, 2025, 2026] if agg[(tg, kind, y)][0])
        print(f"  {tg:<28} {n:>6}R 的中 {100*w/n:5.1f}% 回収 {p/n:5.1f}% | {yr}")
