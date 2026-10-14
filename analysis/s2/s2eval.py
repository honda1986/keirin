# 2着の当たり方を測る(2022-24 で作り 2025-26 で試す)
import time, numpy as np, pandas as pd, pickle
from tkcore import *
t0=time.time()
PARAMS=dict(max_iter=150,learning_rate=0.1,max_leaf_nodes=15)
M=train([2022,2023,2024],PARAMS); print("学習",round(time.time()-t0),"秒",flush=True)
te=sorted(set(RD.ri[RD.year>=2025]))
# 1着率 pw と 2着|1着 p2 を全部取る
PW=[];P2=[]
for s in range(0,len(te),2000):
    rr=te[s:s+2000]; L=LD[LD.ri.isin(rr)].copy(); R=RD[RD.ri.isin(rr)]
    L["pS"]=M["A"].predict_proba(L[FA])[:,1]; L["pS"]/=L.groupby("ri").pS.transform("sum")
    BB=bframe(L.drop(columns=["pS"]),L.assign(s=L.li,pSs=L.pS)); BB["pB"]=M["B"].predict_proba(BB[FB])[:,1]; BB["pB"]/=BB.groupby(["ri","s"]).pB.transform("sum")
    BB["p"]=BB.pSs*BB.pB; sc=BB[BB.p>=0.003][["ri","s","li","p"]].rename(columns={"li":"b"}); sc["p"]/=sc.groupby("ri").p.transform("sum")
    X=cframe(R,sc); X["w"]=M["W"].predict_proba(X[FC])[:,1]; X["w"]=X.w/X.groupby(["ri","s","b"]).w.transform("sum")*X.p
    PW.append(X.groupby(["ri","car"]).w.sum().rename("pw").reset_index())
    X2=pair(R,R,"_1"); X2["p2"]=M["S2"].predict_proba(X2[F2])[:,1]; X2["p2"]/=X2.groupby(["ri","car_1"]).p2.transform("sum")
    P2.append(X2[["ri","car_1","car","p2","role","role_1","same_1","behind_1","ahead_1","rank","z"]])
PW=pd.concat(PW); P2=pd.concat(P2)
pickle.dump((M,PW,P2),open("base.pkl","wb"))
print("予想",round(time.time()-t0),"秒",flush=True)
