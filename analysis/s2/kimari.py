# 1着の選手が「最終バック先頭のライン(b)」から見てどこにいたか → 決まり手。学習 2022-24 の実際で表を作り、2025-26 の予想(場面×1着)に当てはめる
import sys, pickle, numpy as np, pandas as pd, time
sys.path.insert(0,".")
from tkcore import *
t0=time.time()
M,_,_=pickle.load(open("base.pkl","rb"))
km={ri:r["fin"][0][1] for ri,r in enumerate(races)}
def cls(li,k,role,b,s):
    if role==3: return "単騎"
    if li==b: return "主導権ライン先頭" if k==0 else ("主導権ライン番手" if k==1 else "主導権ライン3番手以降")
    return "他ライン先頭" if k==0 else "他ライン番手以降"
# 実際(学習年): 1着の位置 × 決まり手
W=RD[RD.win==1].merge(sb,on="ri"); W["c"]=[cls(a,b_,c,d,e) for a,b_,c,d,e in zip(W.li,W.k,W.role,W.b,W.s)]; W["km"]=W.ri.map(km)
W["km"]=W.km.where(W.km.isin(["逃","捲","差","マ"]),"他")
tab=pd.crosstab(W[W.year<=2024].c,W[W.year<=2024].km,normalize="index")
print("■ 1着の位置ごとの決まり手(2022-24)\n",(tab*100).round(1).to_string()); print(W[W.year<=2024].c.value_counts(normalize=True).mul(100).round(1).to_string())
# 予想: 場面(s,b)×1着の確率 → 決まり手の確率
te=sorted(set(RD.ri[RD.year>=2025])); out=[]
for s0 in range(0,len(te),3000):
    rr=te[s0:s0+3000]; L=LD[LD.ri.isin(rr)].copy(); R=RD[RD.ri.isin(rr)]
    L["pS"]=M["A"].predict_proba(L[FA])[:,1]; L["pS"]/=L.groupby("ri").pS.transform("sum")
    BB=bframe(L.drop(columns=["pS"]),L.assign(s=L.li,pSs=L.pS)); BB["pB"]=M["B"].predict_proba(BB[FB])[:,1]; BB["pB"]/=BB.groupby(["ri","s"]).pB.transform("sum")
    BB["p"]=BB.pSs*BB.pB; sc=BB[BB.p>=0.003][["ri","s","li","p"]].rename(columns={"li":"b"}); sc["p"]/=sc.groupby("ri").p.transform("sum")
    X=cframe(R,sc); X["w"]=M["W"].predict_proba(X[FC])[:,1]; X["w"]=X.w/X.groupby(["ri","s","b"]).w.transform("sum")*X.p
    X["c"]=[cls(a,b_,c,d,e) for a,b_,c,d,e in zip(X.li,X.k,X.role,X.b,X.s)]
    for k in tab.columns: X[k]=X.w*X.c.map(tab[k])
    out.append(X.groupby("ri")[list(tab.columns)].sum())
P=pd.concat(out); P["act"]=P.index.map(km); P["act"]=P.act.where(P.act.isin(["逃","捲","差","マ"]),"他")
P["pred"]=P[list(tab.columns)].idxmax(axis=1)
print(f"\n■ 2025-26 {len(P)}R: 決まり手のいちばん高い予想が当たる {(P.pred==P.act).mean()*100:.1f}%  (いつも『差』と言うと {(P.act=='差').mean()*100:.1f}%)")
for k in ["逃","捲","差"]:
    b=pd.cut(P[k],[0,.15,.25,.35,.45,.6,1]); g=P.groupby(b,observed=True)
    print(f"  {k}の確率の帯ごと: "+" / ".join(f"予想{iv.left*100:.0f}〜{iv.right*100:.0f}% → 実際{(gg.act==k).mean()*100:.0f}%({len(gg)}R)" for iv,gg in g))
pickle.dump((tab,P),open("kimari.pkl","wb")); print(round(time.time()-t0),"秒")
