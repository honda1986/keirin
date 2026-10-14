# 2着|1着 のモデルを作り直す実験。本当の1着を条件に、2022-24 で作り 2025-26 で 1番手の当たりと対数確率を測る
import sys, time, pickle, numpy as np, pandas as pd
sys.path.insert(0,".")
from tkcore import *
t0=time.time()
M,PW,P2=pickle.load(open("base.pkl","rb"))
gbm=lambda **kw: GB(random_state=0,l2_regularization=1.0,min_samples_leaf=100,**{**dict(max_iter=150,learning_rate=0.1,max_leaf_nodes=15),**kw})
def extra(X):
    """場面に依らない追加の特徴(候補が1着を除いた中で何番目に強いか など)"""
    g=X.groupby(["ri","car_1"])
    X["rk_o"]=g["rank"].rank(method="first"); X["z_o"]=g.z.rank(ascending=False,method="first")
    X["dli"]=X.li-X.li_1                                  # 1着のラインから見た位置(並びの前後)
    X["head"]=(X.role==0).astype(int)
    lz=RD.groupby(["ri","li"]).z.apply(lambda s:s.head(3).mean()).rename("lz").reset_index()
    X=X.merge(lz,on=["ri","li"],how="left")
    X["lz_r"]=X.groupby(["ri","car_1"]).lz.rank(ascending=False,method="dense")   # 候補のラインの強さの順位
    return X
FX=["rk_o","z_o","dli","head","lz","lz_r"]
def scen(X):
    """場面(S=スタートを取ったライン s・B=最終バック先頭のライン b)の特徴"""
    X=X.merge(LA.rename(columns={"li":"b","pos":"B_pos","size":"B_size","style":"B_style","h_z":"B_hz"}),on=["ri","b"])
    X["inS"]=(X.li==X.s).astype(int); X["inB"]=(X.li==X.b).astype(int); X["w_inS"]=(X.li_1==X.s).astype(int); X["w_inB"]=(X.li_1==X.b).astype(int)
    X["tsup"]=(X.s==X.b).astype(int); X["relB"]=X.lpos-X.B_pos; X["w_relB"]=X.li_1-X.B_pos
    return X
FS=["inS","inB","w_inS","w_inB","tsup","relB","w_relB","B_size","B_style"]
tr_ri=set(RD.ri[RD.year<=2024]); te_ri=sorted(set(RD.ri[RD.year>=2025]))
def table(ris):
    R=RD[RD.ri.isin(ris)]
    W1=R[[c==fin[r][0] for r,c in zip(R.ri,R.car)]]
    X=pair(W1,R,"_1"); X["y"]=[int(c==fin[r][1]) for r,c in zip(X.ri,X.car)]
    return extra(X.reset_index(drop=True))
TR=table(tr_ri); TE=table(te_ri); print("表",len(TR),len(TE),round(time.time()-t0),"秒",flush=True)
def evalp(T,p,label):
    T=T.assign(p=p); T["p"]=T.p/T.groupby("ri").p.transform("sum")
    top=T.loc[T.groupby("ri").p.idxmax()]; acc=top.y.mean()*100
    ll=np.log(np.clip(T[T.y==1].p,1e-9,1)).mean()
    print(f"  {label}: 1番手で当たる {acc:.1f}%  対数確率 {ll:.4f}",flush=True); return acc
# 1) いまの特徴
m=gbm().fit(TR[F2],TR.y); evalp(TE,m.predict_proba(TE[F2])[:,1],"いまの特徴")
# 2) +強さの順位など
m=gbm().fit(TR[F2+FX],TR.y); evalp(TE,m.predict_proba(TE[F2+FX])[:,1],"+強さの順位・ラインの強さ")
# 3) +場面(学習は本当の s,b)
TRs=scen(TR.merge(sb,on="ri")); ms=gbm().fit(TRs[F2+FX+FS],TRs.y)
TEo=scen(TE.merge(sb,on="ri")); evalp(TEo,ms.predict_proba(TEo[F2+FX+FS])[:,1],"+場面(本当の場面を知っていれば・上限)")
# 4) 場面を予想で混ぜる: P(s,b|1着) ∝ P(s,b)・P(1着|s,b)
post=[]
for s in range(0,len(te_ri),3000):
    rr=te_ri[s:s+3000]; L=LD[LD.ri.isin(rr)].copy(); R=RD[RD.ri.isin(rr)]
    L["pS"]=M["A"].predict_proba(L[FA])[:,1]; L["pS"]/=L.groupby("ri").pS.transform("sum")
    BB=bframe(L.drop(columns=["pS"]),L.assign(s=L.li,pSs=L.pS)); BB["pB"]=M["B"].predict_proba(BB[FB])[:,1]; BB["pB"]/=BB.groupby(["ri","s"]).pB.transform("sum")
    BB["p"]=BB.pSs*BB.pB; sc=BB[BB.p>=0.003][["ri","s","li","p"]].rename(columns={"li":"b"}); sc["p"]/=sc.groupby("ri").p.transform("sum")
    X=cframe(R,sc); X["w"]=M["W"].predict_proba(X[FC])[:,1]; X["w"]=X.w/X.groupby(["ri","s","b"]).w.transform("sum")*X.p
    X=X[[c==fin[r][0] for r,c in zip(X.ri,X.car)]][["ri","s","b","w"]]; X["q"]=X.w/X.groupby("ri").w.transform("sum"); post.append(X[["ri","s","b","q"]])
post=pd.concat(post)
TEm=scen(TE.merge(post,on="ri")); TEm["ps"]=ms.predict_proba(TEm[F2+FX+FS])[:,1]; TEm["ps"]/=TEm.groupby(["ri","s","b"]).ps.transform("sum")
mix=(TEm.ps*TEm.q).groupby([TEm.ri,TEm.car]).sum().rename("pm").reset_index()
TEx=TE.merge(mix,on=["ri","car"]); evalp(TEx,TEx.pm,"+場面(予想した場面で混ぜる)")
pickle.dump((TR,TE,post),open("exp.pkl","wb"))
print(round(time.time()-t0),"秒")
