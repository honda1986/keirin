import time, numpy as np
from tkcore import *
te=sorted(set(RD.ri[RD.year>=2025])); rng=np.random.RandomState(0); samp=sorted(rng.choice(te,8000,replace=False))
for name,params in [("大きめ(300回・31葉)",dict(max_iter=300,learning_rate=0.06,max_leaf_nodes=31)),("小さめ(150回・15葉)",dict(max_iter=150,learning_rate=0.1,max_leaf_nodes=15)),("もっと小さめ(100回・15葉)",dict(max_iter=100,learning_rate=0.12,max_leaf_nodes=15))]:
    t0=time.time(); M=train([2022,2023,2024],params); P,_=predict(M,samp); r=score(P)
    nodes=sum(sum(len(t[0].nodes) for t in m._predictors) for m in M.values())
    print(f"{name}: 1着{r['win']:.1f}% 3連単{r['tan']:.1f}% 3連複{r['fuku']:.1f}% 対数確率{r['ll']:.3f}  木の節 {nodes:,}  {time.time()-t0:.0f}秒",flush=True)
