# 競り(並び予想のカッコ)の学習: どれくらいあるか・競りの選手/先行選手の成績・🔥への影響
import json, glob, itertools, collections, sys, re
sys.path.insert(0, "../rv"); import feat
NB = {}
for f in sorted(glob.glob("nb/nb-*.json")):
    NB.update(json.load(open(f))["races"])
RB = json.load(open("../pc/rbss.json")); SS = set(json.load(open("../rv/ss_ids.json")))
OD = {}
for l in itertools.chain(open("../rv/races.jsonl", encoding="utf-8"), open("../rv/races26.jsonl", encoding="utf-8")):
    r = json.loads(l); OD[r["id"]] = r

def parse(nb):
    # "1|3(54)(62)|7" → [[ [1] ], [ [3], [5,4], [6,2] ], [ [7] ]]  (ライン → 位置 → その位置の選手。2人なら競り)
    out = []
    for seg in nb.split("|"):
        pos = []
        for m in re.finditer(r"\((\d+)\)|(\d)", seg):
            pos.append([int(c) for c in m.group(1)] if m.group(1) else [int(m.group(2))])
        if pos: out.append(pos)
    return out

pct = lambda a, b: f"{100*a/max(1,b):.1f}%"
# ---- 1. どれくらいあるか ----
cnt = collections.Counter(); tot = collections.Counter(); shapes = collections.Counter()
for k, v in NB.items():
    y = k[:4]; tot[y] += 1
    if "(" in v["nb"]:
        cnt[y] += 1
        for ln in parse(v["nb"]):
            sh = "".join("(" + str(len(p)) + ")" if len(p) > 1 else "1" for p in ln)
            if "(" in sh: shapes[sh] += 1
print("■ 競りのあるレース")
for y in sorted(tot): print(f"  {y}: {cnt[y]}/{tot[y]} ({pct(cnt[y], tot[y])})")
print("  競りのあるラインの形(1=1人・(2)=2人が競る):", shapes.most_common(10))
bad = [(k, v["nb"]) for k, v in NB.items() if any(len(p) > 2 for ln in parse(v["nb"]) for p in ln)]
print("  3人以上が同じ位置:", len(bad), bad[:3])

# ---- 2. 競りの選手・先行の成績 ----
top3 = collections.defaultdict(lambda: [0, 0, 0])   # [人数, 3着以内, 1着]
def add(key, c, fin):
    a = top3[key]; a[0] += 1; a[1] += c in fin; a[2] += c == fin[0]
same = [0, 0]
for k, v in NB.items():
    rb = RB.get(k)
    if not rb or not rb.get("fin") or len(rb["fin"]) < 3: continue
    fin = rb["fin"]; L = parse(v["nb"]); rd = {x[0]: x for x in rb.get("riders", [])} if rb.get("riders") else {}
    rank = {c: i + 1 for i, c in enumerate(rb.get("ranked") or [])}
    has = any(len(p) > 1 for ln in L for p in ln)
    for ln in L:
        sl = any(len(p) > 1 for p in ln)
        if len(ln) >= 2:
            add(("先頭(競りのライン)" if sl else "先頭(ふつうの2人以上ライン)"), ln[0][0], fin)
        for i, p in enumerate(ln):
            if len(p) == 2:
                a, b = p
                add((f"{i+1}番目・カッコの前", ), a, fin); add((f"{i+1}番目・カッコの後", ), b, fin)
                # カッコの前の選手は先頭と同じ府県か
                if rd and ln[0][0] in rd and a in rd and b in rd:
                    same[0] += rd[a][7] == rd[ln[0][0]][7]; same[1] += rd[b][7] == rd[ln[0][0]][7]
                ra, rb_ = rank.get(a, 9), rank.get(b, 9)
                add(("競りで評価が上の方",), a if ra < rb_ else b, fin); add(("競りで評価が下の方",), b if ra < rb_ else a, fin)
            elif i >= 1 and not sl and len(p) == 1:
                add((f"{i+1}番目・ふつう",), p[0], fin)
print("\n■ 3着以内・1着の率")
for key in sorted(top3, key=str):
    n, t, w = top3[key]; print(f"  {' '.join(key) if isinstance(key, tuple) else key}: {n}人 3着内 {pct(t, n)} 1着 {pct(w, n)}")
print(f"  先頭と同じ府県: カッコの前 {same[0]} / カッコの後 {same[1]}")

# ---- 3. 評価1位の選手の位置別 ----
# ---- 4. 🔥(9車・5〜15倍・SS無し)と競り ----
agg = collections.defaultdict(lambda: [0, 0, 0.0])
def acc(key, win, pay): a = agg[key]; a[0] += 1; a[1] += win; a[2] += pay
for k, v in NB.items():
    rb = RB.get(k); r = OD.get(k)
    if not rb or not r or not rb.get("hot") or not rb.get("trio") or r["n"] < 8 or k in SS or not r.get("o"): continue
    t = tuple(sorted(rb["trio"])); T = feat.TRIOS[r["n"]]
    if t not in T: continue
    od = r["o"][T.index(t)]
    if not od: continue
    L = parse(v["nb"]); flat = {c: ln for ln in L for p in ln for c in p}
    win = tuple(sorted(r["fin"])) == t
    pay = (r["p3f"][1] if r.get("p3f") and r["p3f"][0] == "=".join(map(str, t)) else od * 100) if win else 0
    pairs = [set(p) for ln in L for p in ln if len(p) == 2]
    both = any(pp <= set(t) for pp in pairs); one = any(pp & set(t) for pp in pairs)
    mainline = flat.get(rb["trio"][0]); mseri = mainline is not None and any(len(p) > 1 for p in mainline)
    anyseri = bool(pairs)
    g = "競り無し" if not anyseri else ("本命ラインが競り・2人とも買い目" if both else "本命ラインが競り・1人だけ買い目" if one else "競りは他のライン")
    band = 5 <= od <= 15
    for kk in [(g, "5〜15倍" if band else "帯の外"), (g, r["y"] if band else "x")]: acc(kk, win, pay)
print("\n■ 🔥(9車・SS無し)と競り: 件数・的中率・回収率")
for g in ["競り無し", "競りは他のライン", "本命ラインが競り・1人だけ買い目", "本命ラインが競り・2人とも買い目"]:
    for b in ["5〜15倍", "帯の外"]:
        n, h, p = agg[(g, b)]
        if n: print(f"  {g} {b}: {n}R 的中 {pct(h, n)} 回収 {p/n:.0f}%")
    print("     年別(5〜15倍):", " | ".join(f"{y}: {agg[(g,y)][0]}R {pct(agg[(g,y)][1], agg[(g,y)][0])} {agg[(g,y)][2]/max(1,agg[(g,y)][0]):.0f}%" for y in [2022, 2023, 2024, 2025, 2026] if agg[(g, y)][0]))
