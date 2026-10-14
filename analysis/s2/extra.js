// 展開の学習データ(tenkai.jsonl)に無い選手の数字を足す: 勝率・2連対率・1着/2着/3着/着外の回数・ホーム回数・ギヤ・級班
const E=require("../../engine.js");
const z=require("zlib"),fs=require("fs"),SP=process.argv[2];
const out={}; let n=0;
for(const f of fs.readdirSync(SP+"/pc").sort()){
  const ym=f.slice(3,9); const pc=JSON.parse(fs.readFileSync(SP+"/pc/"+f)).races;
  const raw=JSON.parse(z.gunzipSync(fs.readFileSync(SP+"/raw/pcraw-"+ym+".json.gz")));
  for(const id of Object.keys(pc)){
    let p; try{p=E.parseCard(raw[id]);}catch(e){continue;}
    if(!p||!p.entries) continue;
    const o={}; for(const e of p.entries){const s=e.seiseki||{},r=e.rate||{};
      o[e.car]=[r.win??null,r.niren??null,s.win1||0,s.win2||0,s.win3||0,s.out||0,e.H||0,e.gear||null,e.grade||""];}
    out[id]=o; n++;
  }
  process.stderr.write(ym+" "+n+"\r");
}
fs.writeFileSync(SP+"/extra.json",JSON.stringify(out)); console.log("\n",n);
