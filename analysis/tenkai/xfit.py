# 交差予測: ライン独占確率(ライン単位)と 2+1 / 3ライン / ライン決着 の確率(レース単位)
# 2022-24 は「残り2年で作ったモデル」で、2025-26 は「2022-24 で作ったモデル」で予想(未来を見ない)
import pandas as pd, numpy as np, os, json, pickle
from sklearn.ensemble import HistGradientBoostingClassifier as GB
D=os.path.dirname(os.path.abspath(__file__))
exec(open(D+"/line.py").read().split("df=pd.DataFrame(rows)")[0].split("D=os.path")[0])  # imports only
rows=[]
for l in open(D+"/races.jsonl"):
    r=json.loads(l); L=r["lines"]; top=set(r["top"])
    best=sorted(range(len(L)),key=lambda i:min(L[i]["ranks"]))
    allsc=[s for x in L for s in x["scores"]]
    for i,x in enumerate(L):
        if x["size"]<3: continue
        h=x["head"]; s=x["second"] or {}
        others=[L[j] for j in range(len(L)) if j!=i]
        ob=sorted([o["back"] for o in others if o["back"] is not None],reverse=True)
        rows.append({"id":r["id"],"year":r["year"],"key":tuple(sorted(x["cars"])),
          "size":x["size"],"rk_line":best.index(i),"n":r["n"],"nlines":len(L),"ntanki":sum(o["size"]==1 for o in L),
          "rsum3":sum(sorted(x["ranks"])[:3]),"best":min(x["ranks"]),"smean":np.mean(x["scores"][:3]),"sz":(np.mean(x["scores"][:3])-np.mean(allsc))/(np.std(allsc) or 1),
          "front":x["front"] if x["front"] is not None else np.nan,"back":x["back"] if x["back"] is not None else np.nan,
          "oback":ob[0] if ob else np.nan,"h_nige":h["nige"],"h_maku":h["maku"],"h_B":h["B"],"h_S":h["S"],"h_san":h["sanren"],"h_age":h["age"],
          "h_kn":int(h["kyaku"]=="逃"),"s_mark":s.get("mark",0),"s_oik":int(s.get("kyaku")=="追"),"s_san":s.get("sanren",0),
          "o_best":min(min(o["ranks"]) for o in others),"o_maxsize":max(o["size"] for o in others),"o_selfheads":sum((o["head"]["nige"]+o["head"]["maku"])>=3 for o in others if o["size"]>=2),
          "banklen":(r["bank"] or {}).get("len",400),"suji":(r["bank"] or {}).get("suji",53),"ks":int(r["klass"]=="s"),"seri":int(r["seri"]>0),
          "y":int(set(x["cars"][:3])==top) if x["size"]==3 else int(top<=set(x["cars"]))})
ld=pd.DataFrame(rows); lf=[c for c in ld.columns if c not in("id","year","key","y")]
rd=pd.read_pickle(D+"/df.pkl")
for p in ["L1_","L2_"]:
    for s in ["nige","maku","both","weak"]: rd[p+"st_"+s]=(rd[p+"h_style"]==s).astype(float)
rd["k_s"]=(rd.klass=="s").astype(int); rd["k_a3"]=(rd.klass=="a3").astype(int)
rf=[c for c in rd.columns if c not in ("id","year","place","klass","outcome","sweep","two","L1sweep","L1_h_style","L2_h_style")]
ym={"sweep":0,"two":1,"three":2}
def gbm(): return GB(max_iter=300,learning_rate=0.05,min_samples_leaf=200,l2_regularization=1.0,random_state=0)
lp=pd.Series(np.nan,index=ld.index); rp=np.full((len(rd),3),np.nan)
for test,train in [([2022],[2023,2024]),([2023],[2022,2024]),([2024],[2022,2023]),([2025,2026],[2022,2023,2024])]:
    a=ld.year.isin(train); b=ld.year.isin(test)
    lp[b]=gbm().fit(ld.loc[a,lf],ld.loc[a,"y"]).predict_proba(ld.loc[b,lf])[:,1]
    a=rd.year.isin(train); b=rd.year.isin(test)
    rp[b.values]=gbm().fit(rd.loc[a,rf],rd.loc[a,"outcome"].map(ym)).predict_proba(rd.loc[b,rf])
    print("done",test)
LP={(i,k):p for i,k,p in zip(ld.id,ld.key,lp)}
RP={i:p for i,p in zip(rd.id,rp)}
pickle.dump((LP,RP),open(D+"/xfit.pkl","wb"))
