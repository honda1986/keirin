// ============================================================
// gradefill.js v2 — 既存 history に「レース種別(grade)」を後付けする(高速・進捗可視)
//
// v1からの改善:
//  - タイムアウトを5秒に短縮(未開催pidで固まらない)
//  - pid探索を並列化 + 1日目で全場を確定させ以降は使い回し
//  - 進捗を逐次 flush して GitHub Actions のログに即出す
//  - 最初の1日で1件も取れなければ「過去ページ非公開」と判断して即中断
//
// 使い方: node gradefill.js [days]  (省略時30)
// ============================================================
const fs = require("fs");
const path = require("path");
const dir = __dirname;
const { TRACK_NAMES } = require("./bankdata.js");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const VENUE_PIDS = [11,12,13,21,22,23,24,25,26,27,28,31,32,34,35,36,37,38,42,43,44,45,46,47,48,51,53,54,55,56,61,62,63,71,73,74,75,81,83,84,85,86,87];
const TIMEOUT_MS = 5000;   // 短め。未開催pidで固まらない
const GAP_MS = 120;
const CONC = 4;
const DEADLINE_MS = 5.2 * 3600 * 1000;
const startedAt = Date.now();

// ログを即時出力(Actionsで見えるように)
function log(...a) { console.log(...a); if (process.stdout.write) process.stdout.write(""); }

async function get(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) { return null; } finally { clearTimeout(t); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractGrade(html) {
  if (!html) return "";
  const km = html.match(/([SＳAＡLＬ])\s*級/);
  const tm = html.match(/(チャレンジ予選|チ予選|ガ予選|予選|準決勝|決勝|ガ一般|一般|特選|優秀|ヤンググランプリ)/);
  if (!km && !tm) return "";
  const k = km ? km[1].replace("Ｓ", "S").replace("Ａ", "A").replace("Ｌ", "L") + "級" : "";
  return (k + " " + (tm ? tm[1] : "")).trim();
}
function extractPlace(html) {
  if (!html) return "";
  let best = "", idx = Infinity;
  for (const n of TRACK_NAMES) { const i = html.indexOf(n); if (i !== -1 && i < idx) { idx = i; best = n; } }
  return best;
}

// 並列マップ(同時実行数を制限)
async function pmap(items, fn, conc) {
  let i = 0;
  const workers = Array.from({ length: Math.min(conc, items.length || 1) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
      await sleep(GAP_MS);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const days = Math.min(120, parseInt(process.argv[2] || "30", 10) || 30);
  const hist = JSON.parse(fs.readFileSync(path.join(dir, "history.json"), "utf8"));
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const fromD8 = new Date(jst.getTime() - days * 86400000).toISOString().slice(0, 10).replace(/-/g, "");

  const targets = hist.entries.filter((e) => !e.grade && e.date >= fromD8 && e.place && e.raceNo);
  const byDate = {};
  for (const e of targets) (byDate[e.date] = byDate[e.date] || []).push(e);
  const dates = Object.keys(byDate).sort().reverse();
  log("対象:", targets.length, "レース /", dates.length, "日 (過去" + days + "日)");
  if (!targets.length) { log("対象なし。完了。"); return; }

  // ---- 1) pid↔場名の対応表を作る(最新日で1回だけ、並列探索) ----
  const pidByPlace = {};
  const probeDate = dates[0];
  const rdt0 = probeDate.slice(0, 4) + "-" + probeDate.slice(4, 6) + "-" + probeDate.slice(6, 8);
  log("pid探索開始 (" + rdt0 + ", 43場を並列チェック)...");
  let probed = 0;
  await pmap(VENUE_PIDS, async (pid) => {
    const html = await get(`https://gamboo.jp/keirin/yoso/?rdt=${rdt0}&pid=${pid}&rno=1`);
    probed++;
    if (probed % 10 === 0) log("  探索中... " + probed + "/43");
    const pl = extractPlace(html);
    if (pl && pidByPlace[pl] == null) pidByPlace[pl] = pid;
  }, CONC);
  const found = Object.keys(pidByPlace);
  log("pid判明:", found.length, "場 →", found.map((p) => p + "=" + pidByPlace[p]).join(" ") || "(なし)");

  if (!found.length) {
    log("\n⚠ 場コードが1つも判明しませんでした。");
    log("  → Gambooの過去日ページが非公開になっている可能性が高いです。");
    log("  → 過去分の種別後付けは断念し、今後の新規収集分で貯めてください。");
    return;
  }

  // ---- 2) 各日・各レースのgradeを取得 ----
  let filled = 0, miss = 0, dayIdx = 0;
  for (const d8 of dates) {
    if (Date.now() - startedAt > DEADLINE_MS) { log("時間切れのため中断"); break; }
    dayIdx++;
    const rdt = d8.slice(0, 4) + "-" + d8.slice(4, 6) + "-" + d8.slice(6, 8);
    const list = byDate[d8].filter((e) => pidByPlace[e.place] != null);
    const skipped = byDate[d8].length - list.length;
    let dayFill = 0;
    await pmap(list, async (e) => {
      const rno = parseInt(e.raceNo) || 0;
      if (!rno) { miss++; return; }
      const html = await get(`https://gamboo.jp/keirin/yoso/?rdt=${rdt}&pid=${pidByPlace[e.place]}&rno=${rno}`);
      const g = extractGrade(html);
      if (g) { e.grade = g; filled++; dayFill++; } else miss++;
    }, CONC);
    log(`[${dayIdx}/${dates.length}] ${rdt} → 付与 ${dayFill}/${byDate[d8].length}` + (skipped ? ` (pid不明でスキップ${skipped})` : ""));

    // 最初の日で1件も取れなければ以降も無駄 → 中断
    if (dayIdx === 1 && dayFill === 0) {
      log("\n⚠ 最新日で1件も種別が取れませんでした。過去ページ非公開の可能性が高いため中断します。");
      break;
    }
    // 途中経過を保存(長時間実行でも成果が残る)
    if (dayIdx % 5 === 0) {
      fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify(hist));
      log("  (途中保存: 累計付与 " + filled + "件)");
    }
  }

  fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify(hist));
  log("\n完了: 種別付与", filled, "件 / 取得できず", miss, "件");
  if (filled) log("→ 次に「評価値」と「シミュレーター」を実行すると種別分析・種別フィルタが有効になります");
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
