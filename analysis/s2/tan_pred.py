# 2022-24 で作ったモデルで 2025-26 の3連単の確率を出し、レースごとに上位40組だけ残す
import sys, time, pickle, numpy as np, pandas as pd
sys.path.insert(0,".")
from tkcore import *
t0=time.time()
M,_,_=pickle.load(open("base.pkl","rb"))
te=sorted(set(RD.ri[RD.year>=2025])); out=[]
for s in range(0,len(te),3000):
    P,_=predict(M,te[s:s+3000])
    P=P.sort_values(["ri","P"],ascending=[True,False]); P=P.groupby("ri").head(40)
    P["k"]=P.groupby("ri").cumcount()+1; out.append(P)
    print(s,round(time.time()-t0),"秒",flush=True)
P=pd.concat(out); P["id"]=P.ri.map(lambda r:races[r]["id"]); P.to_pickle("tanP.pkl"); print(len(P))
