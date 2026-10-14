# 2着の当たり方: いまのモデルと簡単な決め方を比べる
import pickle, numpy as np, pandas as pd, sys
sys.path.insert(0,".")
races,LD,RD=pickle.load(open("tk_data.pkl","rb"))
M,PW,P2=pickle.load(open("base.pkl","rb")); PW=PW.reset_index(drop=True); P2=P2.reset_index(drop=True)
fin={ri:[q[0] for q in r["fin"][:3]] for ri,r in enumerate(races)}
kim={ri:r["fin"][0][1] for ri,r in enumerate(races)}
te=sorted(PW.ri.unique()); n=len(te)
# 1着予想
w1=PW.loc[PW.groupby("ri").pw.idxmax()].set_index("ri").car
acc1=np.mean([w1[r]==fin[r][0] for r in te])
# 2着(本当の1着を知っているとき)
P2["t1"]=P2.ri.map(lambda r:fin[r][0]); P2["t2"]=P2.ri.map(lambda r:fin[r][1])
C=P2[P2.car_1==P2.t1].copy()
top=C.loc[C.groupby("ri").p2.idxmax()].set_index("ri")
acc2c=(top.car==top.t2).mean()
# 2着の確率の順位(本当の2着が何番目か)
C["rk"]=C.groupby("ri").p2.rank(ascending=False,method="first")
r2=C[C.car==C.t2].rk
# 何も知らないとき: 2着の周辺確率と2連単
J=P2.merge(PW.rename(columns={"car":"car_1"}),on=["ri","car_1"]); J["pj"]=J.pw*J.p2
m2=J.groupby(["ri","car"]).pj.sum().reset_index(); m2top=m2.loc[m2.groupby("ri").pj.idxmax()].set_index("ri").car
acc2m=np.mean([m2top[r]==fin[r][1] for r in te])
ex=J.loc[J.groupby("ri").pj.idxmax()].set_index("ri")
accex=np.mean([(ex.car_1[r],ex.car[r])==(fin[r][0],fin[r][1]) for r in te])
acc2ex=np.mean([ex.car[r]==fin[r][1] for r in te])
print(f"レース {n}  1着 {acc1*100:.1f}%")
print(f"2着(本当の1着を知っていれば) 1番手で当たる {acc2c*100:.1f}%  2番手まで {(r2<=2).mean()*100:.1f}%  3番手まで {(r2<=3).mean()*100:.1f}%")
print(f"2着(何も知らない) 2着率いちばん {acc2m*100:.1f}% / 2連単1点の2着 {acc2ex*100:.1f}% / 2連単1点 {accex*100:.1f}%")
# 簡単な決め方(本当の1着を知っているとき)
R=RD[RD.ri.isin(te)].copy(); R["k"]=R.groupby(["ri","li"]).cumcount()
R["t1"]=R.ri.map(lambda r:fin[r][0]); R["t2"]=R.ri.map(lambda r:fin[r][1])
W=R[R.car==R.t1][["ri","li","k","role","lsize"]].rename(columns={"li":"wl","k":"wk","role":"wrole","lsize":"wls"})
O=R[R.car!=R.t1].merge(W,on="ri")
def acc(sel):
    g=O.assign(s=sel(O)).sort_values(["ri","s"],ascending=[True,False]).groupby("ri").head(1)
    return (g.car==g.t2).mean()*100
print("比べる決め方(本当の1着を知っていれば):")
print(f"  評価順位がいちばん上 {acc(lambda d:-d['rank']):.1f}%")
print(f"  競走得点がいちばん上 {acc(lambda d:d.z):.1f}%")
print(f"  1着のすぐ後ろ(居れば)→評価順位 {acc(lambda d:((d.li==d.wl)&(d.k==d.wk+1))*100-d['rank']):.1f}%")
print(f"  1着と同じライン(近い順)→評価順位 {acc(lambda d:(d.li==d.wl)*(100-abs(d.k-d.wk)*10)-d['rank']):.1f}%")
# 実際の2着は1着とどんな関係か
T=O[O.car==O.t2]
rel=np.select([(T.li==T.wl)&(T.k==T.wk+1),(T.li==T.wl)&(T.k==T.wk-1),(T.li==T.wl)],["1着のすぐ後ろ","1着のすぐ前","1着と同じライン(離れた位置)"],"別のライン")
print("実際の2着と1着の関係:",pd.Series(rel).value_counts(normalize=True).mul(100).round(1).to_dict())
# モデルの1番手は?
TT=top.reset_index().merge(R[["ri","car","li","k"]],on=["ri","car"]).merge(W,on="ri")
rel2=np.select([(TT.li==TT.wl)&(TT.k==TT.wk+1),(TT.li==TT.wl)&(TT.k==TT.wk-1),(TT.li==TT.wl)],["1着のすぐ後ろ","1着のすぐ前","1着と同じライン(離れた位置)"],"別のライン")
print("モデルの2着1番手と1着の関係:",pd.Series(rel2).value_counts(normalize=True).mul(100).round(1).to_dict())
# 1着の決まり手・役割ごと
top2=top.reset_index(); top2["hit"]=top2.car==top2.t2; top2["kim"]=top2.ri.map(kim)
top2=top2.merge(W[["ri","wrole","wls"]],on="ri")
print(top2.groupby("kim").hit.agg(["size","mean"]).assign(mean=lambda d:(d["mean"]*100).round(1)).sort_values("size",ascending=False).head(6).to_string())
print(top2.groupby("wrole").hit.agg(["size","mean"]).assign(mean=lambda d:(d["mean"]*100).round(1)).to_string())
