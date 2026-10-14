# 3着|1・2着 のモデルに特徴を足す(2022-24 で作り 2025-26 で試す。本当の1・2着を条件に)
import sys, json, glob, itertools, pickle, time, numpy as np, pandas as pd
sys.path.insert(0,".")
from tkcore import *
t0=time.time()
def table(ris):
    R=RD[RD.ri.isin(ris)]
    W1=R[[c==fin[r][0] for r,c in zip(R.ri,R.car)]]; W2=R[[c==fin[r][1] for r,c in zip(R.ri,R.car)]]
    X=add2(pair(W1,R,"_1").merge(W2[["ri","car","li","k","role","lsize","z","kyaku"]].rename(columns=lambda c:c if c=="ri" else c+"_2"),on="ri"),None)
    X["y"]=[int(c==fin[r][2]) for r,c in zip(X.ri,X.car)]
    return X.reset_index(drop=True)
TR=table(set(RD.ri[RD.year<=2024])); TE=table(set(RD.ri[RD.year>=2025]))
print("表",len(TR),len(TE),round(time.time()-t0),"秒",flush=True)
# 離れる確率(年ごと交差): 自分 / すぐ前の選手 / 1・2着と同じラインで1・2着より後ろにいるか
A=pd.read_pickle("hanare_all.pkl")[["ri","car","pdet"]]
EX=json.load(open("extra.json"))
ex=[]
for ri,r in enumerate(races):
    e=EX.get(r["id"])
    if not e: continue
    for c,v in e.items():
        tot=v[2]+v[3]+v[4]+v[5]
        ex.append((ri,int(c),v[0],v[1],v[4]/tot if tot else np.nan,v[5]/tot if tot else np.nan,(v[2]+v[3]+v[4])/tot if tot else np.nan))
EXD=pd.DataFrame(ex,columns=["ri","car","wr","nr","s3","sout","s123"])
def addf(X):
    X=X.merge(A,on=["ri","car"],how="left"); X["pdet"]=X.pdet.fillna(0)
    X=X.merge(EXD,on=["ri","car"],how="left")
    g=X.groupby("ri")
    X["rk_o"]=g["rank"].rank(method="first"); X["z_o"]=g.z.rank(ascending=False,method="first"); X["s3_o"]=g.s3.rank(ascending=False,method="first")
    # 1・2着と同じラインで、その2人より後ろの最初の選手か(ライン決着の3人目)
    X["after12"]=(((X.same_1==1)&(X.k>X.k_1))|((X.same_2==1)&(X.k>X.k_2))).astype(int)
    X["next12"]=(X.after12==1)&(X.groupby(["ri","li"]).k.transform("min")==X.k) if False else X.after12
    X["lz"]=X.groupby(["ri","li"]).z.transform("mean"); X["lz_o"]=X.groupby("ri").lz.rank(ascending=False,method="dense")
    X["l_has12"]=((X.same_1==1)|(X.same_2==1)).astype(int)
    return X
TR=addf(TR); TE=addf(TE); print("特徴",round(time.time()-t0),"秒",flush=True)
gbm=lambda **kw: GB(random_state=0,l2_regularization=1.0,min_samples_leaf=100,**{**dict(max_iter=150,learning_rate=0.1,max_leaf_nodes=15),**kw})
def ev(cols,label,big=False):
    m=(gbm(max_iter=400,learning_rate=0.05,max_leaf_nodes=31) if big else gbm()).fit(TR[cols],TR.y)
    p=m.predict_proba(TE[cols])[:,1]; T=TE.assign(p=p); T["p"]=T.p/T.groupby("ri").p.transform("sum")
    top=T.loc[T.groupby("ri").p.idxmax()]
    print(f"  {label:<28} 1番手 {top.y.mean()*100:.2f}%  対数確率 {np.log(T[T.y==1].p).mean():.4f}  {round(time.time()-t0)}秒",flush=True)
    return T.p.values
DET=["pdet"]; STAT=["wr","nr","s3","sout","s123","s3_o"]; REL=["rk_o","z_o","after12","lz","lz_o","l_has12"]
p0=ev(F3,"いまの特徴")
ev(F3+DET,"+離れる確率")
ev(F3+STAT,"+選手の数字(3着率など)")
ev(F3+REL,"+強さの順位・ライン")
pall=ev(F3+DET+STAT+REL,"+全部")
ev(F3+DET+STAT+REL,"+全部・大きい木",big=True)
pickle.dump((TE[["ri","car","y"]].assign(p0=p0,p1=pall)),open("s3b.pkl","wb"))
