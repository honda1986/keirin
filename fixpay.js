// ============================================================
// fixpay.js — 保存済みの着順・配当を、正しいパーサーで取り直して修正する
//
// 背景: 旧パーサーは賭式を「数字の個数」だけで判別していたため、
//   3連複(3=5=7)を3連単、2車複(3=7)を2車単として取り込むことがあった。
//   複式は着順ではなく番号順に並ぶため、着順(f/s/t)まで壊れていた。
//   → 区切り文字("-"=単 / "="=複)で判別する新パーサーで全期間を取り直す。
//
// 払戻ページは1日1リクエストなので、数百日でも数分で完了する。
// 使い方: node fixpay.js [days]  (省略時は全期間)
// ============================================================
const fs = require("fs");
const path = require("path");
const dir = __dirname;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

async function get(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) { return null; } finally { clearTimeout(t); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseHaraiList(html) {
  const out = {};
  // 【方針】① まず「○○競輪」でブロック分割 → ② 各ブロック内で行の開始位置を全部拾い、
  //   ③ 行ごとに独立した区間として読む。
  //   1つの正規表現で通し読みすると、配当が空の行(未発売等)で次の配当まで走ってしまい、
  //   飛び越えた行がまるごと失われる(3連単が23レース欠ける等の原因)。
  const parts = html.split(/([぀-ヿ一-龥]{2,5})競輪/);
  for (let i = 1; i < parts.length; i += 2) {
    const venue = parts[i];
    const block = parts[i + 1] || "";
    // 行の開始位置(レース番号セル)を全部列挙
    const heads = [];
    const raceRe = /class="race"[^>]*>\s*(\d{1,2})R/g;
    let hm;
    while ((hm = raceRe.exec(block))) heads.push({ pos: hm.index, rno: hm[1] });
    for (let k = 0; k < heads.length; k++) {
      // 次の行の開始までを1行分として切り出す(最後の行は1500字まで)
      const segEnd = k + 1 < heads.length ? heads[k + 1].pos : Math.min(block.length, heads[k].pos + 1500);
      const seg = block.slice(heads[k].pos, segEnd);
      // 配当セルはタグごと取り出し、タグを剥がしてから数字を拾う。
      // 高額配当は <span class="attention">58,560</span> と囲まれるため、
      // 「> の直後が数字」を前提にすると高配当の行だけ選択的に落ちる。
      const payM = seg.match(/class="refund"[^>]*>([\s\S]*?)<\/td>/);
      if (!payM) continue;
      const payNum = payM[1].replace(/<[^>]*>/g, " ").match(/([\d,]+)/);
      if (!payNum) continue;                     // 配当なし(未発売・未確定)はスキップ
      const ordM = seg.match(/class="order"([\s\S]*?)<\/td>/);
      if (!ordM) continue;
      const chunk = ordM[1];
      const pay = +payNum[1].replace(/,/g, "");
      const cars = [...chunk.matchAll(/class="n(\d)"[^>]*>\s*(\d)\s*</g)].map((x) => +x[2]);
      if (!cars.length || !pay) continue;
      // 賭式は区切り文字で判別: "-"=順序あり(3連単/2車単) / "="=順序なし(複式)は無視。
      // 複式は着順ではなく番号順に並ぶため、取り込むと着順データまで壊れる。
      const syms = [...chunk.matchAll(/class="symbol"[^>]*>([\s\S]{0,8}?)<\//g)].map((x) => x[1]);
      // 記号の個数が「車数 - 1」と合わない行は判別不能なので捨てる。
      // これが無いと syms が空のとき素通りし、複式が単式として取り込まれる。
      if (syms.length !== cars.length - 1) continue;
      if (syms.some((s) => s.includes("=") || s.includes("＝"))) continue;
      const key = venue + "_" + heads[k].rno + "R";
      const o = (out[key] = out[key] || {});
      if (cars.length === 3 && o.first == null) {
        o.first = cars[0]; o.second = cars[1]; o.third = cars[2]; o.p3pay = pay;
      } else if (cars.length === 2 && o.p2pay == null) {
        o.p2pay = pay; o.p2first = cars[0]; o.p2second = cars[1];
      }
    }
  }
  return out;
}

(async () => {
  const hist = JSON.parse(fs.readFileSync(path.join(dir, "history.json"), "utf8"));
  const arg = parseInt(process.argv[2] || "0", 10);
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const fromD8 = arg ? new Date(jst.getTime() - arg * 86400000).toISOString().slice(0, 10).replace(/-/g, "") : "00000000";

  const byDate = {};
  for (const e of hist.entries) {
    if (e.date < fromD8) continue;
    (byDate[e.date] = byDate[e.date] || []).push(e);
  }
  const dates = Object.keys(byDate).sort().reverse();
  console.log("対象:", dates.length, "日 /", Object.values(byDate).reduce((a, b) => a + b.length, 0), "レース");

  const PURGE = process.argv.includes("--purge"); // 確認できないエントリを削除する
  if (PURGE) console.log("※ purgeモード: 払戻ページで確認できなかったエントリは削除します");
  const toDelete = new Set();
  let fixedOrder = 0, fixedP3 = 0, fixedP2 = 0, notFound = 0, checked = 0, noSan = 0, noNi = 0;
  for (let i = 0; i < dates.length; i++) {
    const d8 = dates[i];
    const url = `https://keirin.kdreams.jp/harailist/${d8.slice(0, 4)}/${d8.slice(4, 6)}/${d8.slice(6, 8)}/`;
    const html = await get(url);
    if (!html) { console.log("  " + d8 + ": 取得失敗(スキップ)"); await sleep(200); continue; }
    const truth = parseHaraiList(html);
    let fo = 0, f3 = 0, f2 = 0, nf = 0;
    for (const e of byDate[d8]) {
      checked++;
      const t = truth[e.place + "_" + e.raceNo];
      // レース自体が見つからない場合のみ「該当なし」
      if (!t) { nf++; notFound++; if (PURGE) toDelete.add(e.id || (e.date + "_" + e.place + "_" + e.raceNo)); continue; }
      // 【重要】3連単が取れなくても2車単は独立して更新する。
      //   以前は3連単が無いだけでレースごとスキップしていたため、
      //   2車単配当が古い誤った値のまま残っていた(3〜4月の回収率が異常に高い原因)。
      if (t.first != null) {
        if (e.f !== t.first || e.s !== t.second || e.t !== t.third) { e.f = t.first; e.s = t.second; e.t = t.third; fo++; fixedOrder++; }
        if (e.p3pay !== t.p3pay) { e.p3pay = t.p3pay; f3++; fixedP3++; }
      } else {
        noSan++;
        // 【重要】3連単が無くても、2車単の並びが「1着-2着」そのもの。
        //   旧パーサーは3連複(車番の小さい順)を着順として保存していた可能性があるため、
        //   ここで2車単から正しい1着・2着に直す(3着は不明なのでnull)。
        if (t.p2first != null && (e.f !== t.p2first || e.s !== t.p2second)) {
          e.f = t.p2first; e.s = t.p2second; e.t = null; e.p3pay = null;
          fo++; fixedOrder++;
        }
      }
      // 【重要】ページから2車単が読めた時だけ更新する。
      //   読めなかった場合に null で上書きすると、読み取り失敗なのか
      //   本当に配当が無いのか区別できないまま、良いデータまで消してしまう。
      if (t.p2pay != null) {
        if (e.p2pay !== t.p2pay) { e.p2pay = t.p2pay; f2++; fixedP2++; }
      } else {
        noNi++; // 2車単が読めなかった(既存の値はそのまま残す)
      }
    }
    if ((i + 1) % 10 === 0 || fo || f3 || f2) {
      console.log(`  [${i + 1}/${dates.length}] ${d8}: 着順修正${fo} / 3連単修正${f3} / 2車単修正${f2}` + (nf ? ` / 該当なし${nf}` : ""));
    }
    if ((i + 1) % 20 === 0) fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify(hist));
    await sleep(200);
  }
  if (PURGE && toDelete.size) {
    const before = hist.entries.length;
    hist.entries = hist.entries.filter((e) => !toDelete.has(e.id || (e.date + "_" + e.place + "_" + e.raceNo)));
    console.log("\npurge: 確認できなかった", before - hist.entries.length, "件を削除(残り", hist.entries.length, "件)");
  }
  fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify(hist));
  console.log("\n完了: 検査", checked, "件");
  console.log("  着順を修正:", fixedOrder, "件");
  console.log("  3連単配当を修正:", fixedP3, "件");
  console.log("  2車単配当を修正:", fixedP2, "件");
  console.log("  払戻ページに該当なし(レース自体なし):", notFound, "件");
  console.log("  3連単だけ取れず(2車単は更新済み):", noSan, "件");
  console.log("  2車単が読めず(既存値を維持):", noNi, "件");
  console.log("\n→ この後 verify.js で妥当性を再確認し、シミュレーターを回し直してください");
})();
