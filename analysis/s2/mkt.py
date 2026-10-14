# 市場(2車単の確定オッズ)の2着の当たりと比べる。2025-01〜2026-09
import json, glob, pickle, numpy as np, pandas as pd
races,LD,RD=pickle.load(open("tk_data.pkl","rb"))
M,PW,P2=pickle.load(open("base.pkl","rb")); PW=PW.reset_index(drop=True); P2=P2.reset_index(drop=True)
OD={}
for f in sorted(glob.glob("o2/o2t-*.json")): OD.update(json.load(open(f))["races"])
fin={ri:[q[0] for q in r["fin"][:3]] for ri,r in enumerate(races)}
te=sorted(PW.ri.unique())
pw={(r,c):p for r,c,p in zip(PW.ri,PW.car,PW.pw)}
p2={(r,a,c):p for r,a,c,p in zip(P2.ri,P2.car_1,P2.car,P2.p2)}
rows=[]
for ri in te:
    r=races[ri]; od=OD.get(r["id"]); n=r["n"]
    if not od or od["cars"]!=n or len(od["o"])!=n*(n-1): continue
    pairs=[(a,b) for a in range(1,n+1) for b in range(1,n+1) if a!=b]
    q={k:(1/v if v and v<9999 else 0) for k,v in zip(pairs,od["o"])}
    cars=[c for c in range(1,n+1) if (ri,c) in pw]
    if len(cars)!=n: continue
    f1,f2=fin[ri][0],fin[ri][1]
    # 市場
    m1=max(cars,key=lambda a:sum(q[(a,b)] for b in cars if b!=a))
    m2c=max([b for b in cars if b!=f1],key=lambda b:q[(f1,b)])
    mex=max(pairs,key=lambda k:q[k])
    m2=max(cars,key=lambda b:sum(q[(a,b)] for a in cars if a!=b))
    # モデル
    d1=max(cars,key=lambda a:pw[(ri,a)])
    d2c=max([b for b in cars if b!=f1],key=lambda b:p2[(ri,f1,b)])
    dj={(a,b):pw[(ri,a)]*p2[(ri,a,b)] for a in cars for b in cars if a!=b}
    dex=max(dj,key=dj.get)
    d2=max(cars,key=lambda b:sum(dj[(a,b)] for a in cars if a!=b))
    rows.append(dict(n=n,m1=m1==f1,d1=d1==f1,m2c=m2c==f2,d2c=d2c==f2,mex=mex==(f1,f2),dex=dex==(f1,f2),m2=m2==f2,d2=d2==f2,
                     m2l=np.log(q[(f1,f2)]/sum(q[(f1,b)] for b in cars if b!=f1)),d2l=np.log(p2[(ri,f1,f2)])))
d=pd.DataFrame(rows); print(len(d),"レース(2車単の確定オッズがあるもの)")
print(f"1着1番手:       市場 {d.m1.mean()*100:.1f}%  モデル {d.d1.mean()*100:.1f}%")
print(f"2着(1着を知って): 市場 {d.m2c.mean()*100:.1f}%  モデル {d.d2c.mean()*100:.1f}%   対数確率 市場 {d.m2l.mean():.3f} モデル {d.d2l.mean():.3f}")
print(f"2着率いちばん:    市場 {d.m2.mean()*100:.1f}%  モデル {d.d2.mean()*100:.1f}%")
print(f"2連単1点:        市場 {d.mex.mean()*100:.1f}%  モデル {d.dex.mean()*100:.1f}%")
for n,g in d.groupby("n"): print(f"  {n}車 {len(g)}R  2着(1着を知って) 市場 {g.m2c.mean()*100:.1f}% モデル {g.d2c.mean()*100:.1f}%  2連単 市場 {g.mex.mean()*100:.1f}% モデル {g.dex.mean()*100:.1f}%")
