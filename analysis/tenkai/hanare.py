# 「ラインで前について行けない(離れる)」確率: 勝敗因が全員に付いているレースで、番手・3番手…が離れたか
import json, re, numpy as np, pandas as pd, pickle
from sklearn.ensemble import HistGradientBoostingClassifier as GB
from sklearn.metrics import roc_auc_score
DET=re.compile(r"離れ|離気|千切れ|続けず|追えず|連結")
NOT=re.compile(r"前が離れ|前離れ一緒|捲り千切|カマシ千切|千切る")     # 前の選手が離れた・自分が千切った
def style(nige,maku):
    J=nige+maku; return 3 if J<=2 else (0 if nige/J>=0.6 else (2 if nige/J<=0.4 else 1))
rows=[]
for l in open("tenkai.jsonl"):
    r=json.loads(l); cm={q[0]:q[2].strip() for q in r["fin"]}
    if not cm or not all(cm.values()): continue
    R={int(k):v for k,v in r["R"].items()}; L=r["lines"]
    if any(c not in cm for x in L for c in x): continue
    sc=np.array([R[c][7] for c in R],float); m,sd=sc.mean(),(sc.std() or 1); z=lambda c:(R[c][7]-m)/sd
    top3=[q[0] for q in r["fin"][:3]]
    for i,x in enumerate(L):
        if len(x)<2: continue
        h=R[x[0]]
        for k in range(1,len(x)):
            f=x[k]; fr=x[k-1]; q=R[f]; p=R[fr]; c=cm[f]
            rows.append({"id":r["id"],"year":r["year"],"y":int(bool(DET.search(c)) and not NOT.search(c)),"top3":int(f in top3),
              "k":k,"size":len(x),"pos":i,"nl":len(L),"n":r["n"],"bank":r["bank"],"ks":int(r["klass"]=="s"),
              "f_kyaku":{"逃":0,"両":1,"追":2}.get(q[0],1),"f_mark":q[4],"f_sashi":q[3],"f_nige":q[1],"f_maku":q[2],"f_S":q[5],"f_B":q[6],"f_z":z(f),"f_rank":q[8],"f_san":q[9] or 0,"f_age":q[10],
              "p_kyaku":{"逃":0,"両":1,"追":2}.get(p[0],1),"p_nige":p[1],"p_maku":p[2],"p_B":p[6],"p_z":z(fr),"p_age":p[10],"p_style":style(p[1],p[2]),
              "h_style":style(h[1],h[2]),"h_nige":h[1],"h_maku":h[2],"h_B":h[6],"h_z":z(x[0]),"h_age":h[10],
              "dz":z(f)-z(fr),"dage":q[10]-p[10],"comment":c})
d=pd.DataFrame(rows); d.to_pickle("hanare.pkl")
print("勝敗因が全員にあるレースのライン追走者",len(d),"離れた",round(d.y.mean()*100,1),"%")
pc=lambda s:(s.mean()*100).round(1)
def tb(name,key):
    g=d.groupby(key).agg(人=("y","size"),離れた=("y","mean"),三着内=("top3","mean")); g[["離れた","三着内"]]=(g[["離れた","三着内"]]*100).round(1)
    for y in (2022,2024,2026): g[f"離れ{y}"]=(d[d.year==y].groupby(key).y.mean()*100).round(1)
    print("\n■",name); print(g.to_string())
tb("ライン内の位置(1=番手)",d.k.clip(upper=3))
tb("前の選手の戦法(決まり手の型)",d.p_style.map({0:"逃げ型",1:"両立型",2:"捲り型",3:"自力弱"}))
tb("自分の脚質",d.f_kyaku.map({0:"逃",1:"両",2:"追"}))
tb("前の選手との得点差(自分−前)",pd.cut(d.dz,[-9,-1,-0.3,0.3,1,9]))
tb("自分の年齢",pd.cut(d.f_age,[0,30,40,50,60,99]))
tb("自分のマーク回数(直近)",pd.cut(d.f_mark,[-1,0,2,5,99]))
tb("バンク",d.bank)
tb("クラス",d.ks.map({1:"S級",0:"A級"}))
print("\n離れた選手の3着内", pc(d[d.y==1].top3),"% / 離れていない", pc(d[d.y==0].top3),"%")
F=[c for c in d.columns if c not in("id","year","y","top3","comment")]
tr=d[d.year<=2024]; te=d[d.year>=2025].copy()
m=GB(max_iter=200,learning_rate=0.06,max_leaf_nodes=15,min_samples_leaf=100,l2_regularization=1.0,random_state=0).fit(tr[F],tr.y)
te["p"]=m.predict_proba(te[F])[:,1]
print("\n2025-26 で試す: AUC",round(roc_auc_score(te.y,te.p),3))
te["q"]=pd.qcut(te.p,5,labels=False)
print(te.groupby("q").agg(予想=("p","mean"),実際=("y","mean"),三着内=("top3","mean")).round(3).to_string())
pickle.dump((m,F),open("hanare_m.pkl","wb"))
