# evd.js(D-2026-10a)の突き合わせ用: 2026年のレース(先頭から25R＋競りのあるレース全部)の全組の期待値を Python で出す
import json, glob, re, numpy as np, feat
m = json.load(open("modelD_final_seri.json")); c = m["coef"]; LOM = m["LO_MEAN"]
NB = {}
for f in sorted(glob.glob("../seri/nb/nb-2026*.json")): NB.update(json.load(open(f))["races"])
def pairs_of(nb):
    out = []
    for seg in nb.split("|"):
        for mm in re.finditer(r"\((\d)(\d)\)", seg): out.append([int(mm.group(1)), int(mm.group(2))])
    return out
RK = ["er", "single", "banme", "age50", "home", "young", "samepref", "dsc", "has_dsc", "r120", "has_r", "scz", "head", "srk"]
out = []; ns = 0
for i, l in enumerate(open("races26.jsonl", encoding="utf-8")):
    r = json.loads(l); v = NB.get(r["id"]); seri = pairs_of(v["nb"]) if v else []
    if not (i < 25 or (seri and ns < 30)): continue
    if any(x[7] is None for x in r["riders"]): continue
    keep, lo, RX, TX, wi, cd, info = feat.race_rows(r)
    if len(keep) < len(feat.TRIOS[r["n"]]) * 0.8: continue
    sh, sf, sb = set(), set(), set(); P = []
    for q in seri:
        ln = next((x for x in r["lines"] if q[0] in x), None)
        if not ln or q[1] not in ln: continue
        if ln[0] not in q: sh.add(ln[0])
        sf.add(q[0]); sb.add(q[1]); P.append(q)
    lo = np.array(lo); lc = lo - LOM; is9 = 1.0 if r["n"] >= 8 else 0.0
    RI = {k: j for j, k in enumerate(feat.RIDER_F)}
    u = c["K"] * lo + c["lo2"] * lc**2 + c["lo3"] * lc**3 + c["lo9"] * lo * is9
    for k in RK: u = u + c[k] * RX[:, RI[k]]
    u = u + np.array([c["s_head"] * len(set(t) & sh) + c["s_front"] * len(set(t) & sf) + c["s_back"] * len(set(t) & sb)
                      + c["s_both"] * any(q[0] in t and q[1] in t for q in P) for t in keep])
    p = np.exp(u - u.max()); p /= p.sum()
    ns += bool(P)
    out.append({"id": r["id"], "place": r["place"], "n": r["n"], "lines": r["lines"], "riders": r["riders"], "seri": P, "o": r["o"],
                "ev": {"=".join(map(str, t)): float(pp * np.exp(-ll)) for t, pp, ll in zip(keep, p, lo)}})
json.dump(out, open("/home/user/keirin/test/evd_fixture.json", "w"), ensure_ascii=False)
print(len(out), "レース(競りあり", ns, ")")
