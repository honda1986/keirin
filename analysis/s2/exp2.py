# 選手の数字(勝率・2連対率・着の回数など)を足すと 2着|1着 は良くなるか
import sys, time, json, pickle, numpy as np, pandas as pd
sys.path.insert(0,".")
from tkcore import *
t0=time.time()
TR,TE,post=pickle.load(open("exp.pkl","rb"))
EX=json.load(open("extra.json"))
GR={"SS":0,"S1":1,"S2":2,"A1":3,"A2":4,"A3":5,"L1":6}
rows=[]
for ri,r in enumerate(races):
    e=EX.get(r["id"]);
    if not e: continue
    for c,v in e.items():
        tot=v[2]+v[3]+v[4]+v[5]
        rows.append((ri,int(c),v[0],v[1],v[2]/tot if tot else np.nan,v[3]/tot if tot else np.nan,(v[2]+v[3])/tot if tot else np.nan,v[6],v[7],GR.get(v[8],np.nan),tot))
X=pd.DataFrame(rows,columns=["ri","car","wr","nr","s1","s2","s12","H","gear","gr","tot"])
print("選手の数字",len(X),round(time.time()-t0),"秒",flush=True)
FE=["wr","nr","s1","s2","s12","H","gear","gr"]
def addx(T):
    T=T.merge(X[["ri","car"]+FE],on=["ri","car"],how="left")
    T=T.merge(X[["ri","car","wr","nr","s2","H","gr"]].rename(columns=lambda c:c if c=="ri" else c+"_1"),on=["ri","car_1"],how="left")
    g=T.groupby(["ri","car_1"])
    T["nr_o"]=g.nr.rank(ascending=False,method="first"); T["s2_o"]=g.s2.rank(ascending=False,method="first")
    T["dnr_1"]=T.nr-T.nr_1
    return T
TR=addx(TR); TE=addx(TE)
FN=FE+["wr_1","nr_1","s2_1","H_1","gr_1","nr_o","s2_o","dnr_1"]
FX=["rk_o","z_o","dli","head","lz","lz_r"]
def evalp(T,p,label):
    T=T.assign(p=p); T["p"]=T.p/T.groupby("ri").p.transform("sum")
    top=T.loc[T.groupby("ri").p.idxmax()]; acc=top.y.mean()*100
    ll=np.log(np.clip(T[T.y==1].p,1e-9,1)).mean()
    print(f"  {label}: 1番手で当たる {acc:.1f}%  対数確率 {ll:.4f}  {round(time.time()-t0)}秒",flush=True)
gbm=lambda **kw: GB(random_state=0,l2_regularization=1.0,min_samples_leaf=100,**{**dict(max_iter=150,learning_rate=0.1,max_leaf_nodes=15),**kw})
m=gbm().fit(TR[F2],TR.y); evalp(TE,m.predict_proba(TE[F2])[:,1],"いまの特徴")
m=gbm().fit(TR[F2+FN],TR.y); evalp(TE,m.predict_proba(TE[F2+FN])[:,1],"+選手の数字")
m=gbm().fit(TR[F2+FN+FX],TR.y); evalp(TE,m.predict_proba(TE[F2+FN+FX])[:,1],"+選手の数字+強さの順位")
m=gbm(max_iter=400,learning_rate=0.05,max_leaf_nodes=31).fit(TR[F2+FN+FX],TR.y); evalp(TE,m.predict_proba(TE[F2+FN+FX])[:,1],"同じ・大きい木")
pickle.dump(X,open("exX.pkl","wb"))
