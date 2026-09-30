# 競り(並び予想のカッコ)の学習: どれくらいあるか・競りの選手/先行選手の成績・🔥への影響
import json, glob, itertools, collections, sys, re
sys.path.insert(0, "../rv"); import feat
NB = {}
for f in sorted(glob.glob("nb/nb-*.json")):
    NB.update(json.load(open(f))["races"])
def parse(nb):
    # "1|3(54)(62)|7" → [[ [1] ], [ [3], [5,4], [6,2] ], [ [7] ]]  (ライン → 位置 → その位置の選手。2人なら競り)
    out = []
    for seg in nb.split("|"):
        pos = []
        for m in re.finditer(r"\((\d+)\)|(\d)", seg):
            pos.append([int(c) for c in m.group(1)] if m.group(1) else [int(m.group(2))])
        if pos: out.append(pos)
    return out

