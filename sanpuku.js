// ============================================================
// sanpuku.js — 3連複の配当を払戻ページから取り込み、同時に着順を検算する
//
// fixpay.js の兄弟版。払戻ページは1日1リクエストなので全期間でも数分。
//
// やること:
//   ① 3連複の配当を e.p3fpay に追記する(新フィールド)
//   ② 保存済み f→s が、ページの2車単「1着-2着」と一致するか検算する
//      ← ここが本命。一致しないレースは着順が壊れている確証になる(統計ではなく突合)
//   ③ 3連複の組み合わせが sorted(f,s,t) と一致するか検算する
//   ④ 3着が null のレースを、3連複 ∖ 2車単の2車 から復元する
//
// 【安全装置】既定は読み取り専用。報告だけして history.json は書き換えない。
//   実際に書き込むときだけ --apply を付ける。
//
// 使い方:
//   node sanpuku.js            … 点検のみ(書き込まない)
//   node sanpuku.js --apply    … 点検して書き込む
//   node sanpuku.js 30 --apply … 直近30日だけ
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

// ------------------------------------------------------------
// fixpay.js のパーサーを流用。違いは2点だけ:
//   ・複式を捨てずに、3連複(3車 + "=")として拾う
//   ・記号の個数が「車数 - 1」と合わない行は捨てる
//     (fixpay は syms が空のとき素通りしてしまい、複式が単式に化ける穴があった)
// ------------------------------------------------------------
function parseHaraiList(html) {
  const out = {};
  const parts = html.split(/([぀-ヿ一-龥]{2,5})競輪/);
  for (let i = 1; i < parts.length; i += 2) {
    const venue = parts[i];
    const block = parts[i + 1] || "";
    const heads = [];
    const raceRe = /class="race"[^>]*>\s*(\d{1,2})R/g;
    let hm;
    while ((hm = raceRe.exec(block))) heads.push({ pos: hm.index, rno: hm[1] });
    for (let k = 0; k < heads.length; k++) {
      const segEnd = k + 1 < heads.length ? heads[k + 1].pos : Math.min(block.length, heads[k].pos + 1500);
      const seg = block.slice(heads[k].pos, segEnd);
      // 配当セルはタグごと取り出し、タグを剥がしてから数字を拾う。
      // 高額配当は <span class="attention">58,560</span> と囲まれるため、
      // 「> の直後が数字」を前提にすると高配当の行だけ選択的に落ちる。
      const payM = seg.match(/class="refund"[^>]*>([\s\S]*?)<\/td>/);
      if (!payM) continue;
      const payNum = payM[1].replace(/<[^>]*>/g, " ").match(/([\d,]+)/);
      if (!payNum) continue;
      const ordM = seg.match(/class="order"([\s\S]*?)<\/td>/);
      if (!ordM) continue;
      const chunk = ordM[1];
      const pay = +payNum[1].replace(/,/g, "");
      const cars = [...chunk.matchAll(/class="n(\d)"[^>]*>\s*(\d)\s*</g)].map((x) => +x[2]);
      if (!cars.length || !pay) continue;
      const syms = [...chunk.matchAll(/class="symbol"[^>]*>([\s\S]{0,8}?)<\//g)].map((x) => x[1]);
      if (syms.length !== cars.length - 1) continue;   // 判別不能な行は捨てる
      const fuku = syms.some((s) => s.includes("=") || s.includes("＝"));
      const key = venue + "_" + heads[k].rno + "R";
      const o = (out[key] = out[key] || {});
      if (cars.length === 3 && fuku) {
        if (o.f3 == null) { o.f3 = cars.slice().sort((a, b) => a - b); o.p3fpay = pay; }
      } else if (cars.length === 3 && !fuku) {
        if (o.first == null) { o.first = cars[0]; o.second = cars[1]; o.third = cars[2]; o.p3pay = pay; }
      } else if (cars.length === 2 && !fuku) {
        if (o.p2pay == null) { o.p2pay = pay; o.p2first = cars[0]; o.p2second = cars[1]; }
      }
    }
  }
  return out;
}

const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);

(async () => {
  const APPLY = process.argv.includes("--apply");
  console.log(APPLY ? "※ applyモード: history.json を書き換えます\n" : "※ 点検のみ。history.json は書き換えません(--apply で書き込み)\n");

  const hist = JSON.parse(fs.readFileSync(path.join(dir, "history.json"), "utf8"));
  const arg = parseInt(process.argv.find((a) => /^\d+$/.test(a)) || "0", 10);
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const fromD8 = arg ? new Date(jst.getTime() - arg * 86400000).toISOString().slice(0, 10).replace(/-/g, "") : "00000000";

  const byDate = {};
  for (const e of hist.entries) {
    if (e.date < fromD8) continue;
    (byDate[e.date] = byDate[e.date] || []).push(e);
  }
  const dates = Object.keys(byDate).sort().reverse();
  console.log("対象:", dates.length, "日 /", Object.values(byDate).reduce((a, b) => a + b.length, 0), "レース\n");

  let got = 0, notFound = 0, noF3 = 0, checked = 0;
  let badOrder = 0, badSet = 0, recovered = 0, okOrder = 0;
  const orderBad = [], setBad = [];

  for (let i = 0; i < dates.length; i++) {
    const d8 = dates[i];
    const url = `https://keirin.kdreams.jp/harailist/${d8.slice(0, 4)}/${d8.slice(4, 6)}/${d8.slice(6, 8)}/`;
    const html = await get(url);
    if (!html) { console.log("  " + d8 + ": 取得失敗(スキップ)"); await sleep(200); continue; }
    const truth = parseHaraiList(html);

    for (const e of byDate[d8]) {
      checked++;
      const t = truth[e.place + "_" + e.raceNo];
      if (!t) { notFound++; continue; }

      // ② 着順の検算 — ページの2車単「1着-2着」が唯一の正解
      if (t.p2first != null && e.f != null && e.s != null) {
        if (e.f !== t.p2first || e.s !== t.p2second) {
          badOrder++;
          if (orderBad.length < 20) orderBad.push(`${e.date} ${e.place} ${e.raceNo}  保存${e.f}-${e.s}  ページ${t.p2first}-${t.p2second}`);
          if (APPLY) { e.f = t.p2first; e.s = t.p2second; }
        } else okOrder++;
      }

      // ③ 3連複の組み合わせ検算 + ④ 3着の復元
      if (t.f3) {
        if (e.t != null) {
          const mine = [e.f, e.s, e.t].filter((x) => x != null).sort((a, b) => a - b);
          if (!same(mine, t.f3)) {
            badSet++;
            if (setBad.length < 20) setBad.push(`${e.date} ${e.place} ${e.raceNo}  保存${mine.join("=")}  ページ${t.f3.join("=")}`);
          }
        } else if (t.p2first != null) {
          // 3着 = 3連複の3車から、2車単の2車を除いた残り
          const rest = t.f3.filter((c) => c !== t.p2first && c !== t.p2second);
          if (rest.length === 1) { recovered++; if (APPLY) e.t = rest[0]; }
        }
        // ① 3連複配当を追記
        if (APPLY) e.p3fpay = t.p3fpay;
        got++;
      } else noF3++;
    }

    if ((i + 1) % 20 === 0) {
      console.log(`  [${i + 1}/${dates.length}] ${d8}  3連複取得${got} / 着順不一致${badOrder} / 組合せ不一致${badSet} / 3着復元${recovered}`);
      if (APPLY) fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify(hist));
    }
    await sleep(200);
  }

  if (APPLY) fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify(hist));

  console.log("\n============ 結果 ============");
  console.log("検査:", checked, "件");
  console.log("  3連複を取得:", got, "件");
  console.log("  3連複が読めず:", noF3, "件");
  console.log("  払戻ページに該当なし:", notFound, "件");
  console.log("\n【着順の検算】ページの2車単と突合");
  console.log("  一致:", okOrder, "件");
  console.log("  不一致:", badOrder, "件  ← 着順が壊れていた確証");
  orderBad.forEach((s) => console.log("    " + s));
  if (badOrder > orderBad.length) console.log(`    …ほか ${badOrder - orderBad.length}件`);
  console.log("\n【組み合わせの検算】3連複の3車と突合");
  console.log("  不一致:", badSet, "件");
  setBad.forEach((s) => console.log("    " + s));
  if (badSet > setBad.length) console.log(`    …ほか ${badSet - setBad.length}件`);
  console.log("\n  3着を復元できた:", recovered, "件");
  console.log(APPLY ? "\n→ 書き込み済み。verify.js を回して確認してください" : "\n→ 書き込んでいません。内容に納得したら --apply を付けて実行してください");
})();
