# 展開モデルを「前の年だけ」で作り直して、後の年の各選手の 1着・3着内確率を出す
import numpy as np, pandas as pd, pickle, time, sys
from sklearn.ensemble import HistGradientBoostingClassifier as GB
races,LD,RD=pickle.load(open("tk_data.pkl","rb"))
mA0,mB0,FA,FB=pickle.load(open("tk_AB.pkl","rb")); _,_,_,_,RF,FC=pickle.load(open("tk_C.pkl","rb"))
def gb(): return GB(max_iter=300,learning_rate=0.06,min_samples_leaf=100,l2_regularization=1.0,random_state=0)
LA=LD[["ri","li","pos","size","style","h_z"]]
sb=LD[LD.isS==1][["ri","li"]].rename(columns={"li":"s"}).drop_duplicates("ri").merge(LD[LD.isB==1][["ri","li"]].rename(columns={"li":"b"}).drop_duplicates("ri"),on="ri")
def bframe(L, S):
    """L: 候補の主導権の線, S: (ri, s, …) → B 用の特徴"""
    Sc=S[["ri","s","pSs","size","style","h_B","h_nige","h_z","pos"]].rename(columns={"size":"S_size","style":"S_style","h_B":"S_hB","h_nige":"S_hnige","h_z":"S_hz","pos":"S_pos"})
    X=L.merge(Sc,on="ri"); X["isS"]=(X.li==X.s).astype(int); X["rel"]=X.pos-X.S_pos; return X
def cframe(R, sc):
    X=R.merge(sc,on="ri")
    X=X.merge(LA.rename(columns={"li":"b","pos":"B_pos","size":"B_size","style":"B_style","h_z":"B_hz"}),on=["ri","b"])
    X=X.merge(LA[["ri","li","size","style"]].rename(columns={"li":"s","size":"S_size","style":"S_style"}),on=["ri","s"])
    X["inS"]=(X.li==X.s).astype(int); X["inB"]=(X.li==X.b).astype(int); X["tsup"]=(X.s==X.b).astype(int); X["relB"]=X.lpos-X.B_pos; return X
out={}
for train,pred in [([2022],[2023,2024]),([2022,2023],[2024,2025,2026])]:
    t0=time.time()
    Lt=LD[LD.year.isin(train)]
    mA=gb().fit(Lt[FA],Lt.isS)
    S=Lt[Lt.isS==1].assign(s=lambda d:d.li,pSs=1.0)
    BX=bframe(Lt.drop(columns=[]),S); mB=gb().fit(BX[FB],BX.isB)
    X=cframe(RD[RD.year.isin(train)],sb.assign(p=1.0)); mW=gb().fit(X[FC],X.win); m3=gb().fit(X[FC],X.top3)
    # 予想
    L=LD[LD.year.isin(pred)].copy(); L["pS"]=mA.predict_proba(L[FA])[:,1]; L["pS"]/=L.groupby("ri").pS.transform("sum")
    S=L.assign(s=L.li,pSs=L.pS)
    BB=bframe(L.drop(columns=["pS"]),S); BB["pB"]=mB.predict_proba(BB[FB])[:,1]; BB["pB"]/=BB.groupby(["ri","s"]).pB.transform("sum")
    BB["p"]=BB.pSs*BB.pB; sc=BB[BB.p>=0.003][["ri","s","li","p"]].rename(columns={"li":"b"}); sc["p"]/=sc.groupby("ri").p.transform("sum")
    X=cframe(RD[RD.year.isin(pred)],sc)
    X["w"]=mW.predict_proba(X[FC])[:,1]; X["t"]=m3.predict_proba(X[FC])[:,1]
    X["w"]/=X.groupby(["ri","s","b"]).w.transform("sum"); X["t"]=(X.t*3/X.groupby(["ri","s","b"]).t.transform("sum")).clip(upper=0.999)
    X["w"]*=X.p; X["t"]*=X.p
    P=X.groupby(["ri","car"]).agg(pw=("w","sum"),pt=("t","sum")).reset_index()
    P["id"]=[races[i]["id"] for i in P.ri]
    out[tuple(train)]={(a,int(c)):(w,t) for a,c,w,t in zip(P.id,P.car,P.pw,P.pt)}
    print("学習",train,"→",pred,len(P),"人",round(time.time()-t0),"秒",flush=True)
pickle.dump(out,open("tk_folds.pkl","wb"))
