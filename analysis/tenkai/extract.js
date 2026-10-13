const E=require("../../engine.js"), FRONT=require("../../front.js"), {T}=require("../../bankdata.js");
const z=require("zlib"),fs=require("fs"),path=require("path");
const SP=__dirname; const out=fs.createWriteStream(SP+"/races.jsonl");
const hsType=(k)=>{const J=k.nige+k.makuri;return J<=2?"weak":k.nige/J>=0.6?"nige":k.nige/J<=0.4?"maku":"both";};
let n=0,skip={};
const S=(k)=>{skip[k]=(skip[k]||0)+1;};
for(const f of fs.readdirSync(SP+"/pc").sort()){
  const ym=f.slice(3,9); const pc=JSON.parse(fs.readFileSync(SP+"/pc/"+f)).races;
  const raw=JSON.parse(z.gunzipSync(fs.readFileSync(SP+"/raw/pcraw-"+ym+".json.gz")));
  const res=JSON.parse(fs.readFileSync(SP+"/res/res-"+ym+".json")).races;
  for(const [id,x] of Object.entries(pc)){
    const r=res[id]; if(!r||!r.rows){S("結果なし");continue;}
    if(x.klass==="girls"){S("ガールズ");continue;}
    const top=[1,2,3].map(k=>{const w=r.rows.find(q=>q[0]===k);return w?w[1]:null;});
    if(top.some(v=>v==null)){S("3着不明");continue;}
    const lines=x.lines; if(!lines||lines.length<2){S("ライン不明");continue;}
    const li={}; lines.forEach((l,i)=>l.forEach(c=>li[c]=i));
    if(top.some(c=>li[c]==null)){S("並びにいない");continue;}
    let p; try{p=E.parseCard(raw[id]);}catch(e){S("parse失敗");continue;}
    if(!p||!p.entries||!p.entries.length){S("parse失敗");continue;}
    const by={}; for(const e of p.entries) by[e.car]=e;
    if(lines.some(l=>l.some(c=>!by[c]))){S("欠車");continue;}
    p.lines=lines;
    let pr=null; try{pr=E.predict(p,T[x.place],x.place,null);}catch(e){}
    const rank={}; for(const q of x.riders) rank[q[0]]=q[4];
    let fp=null; try{fp=FRONT.probs(lines,FRONT.fromEntries(p.entries,rank));}catch(e){}
    const bp={}; if(pr&&pr.backProbs) pr.backProbs.forEach(o=>{bp[lines.findIndex(l=>l.join()===o.line.join())]=o.p;});
    const cnt={}; top.forEach(c=>cnt[li[c]]=(cnt[li[c]]||0)+1); const vals=Object.values(cnt).sort((a,b)=>b-a);
    const outcome=vals[0]===3?"sweep":vals[0]===2?"two":"three";
    const L=lines.map((l,i)=>{const h=by[l[0]];return {i,size:l.length,cars:l,head:{kyaku:h.kyaku,style:hsType(h.k),nige:h.k.nige,maku:h.k.makuri,S:h.S,B:h.B,score:h.score,sanren:h.rate.sanren,age:h.age},
      second: l.length>1?{kyaku:by[l[1]].kyaku,mark:by[l[1]].k.mark,sashi:by[l[1]].k.sashi,score:by[l[1]].score,sanren:by[l[1]].rate.sanren,age:by[l[1]].age}:null,
      ranks:l.map(c=>rank[c]), scores:l.map(c=>by[c].score), front:fp?fp[i]:null, back:bp[i]!=null?bp[i]:null};});
    out.write(JSON.stringify({id,year:+id.slice(0,4),place:x.place,klass:x.klass,grade:x.grade,n:p.entries.length,seri:(p.seri||[]).length,
      bank:T[x.place]?{len:T[x.place][0],suji:T[x.place][10]}:null,lines:L,top,outcome,topLine:li[top[0]],winLine:Object.keys(cnt).find(k=>cnt[k]>=2)})+"\n"); n++;
  }
  process.stderr.write(ym+" "+n+"\r");
}
out.end(()=>console.log("\nレース", n, skip));
