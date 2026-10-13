import json, numpy as np, pandas as pd
def style(nige,maku):
    J=nige+maku
    return "自力弱" if J<=2 else ("逃げ型" if nige/J>=0.6 else ("捲り型" if nige/J<=0.4 else "両立型"))
rows=[]
for l in open("tenkai.jsonl"):
    r=json.loads(l); L=r["lines"]; R=r["R"]; fin=r["fin"]
    li={c:i for i,x in enumerate(L) for c in x}
    if r["Sc"] is None or r["Bc"] is None or r["Sc"] not in li or r["Bc"] not in li: continue
    s=li[r["Sc"]]; b=li[r["Bc"]]; w,wk=fin[0][0],fin[0][1]
    if w not in li: continue
    top3=[q[0] for q in fin[:3]]
    big=[i for i,x in enumerate(L) if len(x)>=2]
    rear=max(big) if big else len(L)-1
    Bl=L[b]; Sl=L[s]; hb=str(Bl[0]); hs=str(Sl[0])
    def hd(i): h=str(L[i][0]); return R[h]
    d={"id":r["id"],"year":r["year"],"bank":r["bank"],"klass":r["klass"],"n":r["n"],"nl":len(L),"ntank":sum(len(x)==1 for x in L),
       "S_is_pred_front":int(s==0),"s":s,"b":b,"tsup":int(s==b),"B_is_rear":int(b==rear and b!=s),"B_is_mid":int(b!=s and b!=rear),
       "S_size":len(Sl),"S_style":style(hd(s)[1],hd(s)[2]),"S_Bcnt":hd(s)[6],
       "B_size":len(Bl),"B_style":style(hd(b)[1],hd(b)[2]),
       "win_line":li[w],"win_k":wk,"win_in_B":int(li[w]==b),"win_is_Bhead":int(w==Bl[0]),"win_is_Bban":int(len(Bl)>1 and w==Bl[1]),
       "Bhead_top3":int(Bl[0] in top3),"Shead_top3":int(Sl[0] in top3),"S_win":int(li[w]==s),"S_top3n":sum(c in Sl for c in top3),
       "B_12":int(len(Bl)>1 and set(top3[:2])==set(Bl[:2])),
       "makurare":int(Bl[0] not in top3 and li[w]!=b and wk=="捲"),"win_maku_other":int(li[w]!=b and wk=="捲")}
    rows.append(d)
df=pd.DataFrame(rows); df.to_pickle("tk_base.pkl"); print(len(df))
pc=lambda s: (s.mean()*100).round(1)
print("\n① スタート(S)を並び予想の先頭ラインが取る:",pc(df.S_is_pred_front),"%")
print("② S を取ったラインがそのまま主導権(最終バック先頭)= 突っ張り/そのまま先行:",pc(df.tsup),"%   最後尾ラインが主導権:",pc(df.B_is_rear),"%  中団ラインが主導権:",pc(df.B_is_mid),"%")
def tb(name,g,cols):
    a=g.agg(**{k:(v,"mean") for k,v in cols.items()}); a=(a*100).round(1); a.insert(0,"レース",g.size()); print("\n■",name); print(a.to_string())
tb("Sラインの先頭の戦法 → 突っ張る(主導権)か",df.groupby("S_style"),{"突っ張り":"tsup","最後尾が主導権":"B_is_rear"})
tb("Sラインの人数 → 突っ張るか",df.groupby(df.S_size.clip(upper=4)),{"突っ張り":"tsup"})
tb("バンク → 突っ張るか",df.groupby("bank"),{"突っ張り":"tsup"})
t=df[df.tsup==1]; h=df[df.tsup==0]
print("\n③ 突っ張った(Sライン=主導権)とき: Sラインから1着",pc(t.S_win),"% / 先頭が3着内",pc(t.Shead_top3),"% / 先頭が逃げ切り",pc(t.win_is_Bhead),"% / 番手が1着",pc(t.win_is_Bban),"% / 他ラインの捲りで1着",pc(t.win_maku_other),"% / 先頭が捲られて着外",pc(t.makurare),"%")
print("   引いた(主導権を渡した)とき: Sラインから1着",pc(h.S_win),"% / Sの先頭が3着内",pc(h.Shead_top3),"%")
tb("突っ張ったとき: Sの先頭の戦法別",t.groupby("S_style"),{"Sライン1着":"S_win","先頭逃げ切り":"win_is_Bhead","番手1着":"win_is_Bban","捲られ":"makurare"})
tb("引いたとき: Sの先頭の戦法別",h.groupby("S_style"),{"Sライン1着":"S_win","Sの先頭3着内":"Shead_top3"})
tb("主導権ライン: バンク別",df.groupby("bank"),{"先頭逃げ切り":"win_is_Bhead","番手1着":"win_is_Bban","ライン1着":"win_in_B","ラインでワンツー":"B_12","捲られ":"makurare","他ライン捲り1着":"win_maku_other"})
tb("主導権ライン: 人数別(ブロック)",df.groupby(df.B_size.clip(upper=4)),{"先頭逃げ切り":"win_is_Bhead","番手1着":"win_is_Bban","ライン1着":"win_in_B","捲られ":"makurare"})
tb("主導権ライン: 先頭の戦法別",df.groupby("B_style"),{"先頭逃げ切り":"win_is_Bhead","番手1着":"win_is_Bban","ライン1着":"win_in_B","捲られ":"makurare"})
tb("主導権を取った経路",df.assign(k=np.select([df.tsup==1,df.B_is_rear==1],["突っ張り(S=主導権)","最後尾が押さえ/叩いて"],"中団が叩いて")).groupby("k"),{"主導権ライン1着":"win_in_B","先頭逃げ切り":"win_is_Bhead","捲られ":"makurare","Sライン1着":"S_win"})
tb("クラス",df.groupby("klass"),{"突っ張り":"tsup","主導権ライン1着":"win_in_B","捲られ":"makurare"})
