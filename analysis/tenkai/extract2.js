// 展開の学習用: 1レース1行。並び予想の順(前→後)のライン、選手ごとの戦法・回数、結果の S・B・着順と決まり手
const E=require("../../engine.js"), {T}=require("../../bankdata.js");
const z=require("zlib"),fs=require("fs");
const SP=__dirname; const out=fs.createWriteStream(SP+"/tenkai.jsonl");
let n=0; const skip={}; const S=(k)=>{skip[k]=(skip[k]||0)+1;};
for(const f of fs.readdirSync(SP+"/pc").sort()){
  const ym=f.slice(3,9); const pc=JSON.parse(fs.readFileSync(SP+"/pc/"+f)).races;
  const raw=JSON.parse(z.gunzipSync(fs.readFileSync(SP+"/raw/pcraw-"+ym+".json.gz")));
  const res=JSON.parse(fs.readFileSync(SP+"/res/res-"+ym+".json")).races;
  for(const [id,x] of Object.entries(pc)){
    const r=res[id]; if(!r||!r.rows){S("結果なし");continue;}
    if(x.klass==="girls"){S("ガールズ");continue;}
    const lines=x.lines; if(!lines||lines.length<2){S("ライン不明");continue;}
    let p; try{p=E.parseCard(raw[id]);}catch(e){S("parse失敗");continue;}
    if(!p||!p.entries||!p.entries.length){S("parse失敗");continue;}
    const by={}; for(const e of p.entries) by[e.car]=e;
    if(lines.some(l=>l.some(c=>!by[c]))){S("欠車");continue;}
    const rk={}; for(const q of x.riders) rk[q[0]]=q[4];
    const fin=r.rows.filter(w=>typeof w[0]==="number").sort((a,b)=>a[0]-b[0]).map(w=>[w[1],w[2]||"",w[4]||""]);
    if(fin.length<3){S("着順不足");continue;}
    const R={}; for(const e of p.entries){R[e.car]=[e.kyaku,e.k.nige,e.k.makuri,e.k.sashi,e.k.mark,e.S,e.B,e.score,rk[e.car]||9,e.rate.sanren,e.age,e.seiseki.win1+e.seiseki.win2+e.seiseki.win3+e.seiseki.out];}
    out.write(JSON.stringify({id,year:+id.slice(0,4),place:x.place,klass:x.klass,grade:x.grade||"",n:p.entries.length,
      bank:T[x.place]?T[x.place][0]:400,lines,seri:p.seri||[],R,Sc:r.S||null,Bc:r.B||null,fin})+"\n"); n++;
  }
  process.stderr.write(ym+" "+n+"\r");
}
out.end(()=>console.log("\nレース",n,skip));
