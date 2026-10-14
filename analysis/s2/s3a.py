# 3着の当たり方: 本当の1・2着を知っているとき(S3だけの力)、簡単な決め方、市場(3連複のオッズ)、外れ方の内訳
import sys, json, glob, itertools, pickle, time, numpy as np, pandas as pd
sys.path.insert(0,".")
from tkcore import *
t0=time.time()
M,_,_=pickle.load(open("base.pkl","rb"))
def table(ris):
    R=RD[RD.ri.isin(ris)]
    W1=R[[c==fin[r][0] for r,c in zip(R.ri,R.car)]]; W2=R[[c==fin[r][1] for r,c in zip(R.ri,R.car)]]
    X=add2(pair(W1,R,"_1").merge(W2[["ri","car","li","k","role","lsize","z","kyaku"]].rename(columns=lambda c:c if c=="ri" else c+"_2"),on="ri"),None)
    X["y"]=[int(c==fin[r][2]) for r,c in zip(X.ri,X.car)]
    return X.reset_index(drop=True)
te=sorted(set(RD.ri[RD.year>=2025])); TE=table(te)
TE["p"]=M["S3"].predict_proba(TE[F3])[:,1]; TE["p"]/=TE.groupby("ri").p.transform("sum")
top=TE.loc[TE.groupby("ri").p.idxmax()]
TE["rk"]=TE.groupby("ri").p.rank(ascending=False,method="first"); r3=TE[TE.y==1].rk
print(f"{TE.ri.nunique()}R  3着(本当の1・2着を知っていれば): 1番手 {top.y.mean()*100:.1f}% / 2番手まで {(r3<=2).mean()*100:.1f}% / 3番手まで {(r3<=3).mean()*100:.1f}%  対数確率 {np.log(TE[TE.y==1].p).mean():.4f}")
# 簡単な決め方
def acc(score):
    g=TE.assign(s=score).sort_values(["ri","s"],ascending=[True,False]).groupby("ri").head(1); return g.y.mean()*100
print(f"  評価順位がいちばん上 {acc(-TE['rank']):.1f}% / 得点いちばん上 {acc(TE.z):.1f}%")
nxt=((TE.same_2==1)&(TE.behind_2==1))|((TE.same_1==1)&(TE.behind_1==1)&(TE.same12==0))
print(f"  2着(か1着)のすぐ後ろ→評価順位 {acc(nxt*100-TE['rank']):.1f}% / 1・2着と同じライン(近い順)→評価順位 {acc(((TE.same_1==1)|(TE.same_2==1))*100-TE['rank']):.1f}%")
# 市場: 3連複のオッズで、1・2着を知ったときの3着
O3={}
for f in sorted(glob.glob("../../odds-202[56]*.json")): O3.update(json.load(open(f))["races"])
mk=[];mll=[];mdl=[];both=[]
for ri,g in TE.groupby("ri"):
    r=races[ri]; o=O3.get(r["id"]); n=r["n"]
    cs=list(itertools.combinations(range(1,n+1),3))
    if not o or len(o["o"])!=len(cs): continue
    q=dict(zip(cs,o["o"])); a,b=fin[ri][0],fin[ri][1]
    v={c:(1/q[tuple(sorted((a,b,c)))] if q[tuple(sorted((a,b,c)))] and q[tuple(sorted((a,b,c)))]<9999 else 0) for c in g.car}
    s=sum(v.values()) or 1; t=fin[ri][2]
    mk.append(max(v,key=v.get)==t); mll.append(np.log(max(v.get(t,0)/s,1e-9)))
    mdl.append(g.loc[g.p.idxmax()].car==t); both.append(ri)
print(f"  市場(3連複)で同じレース {len(mk)}R: 1番手 市場 {np.mean(mk)*100:.1f}% / モデル {np.mean(mdl)*100:.1f}%  対数確率 市場 {np.mean(mll):.4f}")
# 実際の3着は1・2着とどんな関係か / モデルの1番手は
def rel(d):
    return np.select([(d.same_2==1)&(d.behind_2==1),(d.same_1==1)&(d.behind_1==1),(d.same_1==1)|(d.same_2==1),d.role==3,d.role==0],
                     ["2着のすぐ後ろ","1着のすぐ後ろ","1・2着と同じライン(ほか)","単騎","別のラインの先頭"],"別のラインの番手以降")
print("  実際の3着:",pd.Series(rel(TE[TE.y==1])).value_counts(normalize=True).mul(100).round(1).to_dict())
print("  モデルの1番手:",pd.Series(rel(top)).value_counts(normalize=True).mul(100).round(1).to_dict())
# 1・2着の形ごとの当たり
TE["形"]=np.where(TE.same12==1,"1・2着が同じライン","1・2着が別のライン")
tp=TE.loc[TE.groupby("ri").p.idxmax()]
for k,g in tp.groupby("形"):
    tt=TE[(TE["形"]==k)&(TE.y==1)]
    print(f"  {k} {len(g)}R: モデル1番手 {g.y.mean()*100:.1f}% / 実際の3着 "+str(pd.Series(rel(tt)).value_counts(normalize=True).mul(100).round(1).to_dict()))
pickle.dump(TE,open("s3te.pkl","wb")); print(round(time.time()-t0),"秒")
