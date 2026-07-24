// ============================================================
// gradefill.js — 既存 history エントリに「レース種別(grade)」だけを高速で後付けする
// 仕組み:
//  - history.json にある「開催実績のあるレース」のURLだけを取得(総当たりしない)
//  - 場コード(pid)は初回に rno=1 ページを探索して場名と対応付け、以降の日で使い回す
//  - ページ先頭から「Ｓ級 準決勝」等の種別だけを正規表現で抽出(予想計算はしない)
// 使い方: node gradefill.js [days]   (省略時30日)
// ============================================================
const fs = require("fs");
const path = require("path");
const dir = __dirname;
const { TRACK_NAMES } = require("./bankdata.js");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const VENUE_PIDS = [11,12,13,21,22,23,24,25,26,27,28,31,32,34,35,36,37,38,42,43,44,45,46,47,48,51,53,54,55,56,61,62,63,71,73,74,75,81,83,84,85,86,87];
const GAP_MS = 250;          // リクエスト間隔
const CONC = 3;              // 同時接続数
const DEADLINE_MS = 5.5 * 3600 * 1000;
const startedAt = Date.now();

async function get(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(res.status + "");
    return await res.text();
  } finally { clearTimeout(t); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ページ本文から種別を抽出(例: "Ｓ級 準決勝" / "Ａ級 チ予選" / "Ｌ級 ガ一般")
function extractGrade(html) {
  const km = html.match(/([SＳAＡLＬ])\s*級/);
  const tm = html.match(/(チャレンジ予選|チ予選|ガ予選|予選|準決勝|決勝|ガ一般|一般|特選|優秀|チャレンジ|ヤンググランプリ|ガールズ)/);
  if (!km && !tm) return "";
  const k = km ? km[1].replace("Ｓ", "S").replace("Ａ", "A").replace("Ｌ", "L") + "級" : "";
  return (k + " " + (tm ? tm[1] : "")).trim();
}
// ページ内の場名(pid→場名対応の探索用)
function extractPlace(html) {
  let best = "", idx = Infinity;
  for (const n of TRACK_NAMES) { const i = html.indexOf(n); if (i !== -1 && i < idx) { idx = i; best = n; } }
  return best;
}

async function main() {
  const days = Math.min(120, parseInt(process.argv[2] || "30", 10) || 30);
  const hist = JSON.parse(fs.readFileSync(path.join(dir, "history.json"), "utf8"));
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const fromD8 = new Date(jst.getTime() - days * 86400000).toISOString().slice(0, 10).replace(/-/g, "");

  // grade未設定の対象を日付ごとにまとめる
  const targets = hist.entries.filter((e) => !e.grade && e.date >= fromD8 && e.place && e.raceNo);
  const byDate = {};
  for (const e of targets) (byDate[e.date] = byDate[e.date] || []).push(e);
  const dates = Object.keys(byDate).sort().reverse();
  console.log("種別後付け対象:", targets.length, "レース /", dates.length, "日(過去" + days + "日)");
  if (!targets.length) { console.log("対象なし。完了。"); return; }

  const pidByPlace = {}; // 場名 → pid(全日共通で使い回す)
  let filled = 0, failed = 0;

  for (const d8 of dates) {
    if (Date.now() - startedAt > DEADLINE_MS) { console.log("deadline"); break; }
    const rdt = d8.slice(0, 4) + "-" + d8.slice(4, 6) + "-" + d8.slice(6, 8);
    const dayEntries = byDate[d8];
    const needPlaces = [...new Set(dayEntries.map((e) => e.place))];

    // 1) この日に必要な場のpidが未判明なら、未知pidの rno=1 を順に叩いて場名を対応付け
    const unknown = needPlaces.filter((pl) => pidByPlace[pl] == null);
    if (unknown.length) {
      for (const pid of VENUE_PIDS) {
        if (!unknown.some((pl) => pidByPlace[pl] == null)) break; // 全部判明したら打ち切り
        if (Object.values(pidByPlace).includes(pid)) continue;    // 既に別の場と判明済み
        try {
          const html = await get(`https://gamboo.jp/keirin/yoso/?rdt=${rdt}&pid=${pid}&rno=1`);
          const pl = extractPlace(html);
          if (pl) pidByPlace[pl] = pid;
        } catch (e) { /* 未開催pidはスキップ */ }
        await sleep(GAP_MS);
      }
      console.log(rdt, "pid探索:", needPlaces.map((pl) => pl + "=" + (pidByPlace[pl] ?? "?")).join(" "));
    }

    // 2) 実在レースのURLだけ取得してgradeを埋める(同時CONC本)
    const queue = dayEntries.filter((e) => pidByPlace[e.place] != null);
    let qi = 0;
    const worker = async () => {
      while (qi < queue.length) {
        const e = queue[qi++];
        const rno = parseInt(e.raceNo) || 0;
        if (!rno) { failed++; continue; }
        try {
          const html = await get(`https://gamboo.jp/keirin/yoso/?rdt=${rdt}&pid=${pidByPlace[e.place]}&rno=${rno}`);
          const g = extractGrade(html);
          if (g) { e.grade = g; filled++; } else failed++;
        } catch (err) { failed++; }
        await sleep(GAP_MS);
      }
    };
    await Promise.all(Array.from({ length: CONC }, worker));
    console.log(rdt, "→ 種別付与", queue.filter((e) => e.grade).length, "/", dayEntries.length, "件");
  }

  fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify(hist));
  console.log("\n完了: 種別付与", filled, "件 / 失敗", failed, "件");
  console.log("→ この後シミュレーターを実行すると、種別フィルタ(予選のみ/決勝除外など)が評価されます");
}

main().catch((e) => { console.error(e); process.exit(1); });
