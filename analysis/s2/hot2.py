# 🔥(本命ライン3人の3連複1点)をもっと儲かるようにできるか。2022〜2026年の作り直した出走表・確定オッズ(払戻 = 倍率×100)
import json, glob, itertools, pickle, numpy as np, pandas as pd, subprocess
races,LD,RD=pickle.load(open("tk_data.pkl","rb")); rid={r["id"]:i for i,r in enumerate(races)}
A=pd.read_pickle("hanare_all.pkl"); pdet={(a,b):p for a,b,p in zip(A.ri,A.car,A.pdet)}
PC={}
for f in sorted(glob.glob("pc/pc-*.json")): PC.update(json.load(open(f))["races"])
OD={}
for f in sorted(glob.glob("../../odds-*.json")): OD.update(json.load(open(f))["races"])
SS=set(json.load(open("../modeld/ss_ids.json")))
FO=pickle.load(open("tk_folds.pkl","rb"))
T=json.loads(subprocess.run(["node","-e","const {T}=require('../../bankdata.js');console.log(JSON.stringify(T))"],capture_output=True,text=True).stdout)
sty=lambda q:(3 if q[1]+q[2]<=2 else (0 if q[1]/(q[1]+q[2])>=0.6 else (2 if q[1]/(q[1]+q[2])<=0.4 else 1)))
rows=[]
for id_,x in PC.items():
    t=x.get("trio"); od=OD.get(id_); n=x.get("n")
    if not t or not od or not n: continue
    cs=list(itertools.combinations(range(1,n+1),3))
    if len(od["o"])!=len(cs): continue
    o=dict(zip(cs,od["o"])); k=tuple(sorted(t)); v=o.get(k)
    if not v or v>=9999: continue
    ri=rid.get(id_); r=races[ri] if ri is not None else None
    row=dict(id=id_,y=int(id_[:4]),n=n,hot=bool(x.get("hot")),ss=id_ in SS,odds=v,rankSum=x.get("rankSum"),
             solo=sum(1 for l in x["lines"] if len(l)==1),place=x["place"],bank=T.get(x["place"],[400])[0])
    qs=sum(1/u for u in od["o"] if u and u<9999); row["q"]=(1/v)/qs
    if r is not None:
        f=tuple(sorted(q[0] for q in r["fin"][:3])); row["hit"]=f==k
        L=r["lines"]; R={int(c):q for c,q in r["R"].items()}
        ln=next((l for l in L if set(t)<=set(l)),None)
        if ln and len(ln)>=3:
            row["brk"]=1-(1-pdet.get((ri,ln[1]),np.nan))*(1-pdet.get((ri,ln[2]),np.nan)); row["lsize"]=len(ln)
            heads=[l for l in L if len(l)>=2]; hs=[sty(R[l[0]]) for l in heads]
            row["head_sty"]=sty(R[ln[0]]); row["nnige"]=hs.count(0)
            brate=lambda c:R[c][6]/R[c][11] if R[c][11] else 0
            row["headB1"]=brate(ln[0])>=max(brate(l[0]) for l in heads)
            row["ban_jir"]=R[ln[1]][1]+R[ln[1]][2]
            fo=FO.get((2022,)) if row["y"]==2023 else FO.get((2022,2023)) if row["y"]>=2024 else None
            if fo:
                pts=[fo.get((id_,c),(np.nan,np.nan))[1] for c in t]; row["tk_sweep"]=np.prod(pts)
                row["tk_head_win"]=fo.get((id_,ln[0]),(np.nan,))[0]
    else:
        continue
    rows.append(row)
D=pd.DataFrame(rows); D["pay"]=np.where(D.hit,D.odds*100,0)
pickle.dump(D,open("hot2.pkl","wb")); print(len(D),"レース(本命ライン3人がいて確定オッズがある)")
def show(label,s,yrs=(2022,2023,2024,2025,2026)):
    if not len(s): print(f"  {label}: なし"); return
    yr=" ".join(f"{(s[s.y==y].pay.sum()/max(1,(s.y==y).sum())):4.0f}%" if (s.y==y).sum() else "  — " for y in yrs)
    print(f"  {label:<40} {len(s):5d}R 的中{s.hit.mean()*100:4.1f}% 回収{s.pay.sum()/len(s):5.1f}% 収支{int(s.pay.sum()-len(s)*100):+8,d}円 | {yr}")
base9=D[(D.n>=8)&D.hot&~D.ss]
print("\n■ いまの🔥と、その帯・しきい値(年: 2022 2023 2024 2025 2026)")
show("9車🔥 全部",base9)
show("9車🔥 5〜15倍",base9[base9.odds.between(5,15)])
cur=base9[base9.odds.between(5,15)&(base9.brk>=0.17)]; show("★いま: 9車🔥 5〜15倍 離れる17%以上",cur)
for lo,hi in ((4,15),(5,20),(5,25),(5,30),(3,15),(6,15)): show(f"9車🔥 {lo}〜{hi}倍 離れる17%以上",base9[base9.odds.between(lo,hi)&(base9.brk>=0.17)])
for th in (0.15,0.20,0.22,0.25): show(f"9車🔥 5〜15倍 離れる{int(th*100)}%以上",base9[base9.odds.between(5,15)&(base9.brk>=th)])
show("9車🔥 15〜30倍 離れる17%以上",base9[base9.odds.between(15.01,30)&(base9.brk>=0.17)])
show("9車🔥 5倍未満 離れる17%以上",base9[(base9.odds<5)&(base9.brk>=0.17)])
print("\n■ いまは買っていない🔥(離れる17%以上・帯あり)")
h7=D[(D.n==7)&D.hot]; show("7車🔥(順位合計12以上) 4〜15倍",h7[h7.odds.between(4,15)]); show("7車🔥 4〜15倍 離れる17%以上",h7[h7.odds.between(4,15)&(h7.brk>=0.17)])
a7=D[(D.n==7)]; show("7車 本命ライン3人 4〜15倍 離れる17%以上(順位合計を問わず)",a7[a7.odds.between(4,15)&(a7.brk>=0.17)])
show("7車 本命ライン3人 5〜15倍 離れる25%以上",a7[a7.odds.between(5,15)&(a7.brk>=0.25)])
n9=D[(D.n>=8)&~D.hot&~D.ss&(D.solo>=2)]; show("9車 単騎2人以上 5〜15倍 離れる17%以上",n9[n9.odds.between(5,15)&(n9.brk>=0.17)])
s9=D[(D.n>=8)&D.ss]; show("9車 SS あり 5〜15倍 離れる17%以上",s9[s9.odds.between(5,15)&(s9.brk>=0.17)])
print("\n■ いまの🔥をさらに分ける(セオリー・展開)")
for lab,m in (("先頭が逃げ型",cur.head_sty==0),("先頭が逃げ型以外",cur.head_sty!=0),("逃げ型の先頭が1人(先行一車寄り)",cur.nnige==1),("逃げ型の先頭が2人以上",cur.nnige>=2),
              ("先頭のB率がいちばん",cur.headB1==True),("先頭のB率が2番以下",cur.headB1==False),("本命ラインが3人",cur.lsize==3),("本命ラインが4人以上",cur.lsize>=4),
              ("番手に自力(逃げ+捲り3回以上)",cur.ban_jir>=3),("番手に自力なし",cur.ban_jir<3),("333バンク",cur.bank<=335),("400バンク",cur.bank==400),("500バンク",cur.bank>=500)):
    show(lab,cur[m])
c2=cur[cur.tk_sweep.notna()].copy(); c2["ratio"]=c2.tk_sweep/c2.q
med=c2.ratio.median()
show(f"展開もライン決着を市場より高く見る(比≥中央値{med:.2f})",c2[c2.ratio>=med],(2023,2024,2025,2026)); show("展開はそう見ない(比<中央値)",c2[c2.ratio<med],(2023,2024,2025,2026))
print("\n■ 金額を変える(離れる確率が高いほど多く)")
for th,mult in ((0.22,2),(0.25,2),(0.25,3)):
    st=np.where(cur.brk>=th,mult,1); yr=" ".join(f"{(cur.pay[cur.y==y]*st[cur.y==y]).sum()/(st[cur.y==y].sum()):4.0f}%" for y in range(2022,2027))
    print(f"  離れる{int(th*100)}%以上は{mult}倍: 回収{(cur.pay*st).sum()/(st.sum()*100)*100:5.1f}% 収支{int((cur.pay*st).sum()-st.sum()*100):+8,d}円 (1倍なら{int(cur.pay.sum()-len(cur)*100):+,}円) | {yr}")
