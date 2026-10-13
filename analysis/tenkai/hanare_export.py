# 本番: 「前について行けない確率」を全部の年で学習 → tenkai-model.json に models.D として足す。fixture に期待値を足す
import json, numpy as np, pandas as pd, pickle
from sklearn.ensemble import HistGradientBoostingClassifier as GB
d=pd.read_pickle("hanare.pkl"); _,F=pickle.load(open("hanare_m.pkl","rb"))
m=GB(max_iter=200,learning_rate=0.06,max_leaf_nodes=15,min_samples_leaf=100,l2_regularization=1.0,random_state=0).fit(d[F],d.y)
exec(open("tk_export.py").read().split("def dump")[1].join(["def dump",""]) if False else "")
def dump(m,feats):
    trees=[]
    for it in m._predictors:
        nd=it[0].nodes
        trees.append({"f":[(-1 if lf else int(fi)) for fi,lf in zip(nd["feature_idx"],nd["is_leaf"])],"t":[float(x) if not lf else 0 for x,lf in zip(nd["num_threshold"],nd["is_leaf"])],
          "l":[int(x) for x in nd["left"]],"r":[int(x) for x in nd["right"]],"m":[int(x) for x in nd["missing_go_to_left"]],"v":[round(float(x),7) if lf else 0 for x,lf in zip(nd["value"],nd["is_leaf"])]})
    return {"feats":feats,"base":float(np.ravel(m._baseline_prediction)[0]),"trees":trees}
J=json.load(open("../../tenkai-model.json")); J["models"]["D"]=dump(m,F); J["version"]="T-2026-10b"
J["note"]+=" / D: ラインで前の選手について行けない(離れる)確率(勝敗因が全員にあるレースの「離れ」「千切れ」「続けず」等で学習)"
open("../../tenkai-model.json","w").write(json.dumps(J,separators=(",",":"),ensure_ascii=False))
# fixture に 追走者ごとの期待値
def style(nige,maku):
    J_=nige+maku; return 3 if J_<=2 else (0 if nige/J_>=0.6 else (2 if nige/J_<=0.4 else 1))
fx=json.load(open("../../test/tenkai_fixture.json"))
for x in fx:
    r=x["input"]; R={int(k):v for k,v in r["R"].items()}; L=r["lines"]
    sc=np.array([R[c][7] for c in R],float); mm,sd=sc.mean(),(sc.std() or 1); z=lambda c:(R[c][7]-mm)/sd
    out={}
    for i,ln in enumerate(L):
        if len(ln)<2: continue
        h=R[ln[0]]
        for k in range(1,len(ln)):
            f=ln[k]; fr=ln[k-1]; q=R[f]; p=R[fr]
            row={"k":k,"size":len(ln),"pos":i,"nl":len(L),"n":r["n"],"bank":r["bank"],"ks":int(r["klass"]=="s"),
              "f_kyaku":{"逃":0,"両":1,"追":2}.get(q[0],1),"f_mark":q[4],"f_sashi":q[3],"f_nige":q[1],"f_maku":q[2],"f_S":q[5],"f_B":q[6],"f_z":z(f),"f_rank":q[8],"f_san":q[9] or 0,"f_age":q[10],
              "p_kyaku":{"逃":0,"両":1,"追":2}.get(p[0],1),"p_nige":p[1],"p_maku":p[2],"p_B":p[6],"p_z":z(fr),"p_age":p[10],"p_style":style(p[1],p[2]),
              "h_style":style(h[1],h[2]),"h_nige":h[1],"h_maku":h[2],"h_B":h[6],"h_z":z(ln[0]),"h_age":h[10],"dz":z(f)-z(fr),"dage":q[10]-p[10]}
            out[str(f)]=float(m.predict_proba(pd.DataFrame([row])[F])[:,1][0])
    x["det"]=out
json.dump(fx,open("../../test/tenkai_fixture.json","w"),ensure_ascii=False)
print("D 追加",len(J["models"]["D"]["trees"]),"本 / 特徴",F)
