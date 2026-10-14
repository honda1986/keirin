# モデルDの買い目(期待値1.10以上・20倍以下。その年より前で作ったモデル)を、展開の予想が「その組をオッズより来ると見ているか」で分ける。2025-26
#   展開の比 = 展開の3連複の確率 × 倍率(1より大きい = 展開は市場より来ると見ている)。展開は2022-24 で作ったもの
import sys, json, glob, itertools, pickle, time, numpy as np, pandas as pd
sys.path.insert(0,".")
from tkcore import *
t0=time.time()
M,_,_=pickle.load(open("base.pkl","rb"))
DP=json.load(open("dall_1.05_20.0.json"))
rid={r["id"]:ri for ri,r in enumerate(races)}
picks=[(id_,t,ev,od) for id_,ps in DP.items() if id_>="2025" for t,ev,od in ps if ev>=1.10]
ris=sorted({rid[i] for i,*_ in picks if i in rid})
S={}
for s in range(0,len(ris),3000):
    P,_=predict(M,ris[s:s+3000])
    P["k"]=["=".join(map(str,sorted(t))) for t in zip(P.a.astype(int),P.b.astype(int),P.c.astype(int))]
    for (ri,k),v in P.groupby(["ri","k"]).P.sum().items(): S[(ri,k)]=v
rows=[]
for id_,t,ev,od in picks:
    ri=rid.get(id_)
    if ri is None or (ri,t) not in S: continue
    w="=".join(map(str,sorted(fin[ri])))
    rows.append(dict(y=int(id_[:4]),ev=ev,odds=od,tk=S[(ri,t)]*od,hit=t==w,pay=od*100 if t==w else 0))
D=pd.DataFrame(rows); print(len(D),"点(期待値1.10以上・20倍以下)",round(time.time()-t0),"秒")
D["b"]=pd.cut(D.tk,[0,0.6,0.8,1.0,1.2,9],labels=["〜0.6","0.6〜0.8","0.8〜1.0","1.0〜1.2","1.2〜"])
g=D.groupby(["b","y"],observed=True).apply(lambda x:pd.Series({"点":len(x),"的中%":x.hit.mean()*100,"回収%":x.pay.sum()/len(x)})).unstack("y").round(1)
print("■ 展開の比(展開の確率×倍率)ごと\n",g.to_string())
for lab,s in (("展開も来ると見ている(比1.0以上)",D[D.tk>=1.0]),("展開は来ないと見ている(比1.0未満)",D[D.tk<1.0])):
    print(f"  {lab}: "+" / ".join(f"{y} {len(x)}点 的中{x.hit.mean()*100:.1f}% 回収{x.pay.sum()/len(x):.0f}%" for y,x in s.groupby("y"))+f" / 合計 {len(s)}点 回収{s.pay.sum()/len(s):.0f}%")
print(f"  全部: "+" / ".join(f"{y} {len(x)}点 回収{x.pay.sum()/len(x):.0f}%" for y,x in D.groupby("y")))
print("  展開の比と回収の相関(点ごと):",round(np.corrcoef(D.tk,D.pay)[0,1],3))
