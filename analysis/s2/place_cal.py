# 展開モデルの「2着の確率」「3着の確率」は当たっているか(2022-24 で作り 2025-26 で試す。全部の3連単から各選手の 1・2・3着の確率を足す)
import sys, pickle, numpy as np, pandas as pd, time
sys.path.insert(0,".")
from tkcore import *
t0=time.time()
M,_,_=pickle.load(open("base.pkl","rb"))
te=sorted(set(RD.ri[RD.year>=2025])); out=[]
for s in range(0,len(te),3000):
    P,_=predict(M,te[s:s+3000])
    m=pd.concat([P.groupby(["ri","a"]).P.sum().rename("p1").rename_axis(["ri","car"]),P.groupby(["ri","b"]).P.sum().rename("p2").rename_axis(["ri","car"]),
                 P.groupby(["ri","c"]).P.sum().rename("p3").rename_axis(["ri","car"])],axis=1).fillna(0).reset_index()
    out.append(m)
Q=pd.concat(out).reset_index(drop=True); Q["pos"]=[ {c:j+1 for j,c in enumerate(fin[r])}.get(c,9) for r,c in zip(Q.ri,Q.car)]
for k in (1,2,3):
    col=f"p{k}"; b=pd.cut(Q[col],[0,.05,.1,.15,.2,.3,.45,1]); g=Q.groupby(b,observed=True)
    print(f"■ {k}着の確率 → 実際に{k}着: "+" / ".join(f"{iv.left*100:.0f}〜{iv.right*100:.0f}% → {(gg.pos==k).mean()*100:.1f}%({len(gg)})" for iv,gg in g))
    top=Q.loc[Q.groupby("ri")[col].idxmax()]; print(f"   {k}着の確率がいちばん高い選手が{k}着: {(top.pos==k).mean()*100:.1f}%")
Q["p123"]=Q.p1+Q.p2+Q.p3; b=pd.cut(Q.p123,[0,.2,.4,.6,.8,1]); g=Q.groupby(b,observed=True)
print("■ 3着以内の確率 → 実際: "+" / ".join(f"{iv.left*100:.0f}〜{iv.right*100:.0f}% → {(gg.pos<=3).mean()*100:.1f}%({len(gg)})" for iv,gg in g))
print(round(time.time()-t0),"秒")
