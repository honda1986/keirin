# 前受けのライン(S)が突っ張るか引くか(はむさんの質問 2026-10-15)。突っ張る = 前受けのラインが最終バック先頭(B)
#   自分の人数 / 相手の人数(相手で一番多い人数・後ろ攻め=並び予想で後ろにいる2人以上のライン) / 9車・7車 / 年ごと / 先頭の脚質で揃えて
import pickle, pandas as pd, numpy as np
races,LD,RD=pickle.load(open("tk_data.pkl","rb"))
rows=[]
for ri,g in LD.groupby("ri",sort=False):
    s=g[g.isS==1]
    if not len(s): continue
    s=s.iloc[0]; o=g[g.li!=s.li]
    if not len(o): continue
    om=o[o["size"]>=2]
    rear=om.sort_values("pos").iloc[-1] if len(om) else o.sort_values("pos").iloc[-1]
    b=g[g.isB==1]; b=b.iloc[0] if len(b) else None
    rows.append(dict(ri=ri,year=s.year,n=s.n,own=int(s["size"]),omax=int(o["size"].max()),rear=int(rear["size"]),nopp=int((o["size"]>=2).sum()),
        style=int(s["style"]),tsup=int(s.isB==1),bsize=None if b is None else int(b["size"]),b_is_rear=None if b is None or s.isB==1 else int(b.li==rear.li)))
D=pd.DataFrame(rows); D.to_pickle("tsup.pkl")
D["car"]=np.where(D.n>=8,"9車",np.where(D.n==7,"7車","6車以下"))
cap=lambda v:"4+" if v>=4 else str(v)
D["ownc"]=D.own.map(cap); D["omaxc"]=D.omax.map(cap); D["rearc"]=D.rear.map(cap)
def tab(df,r,c,minn=150):
    t=df.groupby([r,c]).tsup.agg(["mean","size"]).reset_index()
    rs=sorted(df[r].unique()); cs=sorted(df[c].unique())
    print("        "+"".join(f"{('相手'+x+'人'):>12s}" for x in cs)+f"{'全体':>12s}")
    for a in rs:
        line=f"自分{a}人 "
        for x in cs:
            q=t[(t[r]==a)&(t[c]==x)]
            line+=f"{(f'{q.iloc[0][chr(109)+chr(101)+chr(97)+chr(110)]*100:.0f}%({int(q.iloc[0][chr(115)+chr(105)+chr(122)+chr(101)])})' if len(q) and q.iloc[0]['size']>=minn else '—'):>12s}"
        q=df[df[r]==a]; line+=f"{f'{q.tsup.mean()*100:.0f}%({len(q)})':>12s}"
        print(line)
print(f"全体: {len(D)}R 突っ張り {D.tsup.mean()*100:.1f}%")
for car in ("9車","7車"):
    d=D[D.car==car]
    print(f"\n===== {car} {len(d)}R 突っ張り {d.tsup.mean()*100:.1f}% =====")
    print("[自分の人数]"); print(" ".join(f"{k}人 {v.tsup.mean()*100:.0f}%({len(v)})" for k,v in d.groupby("ownc")))
    print("[相手で一番多い人数]"); print(" ".join(f"{k}人 {v.tsup.mean()*100:.0f}%({len(v)})" for k,v in d.groupby("omaxc")))
    print("[自分 × 相手で一番多い人数]"); tab(d,"ownc","omaxc")
    print("[自分 × 後ろ攻めのラインの人数]"); tab(d,"ownc","rearc")
    print("[自分 × 相手の2人以上のラインの数]"); d2=d.assign(noppc=d.nopp.map(lambda v:str(min(v,3)))); tab(d2,"ownc","noppc")
    print("[年ごと: 自分 × 相手で一番多い人数(主な組)]")
    for (a,x),q in d.groupby(["ownc","omaxc"]):
        if len(q)<600: continue
        print(f"  自分{a}人・相手{x}人: "+" ".join(f"{y} {v.tsup.mean()*100:.0f}%" for y,v in q.groupby("year")))
    print("[先頭の脚質で揃えて: 自分 × 相手で一番多い人数]")
    for st,nm in ((0,"逃げ型"),(1,"両立型"),(2,"捲り型"),(3,"自力弱")):
        q=d[d["style"]==st]
        if len(q)<500: continue
        print(f" 先頭が{nm} ({len(q)}R)"); tab(q,"ownc","omaxc",minn=120)
    print("[引いたとき、前に出たのは]")
    q=d[d.tsup==0]
    print("  後ろ攻め(並び予想で後ろの2人以上のライン)", f"{q.b_is_rear.mean()*100:.0f}%", "/ それ以外(中団など)", f"{(1-q.b_is_rear.mean())*100:.0f}%")
    print("  前に出たラインの人数: "+" ".join(f"{int(k)}人 {v/len(q)*100:.0f}%" for k,v in q.bsize.value_counts().sort_index().items()))
