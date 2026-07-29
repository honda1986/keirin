// ============================================================
// diagharai.js — 払戻ページの読み取りを1行ずつ点検する
//
// results.js / fixpay.js / sanpuku.js が使っているパーサーと同じ手順をなぞり、
// 各行を「採用したか / 捨てたか / 捨てた理由」まで表示する。
// 取りこぼしたレースが、ページに載っていないのか、こちらが捨てているのかを切り分ける。
//
// 読み取り専用。history.json には一切触れない。ネットは払戻ページを読むだけ。
//
// 使い方:
//   node diagharai.js                    … 今日(JST)のページを点検
//   node diagharai.js 20260729           … 日付を指定
//   node diagharai.js 20260729 広島 4     … そのレースの生HTMLを表示(原因を目で見る)
// ============================================================
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

async function get(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: ctrl.signal });
    if (!res.ok) { console.error("HTTP", res.status); return null; }
    return await res.text();
  } catch (e) { console.error("取得失敗:", e.message); return null; }
  finally { clearTimeout(t); }
}

(async () => {
  const args = process.argv.slice(2);
  const d8 = (args[0] && /^\d{8}$/.test(args[0]))
    ? args[0]
    : new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
  const wantVenue = args[1] || null;
  const wantRace = args[2] || null;

  const url = `https://keirin.kdreams.jp/harailist/${d8.slice(0, 4)}/${d8.slice(4, 6)}/${d8.slice(6, 8)}/`;
  console.log("点検対象:", url, "\n");
  const html = await get(url);
  if (!html) return;
  console.log("HTMLサイズ:", html.length, "文字");

  // ---- ページ全体で「○R」のセルがいくつあるか(パーサーを通す前の素の数)----
  const allRaceCells = [...html.matchAll(/class="race"[^>]*>\s*(\d{1,2})R/g)].length;
  console.log("ページ全体の race セル:", allRaceCells, "個\n");

  // ---- results.js と同じブロック分割 ----
  const parts = html.split(/([぀-ヿ一-龥]{2,5})競輪/);
  const venueBlocks = {};
  for (let i = 1; i < parts.length; i += 2) {
    const v = parts[i];
    (venueBlocks[v] = venueBlocks[v] || []).push(parts[i + 1] || "");
  }
  const dupVenues = Object.entries(venueBlocks).filter(([, b]) => b.length > 1);
  if (dupVenues.length) {
    console.log("※ 同じ場名が複数ブロックに分かれています(ナビ等に場名が出ていると起きる):");
    for (const [v, b] of dupVenues) console.log("   " + v + ": " + b.length + "ブロック");
    console.log("");
  }

  const REASONS = {};
  const bump = (r) => { REASONS[r] = (REASONS[r] || 0) + 1; };
  const races = {};   // "場_NR" -> { p3:bool, p2:bool, f3:bool, rows:[] }

  for (const [venue, blocks] of Object.entries(venueBlocks)) {
    for (const block of blocks) {
      const heads = [];
      const raceRe = /class="race"[^>]*>\s*(\d{1,2})R/g;
      let hm;
      while ((hm = raceRe.exec(block))) heads.push({ pos: hm.index, rno: hm[1] });

      for (let k = 0; k < heads.length; k++) {
        const segEnd = k + 1 < heads.length ? heads[k + 1].pos : Math.min(block.length, heads[k].pos + 1500);
        const seg = block.slice(heads[k].pos, segEnd);
        const key = venue + "_" + heads[k].rno + "R";
        const R = (races[key] = races[key] || { p3: false, p2: false, f3: false, rows: [] });

        const payM = seg.match(/class="refund"[^>]*>\s*([\d,]+)/);
        const ordM = seg.match(/class="order"([\s\S]*?)<\/td>/);
        if (!payM) { R.rows.push(["-", "-", "-", "捨:配当セルなし"]); bump("配当セルなし"); continue; }
        if (!ordM) { R.rows.push(["-", "-", "-", "捨:着順セルなし"]); bump("着順セルなし"); continue; }

        const chunk = ordM[1];
        const pay = +payM[1].replace(/,/g, "");
        const cars = [...chunk.matchAll(/class="n(\d)"[^>]*>\s*(\d)\s*</g)].map((x) => +x[2]);
        const syms = [...chunk.matchAll(/class="symbol"[^>]*>([\s\S]{0,8}?)<\//g)].map((x) => x[1]);
        const carsS = cars.join(",") || "なし";
        const symsS = syms.length ? JSON.stringify(syms) : "なし";

        if (!cars.length) { R.rows.push([carsS, symsS, pay, "捨:車番が読めない"]); bump("車番が読めない"); continue; }
        if (!pay) { R.rows.push([carsS, symsS, pay, "捨:配当が0"]); bump("配当が0"); continue; }
        if (syms.length !== cars.length - 1) {
          R.rows.push([carsS, symsS, pay, `捨:記号${syms.length}個(車${cars.length}なので${cars.length - 1}個必要)`]);
          bump("記号の個数が合わない"); continue;
        }
        const fuku = syms.some((s) => s.includes("=") || s.includes("＝"));
        if (cars.length === 3 && !fuku) { R.p3 = true; R.rows.push([carsS, symsS, pay, "採用:3連単"]); bump("採用:3連単"); }
        else if (cars.length === 3 && fuku) { R.f3 = true; R.rows.push([carsS, symsS, pay, "採用:3連複"]); bump("採用:3連複"); }
        else if (cars.length === 2 && !fuku) { R.p2 = true; R.rows.push([carsS, symsS, pay, "採用:2車単"]); bump("採用:2車単"); }
        else { R.rows.push([carsS, symsS, pay, "捨:複式2車(2車複/ワイド)"]); bump("複式2車"); }
      }
    }
  }

  // ---- 場ごとの取得状況 ----
  console.log("===== 場ごとの取得状況 =====");
  console.log("(3=3連単 2=2車単 複=3連複 / ×はそのレースで何も採用できず)\n");
  const byVenue = {};
  for (const [key, R] of Object.entries(races)) {
    const [v, r] = key.split("_");
    (byVenue[v] = byVenue[v] || []).push({ rno: +r.replace("R", ""), R });
  }
  const broken = [];
  for (const v of Object.keys(byVenue).sort()) {
    const list = byVenue[v].sort((a, b) => a.rno - b.rno);
    const cells = list.map(({ rno, R }) => {
      const tag = (R.p3 ? "3" : "") + (R.p2 ? "2" : "") + (R.f3 ? "複" : "");
      if (!R.p3 && !R.p2) broken.push({ v, rno, R });
      return rno + "R[" + (tag || "×") + "]";
    });
    console.log("  " + v.padEnd(5) + " " + cells.join(" "));
    // 番号の飛びを検出。ここで抜けているレースは「こちらが捨てた」のではなく
    // 「ページ側に行が見つからない」ケース(セルの書式違い or 未掲載)。
    const nums = list.map((x) => x.rno);
    const gaps = [];
    for (let n = Math.min(...nums); n <= Math.max(...nums); n++) if (!nums.includes(n)) gaps.push(n + "R");
    if (gaps.length) console.log("        ↑ 番号が飛んでいます: " + gaps.join(" ") + " ← ページ上で race セルが見つからない");
  }

  console.log("\n===== 行の内訳(全体) =====");
  for (const [k, n] of Object.entries(REASONS).sort((a, b) => b[1] - a[1])) {
    console.log("  " + String(n).padStart(5) + "  " + k);
  }

  // ---- 何も取れなかったレースの詳細 ----
  console.log("\n===== 着順が取れなかったレース:", broken.length, "件 =====");
  for (const { v, rno, R } of broken.slice(0, 10)) {
    console.log("\n  ▼ " + v + " " + rno + "R  (検出した行 " + R.rows.length + "本)");
    for (const [c, s, p, why] of R.rows) {
      console.log("     車[" + c + "] 記号" + s + " 配当" + p + "  → " + why);
    }
  }
  if (!broken.length) console.log("  ありません(全レースで着順を取得できています)");

  // ---- 生HTMLの表示 ----
  if (wantVenue && wantRace) {
    console.log("\n===== 生HTML: " + wantVenue + " " + wantRace + "R =====");
    const blocks = venueBlocks[wantVenue];
    if (!blocks) { console.log("  その場名のブロックがありません。場名の表記を確認してください。"); return; }
    let shown = false;
    for (const block of blocks) {
      const heads = [];
      const raceRe = /class="race"[^>]*>\s*(\d{1,2})R/g;
      let hm;
      while ((hm = raceRe.exec(block))) heads.push({ pos: hm.index, rno: hm[1] });
      for (let k = 0; k < heads.length; k++) {
        if (heads[k].rno !== String(+wantRace)) continue;
        const segEnd = k + 1 < heads.length ? heads[k + 1].pos : Math.min(block.length, heads[k].pos + 1500);
        console.log("\n--- 区間 " + (k + 1) + " (" + (segEnd - heads[k].pos) + "文字) ---");
        console.log(block.slice(heads[k].pos, segEnd).replace(/\s+/g, " ").slice(0, 1200));
        shown = true;
      }
    }
    if (!shown) console.log("  そのレース番号の race セルがブロック内に見つかりません。\n  → ページ側に行が無いか、セルの書式が想定と違います。");
  }
})();
