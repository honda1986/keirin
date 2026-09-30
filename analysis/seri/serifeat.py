# 競りの特徴(1行=1組。d2225.npz / d26.npz と同じ並び)
#   python3 serifeat.py races.jsonl seri2225.npy / races26.jsonl seri26.npy
#   列: 先頭(競りのラインの先頭)の数 / カッコの前の数 / カッコの後の数 / 競る2人を両方含む / 競りのあるレース
import json, sys, glob, re, numpy as np, feat
NB = {}
for f in sorted(glob.glob("../seri/nb/nb-*.json")): NB.update(json.load(open(f))["races"])
NAMES = ["s_head", "s_front", "s_back", "s_both", "s_race"]
def parse(nb):
    out = []
    for seg in nb.split("|"):
        pos = [[int(c) for c in m.group(1)] if m.group(1) else [int(m.group(2))] for m in re.finditer(r"\((\d+)\)|(\d)", seg)]
        if pos: out.append(pos)
    return out
src, dst = sys.argv[1], sys.argv[2]
out = []; miss = 0; nser = 0
for l in open(src, encoding="utf-8"):
    r = json.loads(l)
    if r["n"] < 5: continue
    keep, lo, RX, TX, wi, cd, info = feat.race_rows(r)
    if wi < 0 or len(keep) < len(feat.TRIOS[r["n"]]) * 0.8: continue
    v = NB.get(r["id"]); head, front, back, pairs = set(), set(), set(), []
    if v is None: miss += 1
    else:
        for ln in parse(v["nb"]):
            if any(len(p) == 2 for p in ln):
                head.add(ln[0][0])
                for p in ln:
                    if len(p) == 2: front.add(p[0]); back.add(p[1]); pairs.append(set(p))
    nser += bool(pairs)
    for t in keep:
        s = set(t)
        out.append([len(s & head), len(s & front), len(s & back), float(any(p <= s for p in pairs)), float(bool(pairs))])
np.save(dst, np.array(out, np.float32)); print(dst, len(out), "並びが無いレース", miss, "競りのあるレース", nser)
