import json, numpy as np, pandas as pd
rows=[]
for l in open(__import__("os").path.dirname(__file__)+"/races.jsonl"):
    r=json.loads(l); L=r["lines"]
    allr=[(min(x["ranks"]),i) for i,x in enumerate(L)]
    order=[i for _,i in sorted(allr)]
    L1=L[order[0]]; L2=L[order[1]] if len(order)>1 else None
    scores=[s for x in L for s in x["scores"]]
    def lf(x,p):
        if x is None: return {}
        h=x["head"]; s=x["second"] or {}
        return {p+"size":x["size"], p+"solo":int(x["size"]==1), p+"h_nige":h["nige"], p+"h_maku":h["maku"], p+"h_B":h["B"], p+"h_S":h["S"],
                p+"h_kyaku_nige":int(h["kyaku"]=="逃"), p+"h_kyaku_ryo":int(h["kyaku"]=="両"), p+"h_style":h["style"],
                p+"h_san":h["sanren"], p+"h_age":h["age"], p+"s_mark":s.get("mark",0), p+"s_sashi":s.get("sashi",0), p+"s_oikomi":int(s.get("kyaku")=="追"),
                p+"s_san":s.get("sanren",0), p+"front":x["front"] if x["front"] is not None else np.nan, p+"back":x["back"] if x["back"] is not None else np.nan,
                p+"rsum3":sum(sorted(x["ranks"])[:3]) if x["size"]>=3 else np.nan, p+"best":min(x["ranks"]),
                p+"smean":np.mean(x["scores"][:3]), p+"h_score":h["score"]}
    fr=[x["front"] for x in L if x["front"] is not None]; bk=sorted([x["back"] for x in L if x["back"] is not None],reverse=True)
    heads=[x["head"] for x in L if x["size"]>=2]
    g=r["grade"] or ""
    d={"id":r["id"],"year":r["year"],"place":r["place"],"klass":r["klass"],"n":r["n"],"nlines":len(L),"ntanki":sum(x["size"]==1 for x in L),
       "maxsize":max(x["size"] for x in L),"n3":sum(x["size"]>=3 for x in L),"seri":int(r["seri"]>0),
       "banklen":(r["bank"] or {}).get("len",400),"suji":(r["bank"] or {}).get("suji",53),
       "final":int(("決勝" in g) and ("準決勝" not in g)),"semi":int("準決勝" in g),"yosen":int("予選" in g),
       "maxfront":max(fr) if fr else np.nan,"maxback":bk[0] if bk else np.nan,"backgap":(bk[0]-bk[1]) if len(bk)>1 else np.nan,
       "frontIsLead":int(len(fr)==len(L) and len([x for x in L if x["back"] is not None])==len(L) and int(np.argmax([x["front"] for x in L]))==int(np.argmax([x["back"] for x in L]))),
       "n_self_heads":sum((h["nige"]+h["maku"])>=3 for h in heads),"n_nige_heads":sum(h["style"]=="nige" for h in heads),
       "sstd":np.std(scores),"srange":max(scores)-min(scores),"l12gap":(np.mean(L1["scores"][:3])-np.mean(L2["scores"][:3])) if L2 else np.nan,
       "outcome":r["outcome"],"sweep":int(r["outcome"]=="sweep"),"two":int(r["outcome"]=="two"),
       "L1sweep":int(r["outcome"]=="sweep" and r["winLine"] is not None and int(r["winLine"])==order[0])}
    d.update(lf(L1,"L1_")); d.update(lf(L2,"L2_"))
    rows.append(d)
df=pd.DataFrame(rows); df.to_pickle(__import__("os").path.dirname(__file__)+"/df.pkl")
print(df.shape); print(df.groupby("year")[["sweep","two"]].mean().round(3)); print(df.outcome.value_counts(normalize=True).round(3))
