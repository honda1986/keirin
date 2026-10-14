# 2着候補を2人にしたら / 2車複(1・2着の2人)なら / 3着は
import json, glob, pickle, numpy as np, pandas as pd
races,LD,RD=pickle.load(open("tk_data.pkl","rb"))
M,PW,P2=pickle.load(open("base.pkl","rb")); PW=PW.reset_index(drop=True); P2=P2.reset_index(drop=True)
O2={}
for f in sorted(glob.glob("o2/o2t-*.json")): O2.update(json.load(open(f))["races"])
fin={ri:[q[0] for q in r["fin"][:3]] for ri,r in enumerate(races)}
J=P2.merge(PW.rename(columns={"car":"car_1"}),on=["ri","car_1"]); J["pj"]=J.pw*J.p2
m2=J.groupby(["ri","car"]).pj.sum().rename("p").reset_index()
m2["rk"]=m2.groupby("ri").p.rank(ascending=False,method="first")
m2["t2"]=m2.ri.map(lambda r:fin[r][1])
cov=m2[m2.car==m2.t2].rk
print(f"2着が モデルの2着候補の 1番手 {(cov<=1).mean()*100:.1f}% / 2番手まで {(cov<=2).mean()*100:.1f}% / 3番手まで {(cov<=3).mean()*100:.1f}%")
# 連対(2着以内)の2人 = 2車複
J["key"]=[tuple(sorted(x)) for x in zip(J.car_1,J.car)]
f2=J.groupby(["ri","key"]).pj.sum().reset_index(); top=f2.loc[f2.groupby("ri").pj.idxmax()]
hitm=np.mean([k==tuple(sorted(fin[r][:2])) for r,k in zip(top.ri,top.key)])
# 市場の2車複1点(2車単から)
h=n=0; hc=0
for r,k in zip(top.ri,top.key):
    o=O2.get(races[r]["id"]); nn=races[r]["n"]
    if not o or o["cars"]!=nn or len(o["o"])!=nn*(nn-1): continue
    pairs=[(a,b) for a in range(1,nn+1) for b in range(1,nn+1) if a!=b]; q={}
    for (a,b),v in zip(pairs,o["o"]): q[tuple(sorted((a,b)))]=q.get(tuple(sorted((a,b))),0)+(1/v if v and v<9999 else 0)
    mk=max(q,key=q.get); t=tuple(sorted(fin[r][:2])); h+=mk==t; hc+=k==t; n+=1
print(f"2車複1点(1・2着の2人): モデル {hc/n*100:.1f}%  市場 {h/n*100:.1f}%  ({n}R)")
