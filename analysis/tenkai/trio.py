# 1組1行の表: モデルDの特徴(市場+選手) と ライン構造の特徴
import json, numpy as np, os, pickle, itertools, glob
D=os.path.dirname(os.path.abspath(__file__))
VP={"函館":"北海道","青森":"青森","いわき平":"福島","弥彦":"新潟","前橋":"群馬","取手":"茨城","宇都宮":"栃木","大宮":"埼玉","西武園":"埼玉","京王閣":"東京","立川":"東京","松戸":"千葉","千葉":"千葉","川崎":"神奈川","平塚":"神奈川","小田原":"神奈川","伊東":"静岡","静岡":"静岡","名古屋":"愛知","岐阜":"岐阜","大垣":"岐阜","豊橋":"愛知","富山":"富山","松阪":"三重","四日市":"三重","福井":"福井","奈良":"奈良","向日町":"京都","和歌山":"和歌山","岸和田":"大阪","玉野":"岡山","広島":"広島","防府":"山口","高松":"香川","小松島":"徳島","高知":"高知","松山":"愛媛","小倉":"福岡","久留米":"福岡","武雄":"佐賀","佐世保":"長崎","別府":"大分","熊本":"熊本"}
LOM=-4.264394023053231
LP,RP=pickle.load(open(D+"/xfit.pkl","rb"))
PC={}
for f in sorted(glob.glob(D+"/pc/pc-*.json")): PC.update(json.load(open(f))["races"])
OD={}
for f in sorted(glob.glob("../../odds-*.json")): OD.update(json.load(open(f))["races"])
RF=["er","single","banme","age50","home","young","samepref","r120","has_r","scz","head","srk"]
SF=["same3","same3_lp","two1","two1_lp2","s_banme","s_nigehead","s_tanki","s_otherhead","pair_hb","s_lowscore","s_inL1","three","three_lp3"]
X=[];W=[];G=[];YR=[];ODD=[];IDS=[];TK=[]
gi=0; skip=0
lg=lambda p: np.log(max(p,1e-4)/max(1-p,1e-4))
for l in open(D+"/races.jsonl"):
    r=json.loads(l); id_=r["id"]; x=PC.get(id_); od=OD.get(id_)
    if not x or not od or id_ not in RP: skip+=1; continue
    n=r["n"]; cs=list(itertools.combinations(range(1,n+1),3)); o=od["o"]
    if len(o)!=len(cs) or od.get("cars",n)!=n: skip+=1; continue
    rd={q[0]:q for q in x["riders"]}
    if len(rd)!=n: skip+=1; continue
    lines=x["lines"]; pos={};ln={};mates={};lid={}
    for i,L in enumerate(lines):
        for k,c in enumerate(L): pos[c]=k; ln[c]=len(L); mates[c]=[m for m in L if m!=c]; lid[c]=i
    if any(c not in lid for c in rd): skip+=1; continue
    vp=VP.get(r["place"]); sc=np.array([q[6] or 0 for q in x["riders"]],float); m,s=sc.mean(),sc.std() or 1
    srank={c:i+1 for i,c in enumerate(sorted(rd,key=lambda c:-(rd[c][6] or 0)))}
    F={}
    for c,q in rd.items():
        lp_,ll=pos[c],ln[c]; san,nr=q[8],q[9] or 0; hasr=nr>0 and san is not None
        F[c]=[q[4] or 5, float(ll==1), float(lp_>=1 and ll>=2), float((q[1] or 0)>=50), float(bool(vp) and q[7]==vp), float((q[2] or 0)>=121),
              float(lp_>=1 and any(rd.get(mm) and rd[mm][7]==q[7] for mm in mates[c])), (san/100 if hasr else 0.42665), float(hasr), ((q[6] or m)-m)/s, float(lp_==0 and ll>=2), srank[c]]
    F={c:np.array(v) for c,v in F.items()}
    # 先頭の型(races.jsonl の lines に入っている)
    hstyle={}
    for L in r["lines"]: hstyle[L["cars"][0]]=(L["head"]["style"],L["head"]["kyaku"])
    rank1=min(rd,key=lambda c:rd[c][4] or 9); L1=lid[rank1]
    ps,p2,p3=RP[id_]
    top=tuple(sorted(r["top"])); wi=-1; rows=[]
    for c,v in zip(cs,o):
        if not (v and 0<v<9999): continue
        lo=np.log(1/v); lc=lo-LOM
        rf=F[c[0]]+F[c[1]]+F[c[2]]
        li=[lid[k] for k in c]; cnt={}
        for k in li: cnt[k]=cnt.get(k,0)+1
        same3=len(cnt)==1; two1=len(cnt)==2; three=len(cnt)==3
        sf=np.zeros(len(SF))
        if same3:
            key=tuple(sorted(lines[li[0]])); p=LP.get((id_,key),np.nan)
            sf[0]=1; sf[1]=lg(p) if p==p else 0
        elif two1:
            pl=[k for k in cnt if cnt[k]==2][0]; one=[k for k in c if lid[k]!=pl][0]; pair=[k for k in c if lid[k]==pl]
            sf[2]=1; sf[3]=lg(p2)
            st,ky=hstyle.get(one,(None,None))
            sf[4]=float(pos[one]==1 and ln[one]>=2)
            sf[5]=float(pos[one]==0 and ln[one]>=2 and (ky=="逃" or st=="nige"))
            sf[6]=float(ln[one]==1)
            sf[7]=float(pos[one]==0 and ln[one]>=2 and not (ky=="逃" or st=="nige"))
            sf[8]=float(sorted(pos[k] for k in pair)==[0,1])
            sf[9]=float(srank[one]>=6)
            sf[10]=float(lid[one]==L1)
        else:
            sf[11]=1; sf[12]=lg(p3)
        if c==top: wi=len(rows)
        rows.append((np.r_[lo,lc**2,lc**3,lo*(n>=8),rf,sf],c,v))
    if wi<0 or len(rows)<len(cs)*0.8: skip+=1; continue
    for k,(feat,c,v) in enumerate(rows):
        X.append(feat); W.append(k==wi); G.append(gi); ODD.append(v); TK.append("=".join(map(str,c)))
    YR.append(r["year"]); IDS.append(id_); gi+=1
X=np.array(X,np.float32); W=np.array(W); G=np.array(G,np.int32)
np.savez(D+"/trio.npz",X=X,W=W,G=G,YR=np.array(YR),ODD=np.array(ODD,np.float32))
pickle.dump((IDS,TK),open(D+"/trio_ids.pkl","wb"))
print("レース",gi,"組",len(X),"飛ばした",skip)
