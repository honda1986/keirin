# 本番: 2022〜2026年9月の全部で学習 → 木を JSON に(tenkai.js が読む)・突き合わせ用の fixture
import json, time, numpy as np
from tkcore import *
t0=time.time()
PARAMS=dict(max_iter=150,learning_rate=0.1,max_leaf_nodes=15)
M=train(sorted(set(RD.year)),PARAMS); print("学習",round(time.time()-t0),"秒",flush=True)
FEATS={"A":FA,"B":FB,"W":FC,"S2":F2,"S3":F3}
def dump(m,feats):
    trees=[]
    for it in m._predictors:
        nd=it[0].nodes
        f=[(-1 if lf else int(fi)) for fi,lf in zip(nd["feature_idx"],nd["is_leaf"])]
        trees.append({"f":f,"t":[float(x) if not lf else 0 for x,lf in zip(nd["num_threshold"],nd["is_leaf"])],
          "l":[int(x) for x in nd["left"]],"r":[int(x) for x in nd["right"]],"m":[int(x) for x in nd["missing_go_to_left"]],
          "v":[round(float(x),7) if lf else 0 for x,lf in zip(nd["value"],nd["is_leaf"])]})
        assert not any(nd["is_categorical"])
    return {"feats":feats,"base":float(np.ravel(m._baseline_prediction)[0]),"trees":trees}
J={"version":"T-2026-10a","note":"展開(前受け→主導権→1着)と順番予想(2着|1着・3着|1・2着)。2022〜2026年9月で学習。analysis/tenkai・hikitsugi §4-24","prune":0.003,
   "models":{k:dump(M[k],FEATS[k]) for k in M}}
s=json.dumps(J,separators=(",",":"),ensure_ascii=False); open("tenkai-model.json","w").write(s); print("JSON",len(s)//1024,"KB")
# 木の計算が sklearn と一致するか(Python で)
def tree_raw(md,X):
    out=np.full(len(X),md["base"])
    for t in md["trees"]:
        for i,x in enumerate(X):
            n=0
            while t["f"][n]>=0:
                v=x[t["f"][n]]
                n=(t["l"][n] if t["m"][n] else t["r"][n]) if np.isnan(v) else (t["l"][n] if v<=t["t"][n] else t["r"][n])
            out[i]+=t["v"][n]
    return 1/(1+np.exp(-out))
L=LD[LD.year==2026].head(200); md=J["models"]["A"]
d=np.abs(tree_raw(md,L[FA].values.astype(float))-M["A"].predict_proba(L[FA])[:,1]).max(); print("木の計算の差(A)",d)
# fixture: 2025-26 から色々な形のレースを40
te=[ri for ri in sorted(set(RD.ri[RD.year>=2025]))]
rng=np.random.RandomState(1); pick=list(rng.choice(te,36,replace=False))
pick+= [ri for ri in te if len(races[ri]["seri"])>0][:2] + [ri for ri in te if races[ri]["n"]==9][:2]
P,PW=predict(M,sorted(pick))
fx=[]
for ri in sorted(pick):
    r=races[ri]; g=P[P.ri==ri].sort_values("P",ascending=False)
    fx.append({"id":r["id"],"input":{"n":r["n"],"bank":r["bank"],"klass":r["klass"],"seri":r["seri"],"lines":r["lines"],"R":r["R"]},
      "pw":{str(int(c)):float(w) for c,w in zip(PW[PW.ri==ri].car,PW[PW.ri==ri].pw)},
      "top":[[int(a),int(b),int(c),float(p)] for a,b,c,p in g[["a","b","c","P"]].head(10).values]})
json.dump(fx,open("tenkai_fixture.json","w"),ensure_ascii=False); print("fixture",len(fx),round(time.time()-t0),"秒")
