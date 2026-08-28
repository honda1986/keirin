// ============================================================
// diagfetch.js — Gamboo が Actions からどう見えているかを確かめる(読み取り専用)
//
// 全レース取得が0件になった原因を切り分ける:
//   403/429 → ブロックされている
//   404     → URLの形が変わった
//   200だが目印なし → ページ構造の変更
//   200で目印あり   → fetch.js 側のロジックの問題
//
// あわせて robots.txt の中身も見る(サイトが自動取得をどう扱っているか)。
//
// 使い方: node diagfetch.js            … 今日
//         node diagfetch.js 2026-08-28
// ============================================================
const argv = process.argv.slice(2);
const D = argv.find((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)) ||
  new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const COMPACT = D.replace(/-/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// いま fetch.js が名乗っている名前と、ふつうのブラウザの名前を比べる
const UA_BOT = "Mozilla/5.0 (compatible; GambooKeirinFetcher/2.0; +https://gamboo.jp/)";
const UA_WEB = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function probe(url, ua) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": ua, "Accept-Language": "ja",
      "Accept": "text/html,application/xhtml+xml,*/*;q=0.8" }, signal: c.signal, redirect: "follow" });
    const body = await r.text();
    return { status: r.status, finalUrl: r.url, len: body.length, body,
      server: r.headers.get("server") || "", ct: r.headers.get("content-type") || "" };
  } catch (e) {
    return { status: 0, err: e.name === "AbortError" ? "タイムアウト" : e.message, len: 0, body: "" };
  } finally { clearTimeout(t); }
}
const toText = (h) => String(h).replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

const MARKS = ["基本出走データ", "競輪", "出走", "得点", "並び"];

function show(label, url, r) {
  console.log("\n■ " + label);
  console.log("   " + url);
  if (!r.status) { console.log("   → 取得できず: " + r.err); return; }
  console.log("   HTTP " + r.status + " / " + r.len.toLocaleString() + "バイト" +
    (r.ct ? " / " + r.ct.split(";")[0] : "") + (r.server ? " / server:" + r.server : ""));
  if (r.finalUrl && r.finalUrl !== url) console.log("   ★転送された → " + r.finalUrl);
  const t = toText(r.body);
  const ok = MARKS.filter((m) => t.includes(m));
  console.log("   目印: " + (ok.length ? ok.join(" ") : "★ひとつも無い★"));
  console.log("   冒頭: " + t.slice(0, 220));
}

(async () => {
  console.log("========================================");
  console.log(" Gamboo 診断  対象日 " + D);
  console.log("========================================");

  // robots.txt が自動取得をどう言っているか
  const rb = await probe("https://gamboo.jp/robots.txt", UA_WEB);
  console.log("\n■ robots.txt");
  console.log("   HTTP " + rb.status + " / " + rb.len + "バイト");
  console.log("   ---- 中身(先頭600字)----");
  console.log(rb.body ? rb.body.slice(0, 600) : "(空)");
  console.log("   ------------------------");
  await sleep(500);

  const targets = [
    ["予想トップ", "https://gamboo.jp/keirin/yoso/"],
    ["日付指定", "https://gamboo.jp/keirin/yoso/?rdt=" + D],
    ["レース直指定(ハイフン日付)", "https://gamboo.jp/keirin/yoso/?rdt=" + D + "&pid=22&rno=1"],
    ["レース直指定(数字日付)", "https://gamboo.jp/keirin/yoso/?rdt=" + COMPACT + "&pid=22&rno=1"],
  ];

  console.log("\n\n########## A. いまの fetch.js と同じ名乗り ##########");
  console.log("(User-Agent: " + UA_BOT + ")");
  let best = "";
  for (const [l, u] of targets) { const r = await probe(u, UA_BOT); show(l, u, r); if (r.len > best.length) best = r.body; await sleep(700); }

  console.log("\n\n########## B. ふつうのブラウザと同じ名乗り ##########");
  console.log("(比較のため。Aだけ失敗してBが成功するなら、名乗りで弾かれている)");
  for (const [l, u] of targets) { const r = await probe(u, UA_WEB); show(l, u, r); if (r.len > best.length) best = r.body; await sleep(700); }

  if (best) {
    console.log("\n\n########## C. 取れたページの中のリンク ##########");
    const s = new Set();
    for (const m of best.matchAll(/\/keirin\/[a-z]*\/?\?[^"'\s>]{0,110}/gi)) s.add(m[0]);
    const ls = [...s];
    console.log(ls.length ? ls.slice(0, 15).join("\n") : "レースらしきリンクは見つからない");
    console.log("\npid= の出現数: " + (best.match(/pid=/g) || []).length + " / rno= の出現数: " + (best.match(/rno=/g) || []).length);
  }
  console.log("\n========================================");
  console.log(" このログを丸ごと貼ってください");
  console.log("========================================");
})();
