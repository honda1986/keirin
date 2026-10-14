# 最終バックの並び(筋書きごと)を 1着・2着・3着の予想に足したらどうなるか(はむさんの質問 2026-10-15)
#   並びの決まり(はむさん): 周回中 = 前受け(s)のラインが先頭・残りは並び予想の順 / 最終バック = 主導権(b)のラインが先頭・残りは周回中の順のまま
#   足す特徴: bk = そのラインが最終バックで何番目(0=先頭) / bkrear = 最後方 / qpos = 一本棒で前に何人 / qrel = qpos/(n-1)
#   2022-24 で作り 2025-26(8,000R)で試す。①前受け・②主導権は同じモデル
import time, sys, numpy as np, pandas as pd, pickle, itertools, json, glob
from tkcore import *
from sklearn.ensemble import HistGradientBoostingClassifier as GB
PAR=dict(max_iter=150,learning_rate=0.1,max_leaf_nodes=15)
gb=lambda: GB(random_state=0,l2_regularization=1.0,min_samples_leaf=100,**PAR)
SZ=LD[["ri","li","size"]]; NN=RD.groupby("ri").car.count().rename("nn")
def backtab(sc):
    """sc[ri,s,b] → ライン×筋書きの表 [ri,s,b,li,bk,bkrear,ahead]"""
    X=sc[["ri","s","b"]].drop_duplicates().merge(SZ,on="ri")
    lapr=np.where(X.li==X.s,0,1+X.li-(X.s<X.li).astype(int))
    lapb=np.where(X.b==X.s,0,1+X.b-(X.s<X.b).astype(int))
    X["bk"]=np.where(X.b==X.s,lapr,np.where(X.li==X.b,0,1+lapr-(lapb<lapr).astype(int)))
    X=X.sort_values(["ri","s","b","bk"]); X["nah"]=X.groupby(["ri","s","b"])["size"].cumsum()-X["size"]
    X["nlx"]=X.groupby(["ri","s","b"]).li.transform("count"); X["bkrear"]=(X.bk==X.nlx-1).astype(int)
    return X[["ri","s","b","li","bk","bkrear","nah"]]
def addback(R,sc,sfx=""):
    """R(選手の行・ri,li,k と s,b を持つ) に最終バックの位置を足す"""
    T=backtab(sc).rename(columns={"li":"li"+sfx,"bk":"bk"+sfx,"bkrear":"bkrear"+sfx,"nah":"nah"+sfx})
    X=R.merge(T,on=["ri","s","b","li"+sfx],how="left")
    X["qpos"+sfx]=X["nah"+sfx]+X["k"+sfx]; X=X.merge(NN,left_on="ri",right_index=True); X["qrel"+sfx]=X["qpos"+sfx]/(X.nn-1)
    return X.drop(columns=["nn","nah"+sfx])
BK=["bk","bkrear","qpos","qrel"]
FCX=FC+BK; F2X=F2+BK+[c+"_1" for c in BK]; F3X=F3+BK+[c+"_1" for c in BK]+[c+"_2" for c in BK]
def trainX(years):
    Lt=LD[LD.year.isin(years)]; Rt=RD[RD.year.isin(years)]; M={}
    M["A"]=gb().fit(Lt[FA],Lt.isS)
    BX=bframe(Lt,Lt[Lt.isS==1].assign(s=lambda d:d.li,pSs=1.0)); M["B"]=gb().fit(BX[FB],BX.isB)
    X=addback(cframe(Rt,sb.assign(p=1.0)),sb); M["W"]=gb().fit(X[FC],X.win); M["WX"]=gb().fit(X[FCX],X.win)
    S=sb[sb.ri.isin(Rt.ri.unique())]
    W1=Rt[[c==fin[r][0] for r,c in zip(Rt.ri,Rt.car)]]; W2=Rt[[c==fin[r][1] for r,c in zip(Rt.ri,Rt.car)]]
    X2=pair(W1,Rt,"_1"); X2["y"]=[int(c==fin[r][1]) for r,c in zip(X2.ri,X2.car)]; M["S2"]=gb().fit(X2[F2],X2.y)
    X2=X2.merge(S,on="ri"); X2=addback(X2,S); X2=addback(X2,S,"_1"); M["S2X"]=gb().fit(X2[F2X],X2.y)
    X3=add2(pair(W1,Rt,"_1").merge(W2[["ri","car","li","k","role","lsize","z","kyaku"]].rename(columns=lambda c:c if c=="ri" else c+"_2"),on="ri"),None)
    X3["y"]=[int(c==fin[r][2]) for r,c in zip(X3.ri,X3.car)]; M["S3"]=gb().fit(X3[F3],X3.y)
    X3=X3.merge(S,on="ri"); X3=addback(X3,S); X3=addback(X3,S,"_1"); X3=addback(X3,S,"_2"); M["S3X"]=gb().fit(X3[F3X],X3.y)
    return M
def scen(M,L):
    L=L.copy(); L["pS"]=M["A"].predict_proba(L[FA])[:,1]; L["pS"]/=L.groupby("ri").pS.transform("sum")
    BB=bframe(L.drop(columns=["pS"]),L.assign(s=L.li,pSs=L.pS)); BB["pB"]=M["B"].predict_proba(BB[FB])[:,1]; BB["pB"]/=BB.groupby(["ri","s"]).pB.transform("sum")
    BB["p"]=BB.pSs*BB.pB; sc=BB[BB.p>=0.003][["ri","s","li","p"]].rename(columns={"li":"b"}); sc["p"]/=sc.groupby("ri").p.transform("sum"); return sc
def predictX(M,ris,mode,K=3,chunk=600):
    """mode: base(今の) / w(1着だけ最終バック) / all(1・2・3着とも最終バック。筋書きの上位 K 個)"""
    out=[]
    for st in range(0,len(ris),chunk):
        rr=ris[st:st+chunk]; L=LD[LD.ri.isin(rr)]; R=RD[RD.ri.isin(rr)]; sc=scen(M,L)
        X=addback(cframe(R,sc),sc); X["w"]=M["WX" if mode!="base" else "W"].predict_proba(X[FCX if mode!="base" else FC])[:,1]
        X["w"]=X.w/X.groupby(["ri","s","b"]).w.transform("sum")
        if mode in ("base","w"):
            X["w"]*=X.p; pw=X.groupby(["ri","car"]).w.sum().rename("pw").reset_index()
            X2=pair(R,R,"_1"); X2["p2"]=M["S2"].predict_proba(X2[F2])[:,1]; X2["p2"]/=X2.groupby(["ri","car_1"]).p2.transform("sum")
            A=X2[["ri","car_1","li_1","car","li","k","role","lsize","z","kyaku","p2"]].rename(columns={"car":"car_2","li":"li_2","k":"k_2","role":"role_2","lsize":"lsize_2","z":"z_2","kyaku":"kyaku_2"})
            X3=add2(pair(R,R,"_1").merge(A,on=["ri","car_1","li_1"]),None); X3["p3"]=M["S3"].predict_proba(X3[F3])[:,1]; X3["p3"]/=X3.groupby(["ri","car_1","car_2"]).p3.transform("sum")
            X3=X3.merge(pw.rename(columns={"car":"car_1"}),on=["ri","car_1"]); X3["P"]=X3.pw*X3.p2*X3.p3
            out.append(X3[["ri","car_1","car_2","car","P"]])
        else:
            top=sc.sort_values(["ri","p"],ascending=[True,False]).groupby("ri").head(K).copy(); top["p"]/=top.groupby("ri").p.transform("sum")
            W=X.merge(top[["ri","s","b"]],on=["ri","s","b"])[["ri","s","b","car","w"]].rename(columns={"car":"car_1"})
            base=R.merge(top[["ri","s","b"]],on="ri")
            X2=pair(base,base[["ri","s","b","car","li","k","role","lsize","z","kyaku","maku","nige"]].rename(columns=lambda c:c if c in("ri","s","b") else c),"_1") if False else None
            # 1着(car_1)と候補(car)の組を筋書きごとに
            C1=base[["ri","s","b","car","li","k","role","lsize","z","kyaku","maku","nige"]].rename(columns=lambda c:c if c in("ri","s","b") else c+"_1")
            X2=base.merge(C1,on=["ri","s","b"]); X2=X2[X2.car!=X2.car_1].copy()
            X2["same_1"]=(X2.li==X2.li_1).astype(int); X2["behind_1"]=((X2.li==X2.li_1)&(X2.k==X2.k_1+1)).astype(int); X2["ahead_1"]=((X2.li==X2.li_1)&(X2.k==X2.k_1-1)).astype(int); X2["dz_1"]=X2.z-X2.z_1
            X2=addback(X2,top); X2=addback(X2,top,"_1")
            X2["p2"]=M["S2X"].predict_proba(X2[F2X])[:,1]; X2["p2"]/=X2.groupby(["ri","s","b","car_1"]).p2.transform("sum")
            A=X2[["ri","s","b","car_1","li_1","k_1","role_1","lsize_1","z_1","kyaku_1","maku_1","nige_1","bk_1","bkrear_1","qpos_1","qrel_1","car","li","k","role","lsize","z","kyaku","bk","bkrear","qpos","qrel","p2"]]
            A=A.rename(columns={"car":"car_2","li":"li_2","k":"k_2","role":"role_2","lsize":"lsize_2","z":"z_2","kyaku":"kyaku_2","bk":"bk_2","bkrear":"bkrear_2","qpos":"qpos_2","qrel":"qrel_2"})
            X3=base.merge(A,on=["ri","s","b"]); X3=X3[(X3.car!=X3.car_1)&(X3.car!=X3.car_2)].copy()
            X3["same_1"]=(X3.li==X3.li_1).astype(int); X3["behind_1"]=((X3.li==X3.li_1)&(X3.k==X3.k_1+1)).astype(int); X3["ahead_1"]=((X3.li==X3.li_1)&(X3.k==X3.k_1-1)).astype(int); X3["dz_1"]=X3.z-X3.z_1
            X3["same_2"]=(X3.li==X3.li_2).astype(int); X3["behind_2"]=((X3.li==X3.li_2)&(X3.k==X3.k_2+1)).astype(int); X3["ahead_2"]=((X3.li==X3.li_2)&(X3.k==X3.k_2-1)).astype(int); X3["dz_2"]=X3.z-X3.z_2; X3["same12"]=(X3.li_1==X3.li_2).astype(int)
            X3=addback(X3,top)
            X3["p3"]=M["S3X"].predict_proba(X3[F3X])[:,1]; X3["p3"]/=X3.groupby(["ri","s","b","car_1","car_2"]).p3.transform("sum")
            X3=X3.merge(W,on=["ri","s","b","car_1"]).merge(top[["ri","s","b","p"]],on=["ri","s","b"])
            X3["P"]=X3.p*X3.w*X3.p2*X3.p3
            out.append(X3.groupby(["ri","car_1","car_2","car"],as_index=False).P.sum())
        print(f"  {mode} {st+len(rr)}/{len(ris)}",flush=True) if (st//chunk)%5==0 else None
    return pd.concat(out).rename(columns={"car_1":"a","car_2":"b","car":"c"})
if __name__=="__main__":
    t0=time.time(); te=sorted(set(RD.ri[RD.year>=2025])); rng=np.random.RandomState(0); samp=sorted(rng.choice(te,8000,replace=False))
    M=trainX([2022,2023,2024]); print(f"学習 {time.time()-t0:.0f}秒",flush=True); pickle.dump(M,open("fb_M.pkl","wb"))
    for mode in ("base","w","all"):
        t1=time.time(); P=predictX(M,samp,mode); P.to_pickle(f"fb_P_{mode}.pkl"); r=score(P)
        print(f"{mode}: 1着{r['win']:.1f}% 3連単{r['tan']:.1f}% 3連複{r['fuku']:.1f}% 対数確率{r['ll']:.3f} ({time.time()-t1:.0f}秒)",flush=True)
