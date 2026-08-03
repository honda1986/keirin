// ============================================================
// 汚染データ掃除(強化版): 別日の結果が誤って紐付いた本日エントリを除去する。
// 判定: 本日の払戻ページを取得し、各本日エントリの着順(f-s-t)が
//        今日の実際の結果と一致するか照合。一致しない/存在しないものを削除。
// これにより「7/20の結果が7/21に紐付いた」ような汚染を確実に除去できる。
// node cleanup.js
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
    if (!res.ok) throw new Error(res.status + " " + url);
    return await res.text();
  } finally { clearTimeout(t); }
}
// results.js / fixpay.js / sanpuku.js と同一のパーサーに統一(2026-07-29)。
// 旧版は1本の正規表現で order→refund を通し読みしており、次の2点で壊れていた:
//   ① 高額配当は <span class="attention">58,560</span> と囲まれるため一致せず、
//      その行ごと読めない → truth に載らない → 正常なレースを「結果なし」で削除していた
//   ② 複式のフィルタが無く、3連複を3連単として読んで「着順不一致=汚染」と誤判定していた
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
      if (syms.length !== cars.length - 1) continue;
      if (syms.some((z) => z.includes("=") || z.includes("＝"))) continue;
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
  // 本日と、念のため直近数日を検証対象にする(連日開催の汚染は複数日に及ぶ可能性)
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const checkDates = [];
  for (let i = 0; i < 3; i++) {
    const dt = new Date(jst.getTime() - i * 86400000);
    checkDates.push(dt.toISOString().slice(0, 10).replace(/-/g, ""));
  }
  console.log("検証対象日:", checkDates.join(", "));

  // 各日の正しい結果を取得
  const truth = {}; // "YYYYMMDD_場_nR" -> {first,second,third,p2first,p2second}
  const skipDates = new Set(); // 取得に失敗した日。この日のレースは一切削除しない
  for (const d8 of checkDates) {
    const [y, mo, d] = [d8.slice(0, 4), d8.slice(4, 6), d8.slice(6, 8)];
    try {
      const html = await get(`https://keirin.kdreams.jp/harailist/${y}/${mo}/${d}/`);
      const day = parseHaraiList(html);
      for (const [k, v] of Object.entries(day)) if (v.first != null) truth[d8 + "_" + k] = v;
      console.log(d8, "→ 確定", Object.keys(day).length, "レース");
    } catch (e) {
      // 旧版はここで checkDates.splice() していたが、for...of で回している配列を
      // 途中で縮めるため、後続の日付が1つ飛ばされていた。除外リストに積む方式に変更。
      console.error(d8, "取得失敗(この日はスキップ=削除しない):", e.message);
      skipDates.add(d8);
    }
  }

  const before = hist.entries.length;
  let removed = 0, filled = 0, noResult = 0;
  const target = hist.entries.filter((e) => checkDates.includes(e.date) && !skipDates.has(e.date)).length;

  hist.entries = hist.entries.filter((e) => {
    if (!checkDates.includes(e.date)) return true;   // 検証対象外の日はそのまま
    if (skipDates.has(e.date)) return true;          // 取得に失敗した日は触らない
    const key = e.date + "_" + e.place + "_" + e.raceNo;
    const tr = truth[key];

    // 【変更】結果が見つからない場合でも削除しない(2026-07-29)。
    // 旧版はここで削除していたが、原因のほとんどは「まだ確定していない」か
    // 「パーサーが読めなかった」であって汚染ではない。高配当の行が読めなかった
    // だけで正常なレースを消していたため、報告のみに変更した。
    if (!tr) { noResult++; return true; }

    // 1着・2着はページの2車単の並びが唯一の正解。ここが食い違うのは本物の汚染。
    if (tr.p2first != null && e.f != null && e.s != null) {
      if (e.f !== tr.p2first || e.s !== tr.p2second) {
        console.log("削除(1-2着が不一致=汚染):", e.date, e.place, e.raceNo,
          `保存${e.f}-${e.s} / 正${tr.p2first}-${tr.p2second}`);
        removed++; return false;
      }
    }
    // 3着は「両方とも値がある場合だけ」比較する。
    // 保存側が null なのは results.js が3連単を読めなかっただけなので、削除せず埋める。
    if (tr.third != null) {
      if (e.t == null) { e.t = tr.third; if (e.p3pay == null && tr.p3pay != null) e.p3pay = tr.p3pay; filled++; }
      else if (e.t !== tr.third) {
        console.log("削除(3着が不一致=汚染):", e.date, e.place, e.raceNo, `保存${e.t} / 正${tr.third}`);
        removed++; return false;
      }
    }
    return true;
  });

  // 【安全装置】検証対象の3割超を消そうとしたら、書き込まずに中止する。
  // 過去に一度の実行で数千件を失っているため、異常な削除量は事故とみなす。
  if (target > 0 && removed / target > 0.3) {
    console.error("\n中止: 検証対象" + target + "件中" + removed + "件を削除しようとしました(3割超)。");
    console.error("パーサーかページ側の異常が疑われます。history.json は書き換えていません。");
    process.exit(1);
  }

  fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify(hist));
  console.log("\n掃除完了:", removed, "件削除 /", filled, "件の3着を補完 /",
    noResult, "件は結果が読めず(削除せず据え置き)");
  console.log("残り", hist.entries.length, "件(元" + before + ")");
})();
