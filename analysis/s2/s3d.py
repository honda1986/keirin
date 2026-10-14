# 3着|1・2着 に市場(3連複の確定オッズ)を混ぜる: p ∝ p_モデル × q_市場^β。β は2025年で決めて2026年で測る
import json, glob, itertools, pickle, numpy as np, pandas as pd
races,LD,RD=pickle.load(open("tk_data.pkl","rb"))
TE=pickle.load(open("s3te.pkl","rb")); fin={ri:[q[0] for q in r["fin"][:3]] for ri,r in enumerate(races)}
O3={}
for f in sorted(glob.glob("../../odds-202[56]*.json")): O3.update(json.load(open(f))["races"])
R=[]
for ri,g in TE.groupby("ri"):
    r=races[ri]; n=r["n"]; o=O3.get(r["id"]); cs=list(itertools.combinations(range(1,n+1),3))
    if not o or len(o["o"])!=len(cs): continue
    q=dict(zip(cs,o["o"])); a,b=fin[ri][0],fin[ri][1]
    qq=np.array([1/q[tuple(sorted((a,b,c)))] if q[tuple(sorted((a,b,c)))] and q[tuple(sorted((a,b,c)))]<9999 else 1e-6 for c in g.car])
    if g.y.sum()==1: R.append((r["year"],g.p.values,qq/qq.sum(),g.y.values))
def run(beta,al,rows):
    h=0; ll=0
    for y,p,q,t in rows:
        v=p**al*q**beta; v=v/v.sum(); h+=t[v.argmax()]; ll+=np.log(max(v[t==1][0],1e-9))
    return h/len(rows)*100, ll/len(rows)
r25=[x for x in R if x[0]==2025]; r26=[x for x in R if x[0]==2026]
print("2026 モデルだけ: 1番手 %.1f%% 対数 %.4f"%run(0,1,r26)); print("2026 市場だけ: 1番手 %.1f%% 対数 %.4f"%run(1,0,r26))
best=max(((b,a) for b in (0.3,0.5,0.7,1.0) for a in (0.5,0.7,1.0)),key=lambda t:run(t[0],t[1],r25)[1])
print("混ぜる(β=%.1f・モデル^%.1f を2025で決めた) 2026: 1番手 %.1f%% 対数 %.4f"%(best[0],best[1],*run(best[0],best[1],r26)))
