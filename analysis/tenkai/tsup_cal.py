# 展開モデル(②主導権。2022-24 で作ったもの)の「突っ張る確率」と 2025-26 の実際を、自分×相手の人数ごとに比べる
import pickle, pandas as pd, numpy as np
from tkcore import *
M=pickle.load(open("fb_M.pkl","rb")); D=pd.read_pickle("tsup.pkl")
L=LD[LD.year>=2025]
S=L[L.isS==1].drop_duplicates("ri").assign(s=lambda d:d.li,pSs=1.0)
BB=bframe(L,S); BB["pB"]=M["B"].predict_proba(BB[FB])[:,1]; BB["pB"]/=BB.groupby(["ri","s"]).pB.transform("sum")
pt=BB[BB.li==BB.s][["ri","pB"]].rename(columns={"pB":"pred"})
X=D[D.year>=2025].merge(pt,on="ri"); X["car"]=np.where(X.n>=8,"9車","7車"); cap=lambda v:"4+" if v>=4 else str(v)
X["ownc"]=X.own.map(cap); X["omaxc"]=X.omax.map(cap)
for car in ("7車","9車"):
    print(f"== {car}（2025-26 {len(X[X.car==car])}R） 実際 / モデル")
    for (a,b),q in X[X.car==car].groupby(["ownc","omaxc"]):
        if len(q)<150: continue
        print(f"  自分{a}人・相手{b}人 {len(q):6d}R  実際 {q.tsup.mean()*100:4.1f}%  モデル {q.pred.mean()*100:4.1f}%")
