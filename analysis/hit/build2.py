# 2車複・2車単の全組の行列(条件付きロジットの材料)。1行=1組
#   python3 build2.py → f2.npz(2車複) t2.npz(2車単)
import json, os, sys, itertools, numpy as np
sys.path.insert(0, "../rv"); import feat
O2 = "../pc/o2"
F2, T2 = {}, {}
for f in os.listdir(O2):
    if f.startswith("o2f-"): F2.update(json.load(open(f"{O2}/{f}"))["races"])
    if f.startswith("o2t-"): T2.update(json.load(open(f"{O2}/{f}"))["races"])
RF = feat.RIDER_F
PAIR_F = ["same", "hb", "main", "mainhb", "solo_in", "hb9"]      # 同じライン / 先頭と番手 / 本命ラインどうし / 本命ラインの先頭と番手 / 単騎を含む / 9車の先頭番手
ORD_F = ["hb_ord", "bh_ord"]                                         # 2車単: 先頭→番手の順 / 番手→先頭の順
def rows(r, kind):
    n = r["n"]; F, pos, ln = feat.rider_feats(r)
    lineOf = {c: i for i, l in enumerate(r["lines"]) for c in l}
    rank1 = min(F, key=lambda c: F[c]["er"]); main = lineOf.get(rank1)
    src = (F2 if kind == "f" else T2).get(r["id"])
    if not src or src.get("cars") != n: return None
    combos = list(itertools.combinations(range(1, n + 1), 2)) if kind == "f" else [(a, b) for a in range(1, n + 1) for b in range(1, n + 1) if a != b]
    if len(src["o"]) != len(combos): return None
    win = tuple(sorted(r["fin"][:2])) if kind == "f" else tuple(r["fin"][:2])
    keep, lo, X, wi = [], [], [], -1
    for c, v in zip(combos, src["o"]):
        if not (v and 0 < v < 9999): continue
        a, b = c
        same = lineOf.get(a) is not None and lineOf.get(a) == lineOf.get(b)
        hb = same and sorted([pos[a], pos[b]]) == [0, 1]
        mn = same and lineOf.get(a) == main
        solo = (ln.get(a, 1) == 1) or (ln.get(b, 1) == 1)
        pf = [same, hb, mn, mn and hb, solo, hb and n >= 8]
        if kind == "f":
            rx = [F[a][k] + F[b][k] for k in RF]
            x = rx + pf
        else:
            x = [F[a][k] for k in RF] + [F[b][k] for k in RF] + pf + [hb and pos[a] == 0, hb and pos[a] == 1]
        if c == win: wi = len(keep)
        keep.append(c); lo.append(np.log(1 / v)); X.append(x)
    if wi < 0 or len(keep) < len(combos) * 0.8: return None
    return keep, np.array(lo), np.array(X, float), wi
for kind in ["f", "t"]:
    XS, LO, W, G, OD, META, IDS = [], [], [], [], [], [], []
    for src in ["../rv/races.jsonl", "../rv/races26.jsonl"]:
        for l in open(src, encoding="utf-8"):
            r = json.loads(l)
            if r["n"] < 5: continue
            z = rows(r, kind)
            if not z: continue
            keep, lo, X, wi = z; g = len(META)
            solo = sum(1 for x in r["lines"] if len(x) == 1)
            META.append([r["y"], r["m"], r["n"], solo]); IDS.append(r["id"])
            XS.append(X); LO.append(lo); OD.append(np.exp(-lo)); G.append(np.full(len(keep), g))
            w = np.zeros(len(keep), np.int8); w[wi] = 1; W.append(w)
    np.savez_compressed(f"{kind}2.npz", X=np.vstack(XS).astype(np.float32), LO=np.concatenate(LO), W=np.concatenate(W), G=np.concatenate(G),
                        ODDS=np.concatenate(OD).astype(np.float32), META=np.array(META, np.int32), IDS=np.array(IDS))
    print(kind, "レース", len(META), "組", sum(len(x) for x in LO), flush=True)
