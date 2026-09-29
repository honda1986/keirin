# S・B の特徴(1行=1組。d2225.npz / d26.npz と同じ並び)。組の3人の和
#   python3 sbfeat.py races.jsonl sb2225.npy / races26.jsonl sb26.npy
import json, sys, numpy as np, feat
SB = json.load(open("sb.json"))
NAMES = ["bz", "sz", "head_bz", "fol_lb", "head_sz"]
src, dst = sys.argv[1], sys.argv[2]
out = []; miss = 0
for l in open(src, encoding="utf-8"):
    r = json.loads(l)
    if r["n"] < 5: continue
    keep, lo, RX, TX, wi, cd, info = feat.race_rows(r)
    if wi < 0 or len(keep) < len(feat.TRIOS[r["n"]]) * 0.8: continue
    sb = SB.get(r["id"], {})
    rd = {x[0]: x for x in r["riders"]}
    pos, lead = {}, {}
    for ln in r["lines"]:
        for i, c in enumerate(ln): pos[c] = i; lead[c] = ln[0] if len(ln) >= 2 else c
    br, sr = {}, {}
    for c, x in rd.items():
        st = x[9] or 0; v = sb.get(str(c))
        if v is None or v[0] is None or st <= 0: br[c] = sr[c] = None; miss += v is None
        else: br[c] = min(v[1] / st, 1.0); sr[c] = min(v[0] / st, 1.0)
    def z(d):
        vals = [v for v in d.values() if v is not None]
        m = np.mean(vals) if vals else 0; s = np.std(vals) if len(vals) > 1 else 0
        return {c: ((v - m) / s if (v is not None and s > 0) else 0.0) for c, v in d.items()}
    bz, sz = z(br), z(sr)
    F = {}
    for c in rd:
        ln_len = sum(1 for l2 in r["lines"] if c in l2 and len(l2) >= 2)
        head = 1.0 if (pos.get(c) == 0 and ln_len) else 0.0
        fol = 1.0 if pos.get(c, 0) >= 1 else 0.0
        F[c] = [bz[c], sz[c], head * bz[c], fol * bz.get(lead.get(c, c), 0.0), head * sz[c]]
    for t in keep:
        out.append([F[t[0]][k] + F[t[1]][k] + F[t[2]][k] for k in range(len(NAMES))])
np.save(dst, np.array(out, np.float32)); print(dst, len(out), "S・Bが無いレース", miss)
