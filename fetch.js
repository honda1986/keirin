// ============================================================
// Gamboo 競輪予想情報を巡回し、本日の全レースのスジ期待度を算出
// races.json に書き出す (GitHub Actions / Node.js)
// ============================================================

"use strict";

const fs = require("fs");
const path = require("path");

const { parseCard, predict, sujiExpect } = require("./engine.js");
const { T, TRACK_NAMES } = require("./bankdata.js");

// ------------------------------------------------------------
// 学習補正
// ------------------------------------------------------------

let LEARN_W = null;
try {
  const weightPath = path.join(__dirname, "weights.json");
  LEARN_W = JSON.parse(fs.readFileSync(weightPath, "utf8"));
  console.log("学習補正を適用:", LEARN_W.updatedAt || "(updatedAtなし)");
} catch {
  console.log("学習補正なし");
}

// ------------------------------------------------------------
// Gamboo
// ------------------------------------------------------------

const BASE_URL = "https://gamboo.jp";
const INDEX_URLS = [
  `${BASE_URL}/keirin/yoso/`,
  `${BASE_URL}/keirin/yosou/`,
  `${BASE_URL}/keirin/`,
];

// 現在確認できるGambooの競輪場pid。サイトからの自動発見を優先し、
// 発見できない場合だけこの一覧をフォールバックとして使う。
const FALLBACK_PIDS = [
  11, 12, 13,
  21, 22, 23, 24, 25, 26, 27, 28,
  31, 32, 34, 35, 36, 37, 38,
  42, 43, 44, 45, 46, 47, 48,
  51, 53, 54, 55, 56,
  61, 62, 63,
  71, 73, 74, 75,
  81, 83, 84, 85, 86, 87,
];

const UA =
  "Mozilla/5.0 (compatible; GambooKeirinFetcher/2.0; +https://gamboo.jp/)";

const WAIT_MS = 450;
const MAX_RACES = 150;
const MAX_QUEUE = 800;
const FETCH_TIMEOUT = 20000;
const DEADLINE_MS = 14 * 60 * 1000;
const RETRIES = 3;

const startedAt = Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function deadlineReached() {
  return Date.now() - startedAt >= DEADLINE_MS;
}

// ------------------------------------------------------------
// JST日付
// ------------------------------------------------------------

function getJstDate() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return {
    compact: `${y}${m}${d}`,
    dashed: `${y}-${m}-${d}`,
  };
}

// ------------------------------------------------------------
// HTTP
// ------------------------------------------------------------

async function get(url, attempt = 0) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.7,en;q=0.5",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Referer": `${BASE_URL}/keirin/yoso/`,
      },
      redirect: "follow",
      signal: ctrl.signal,
    });

    const html = await res.text();

    if (!res.ok) {
      const retryable = res.status === 408 || res.status === 425 ||
        res.status === 429 || res.status >= 500;

      if (retryable && attempt < RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter)
          ? Math.min(retryAfter * 1000, 10000)
          : 1000 * (attempt + 1);
        console.warn(`HTTP ${res.status}; retry in ${wait}ms: ${url}`);
        await sleep(wait);
        return get(url, attempt + 1);
      }

      throw new Error(`${res.status} ${res.statusText} ${url} body=${html.slice(0, 250)}`);
    }

    if (!html || html.length < 200) {
      throw new Error(`empty response ${url} length=${html.length}`);
    }

    return html;
  } catch (e) {
    if (e.name === "AbortError") {
      if (attempt < RETRIES) {
        const wait = 800 * (attempt + 1);
        console.warn(`timeout; retry in ${wait}ms: ${url}`);
        await sleep(wait);
        return get(url, attempt + 1);
      }
      throw new Error(`timeout ${FETCH_TIMEOUT}ms ${url}`);
    }

    if (attempt < RETRIES && /ECONN|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(String(e.message))) {
      const wait = 800 * (attempt + 1);
      await sleep(wait);
      return get(url, attempt + 1);
    }

    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------
// HTML utility
// ------------------------------------------------------------

function decodeHtml(s) {
  const named = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&nbsp;": " ",
  };

  return String(s)
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/gi, (m) => named[m] || named[m.toLowerCase()] || " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return " "; }
    })
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 10)); } catch { return " "; }
    });
}

function htmlToText(html) {
  let s = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  // Gambooの車番画像。現在もalt="1"、alt="middle point"形式を使用。
  s = s
    .replace(/<img\b[^>]*\balt\s*=\s*["']([^"']*)["'][^>]*>/gi, (_, alt) => {
      const v = decodeHtml(alt).replace(/\s+/g, " ").trim();
      if (/^[1-9]$/.test(v)) return v;
      if (/middle|nakaguro|middle\s*point|・|●|•/i.test(v)) return " ・ ";
      return " ";
    })
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<(br|\/tr|\/td|\/th|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  s = decodeHtml(s);

  return s
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ------------------------------------------------------------
// URL
// ------------------------------------------------------------

function normalizeUrl(href, baseUrl) {
  if (!href) return null;
  href = decodeHtml(href).trim();

  if (/^(?:javascript:|#|mailto:|tel:|data:)/i.test(href)) return null;

  try {
    const u = new URL(href, baseUrl);
    if (!/^https?:$/i.test(u.protocol)) return null;
    if (!/(?:^|\.)gamboo\.jp$/i.test(u.hostname)) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function collectLinks(html, baseUrl) {
  const out = new Set();
  const re = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let m;

  while ((m = re.exec(html))) {
    const u = normalizeUrl(m[1] || m[2] || m[3], baseUrl);
    if (u) out.add(u);
  }

  return [...out];
}

function getUrlParam(url, name) {
  try {
    return new URL(url).searchParams.get(name);
  } catch {
    return null;
  }
}

function isRaceUrl(url) {
  try {
    const u = new URL(url);
    if (!/(?:^|\.)gamboo\.jp$/i.test(u.hostname)) return false;
    if (!/\/keirin\/yoso(?:u)?\/?/i.test(u.pathname)) return false;
    const rno = u.searchParams.get("rno");
    return !!rno && /^\d+$/.test(rno);
  } catch {
    return false;
  }
}

function makeRaceUrl(pid, rdt, rno, dashed = false) {
  const date = dashed ? rdt.dashed : rdt.compact;
  return `${BASE_URL}/keirin/yoso/?pid=${encodeURIComponent(pid)}&rdt=${date}&rno=${rno}`;
}

function makeVenueUrl(pid, rdt, dashed = false) {
  const date = dashed ? rdt.dashed : rdt.compact;
  return `${BASE_URL}/keirin/yoso/?pid=${encodeURIComponent(pid)}&rdt=${date}`;
}

// ------------------------------------------------------------
// 開催場 / レースリンク発見
// ------------------------------------------------------------

function collectVenuePids(html, baseUrl) {
  const pids = new Set();

  for (const url of collectLinks(html, baseUrl)) {
    try {
      const u = new URL(url);
      const pid = u.searchParams.get("pid");
      if (
        pid &&
        /^\d+$/.test(pid) &&
        /\/keirin\/yoso(?:u)?\/?/i.test(u.pathname)
      ) {
        pids.add(pid);
      }
    } catch {}
  }

  // HTML中にリンクがJS/属性として埋め込まれている場合の保険。
  const re = /[?&]pid=(\d+)/gi;
  let m;
  while ((m = re.exec(html))) pids.add(m[1]);

  return [...pids];
}

function collectRaceLinks(html, baseUrl) {
  const out = new Set();

  for (const url of collectLinks(html, baseUrl)) {
    if (isRaceUrl(url)) out.add(url);
  }

  // href以外のHTML属性/JS文字列にURLがある場合も拾う。
  const re =
    /(?:https?:\/\/(?:www\.)?gamboo\.jp)?\/keirin\/yoso(?:u)?\/\?[^"'<> ]*[?&]pid=\d+[^"'<> ]*[?&]rno=\d+[^"'<> ]*/gi;
  let m;

  while ((m = re.exec(html))) {
    const u = normalizeUrl(m[0], baseUrl);
    if (u && isRaceUrl(u)) out.add(u);
  }

  return [...out].slice(0, MAX_QUEUE);
}

// ------------------------------------------------------------
// 並び予想
// ------------------------------------------------------------

function extractNarabi(html, cars) {
  const ni = html.search(/並び予想/);
  if (ni < 0 || !cars?.length) return null;

  const chunk = html.slice(ni, ni + 10000);
  const alts = [];

  const re = /\balt\s*=\s*["']([^"']*)["']/gi;
  let m;
  while ((m = re.exec(chunk))) alts.push(decodeHtml(m[1]));

  const lines = [];
  let cur = [];
  let started = false;

  for (const raw of alts) {
    const a = String(raw).replace(/\s+/g, " ").trim();

    if (/^[1-9]$/.test(a)) {
      cur.push(Number(a));
      started = true;
      continue;
    }

    if (/middle|nakaguro|middle\s*point|・|●|•/i.test(a)) {
      if (cur.length) {
        lines.push(cur);
        cur = [];
      }
      continue;
    }

    if (/←|→|arrow|left|right/i.test(a)) continue;
    if (started) break;
  }

  if (cur.length) lines.push(cur);

  const flat = lines.flat();
  if (flat.length !== cars.length) return null;

  const set = new Set(flat);
  if (set.size !== cars.length) return null;
  if (!cars.every((c) => set.has(c))) return null;

  return lines;
}

// ------------------------------------------------------------
// レースページ判定・補助抽出
// ------------------------------------------------------------

function isRacePage(html) {
  return (
    /基本出走データ/.test(html) &&
    /発走予定/.test(html) &&
    /車\s*番/.test(html)
  );
}

function extractRaceMeta(html, url) {
  const out = {};

  // 現行タイトル例:
  // 8/26 岐阜1R 基本出走データ
  const titleMatch = html.match(
    /<title[^>]*>\s*[^<]*?(\d{1,2})\/(\d{1,2})\s*([^\s<]{2,6}?)\s*(\d{1,2})R\s*基本出走データ/i
  );

  if (titleMatch) {
    out.place = titleMatch[3];
    out.raceNo = `${parseInt(titleMatch[4], 10)}R`;
  }

  // titleが変わった場合の本文フォールバック。
  const text = htmlToText(html);
  const bodyMatch = text.match(
    /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日[^\\n]{0,100}?\s([^\s]+)\s+(\d{1,2})R\s+\d+m/
  );

  if (bodyMatch) {
    if (!out.place) out.place = bodyMatch[4];
    if (!out.raceNo) out.raceNo = `${parseInt(bodyMatch[5], 10)}R`;
  }

  const rno = getUrlParam(url, "rno");
  if (!out.raceNo && rno && /^\d+$/.test(rno)) {
    out.raceNo = `${parseInt(rno, 10)}R`;
  }

  return out;
}

// ------------------------------------------------------------
// レース解析
// ------------------------------------------------------------

function processRace(html, url, races) {
  if (!isRacePage(html)) return false;

  const text = htmlToText(html);
  let p;

  try {
    p = parseCard(text, TRACK_NAMES);
  } catch (e) {
    saveDebug("parseCard", text, url, e);
    return false;
  }

  if (!p || !Array.isArray(p.entries) || p.entries.length < 5) {
    console.error(
      "invalid race data:",
      url,
      "entries=",
      p?.entries?.length ?? 0
    );
    return false;
  }

  const meta = extractRaceMeta(html, url);

  if (!p.place && meta.place) p.place = meta.place;
  if (!p.raceNo && meta.raceNo) p.raceNo = meta.raceNo;

  const cars = p.entries.map((e) => Number(e.car)).filter(Number.isFinite);
  const nb = extractNarabi(html, cars);

  if (nb) {
    p.lines = nb;
    p.narabi = nb.flat();
  }

  if (!p.raceNo) {
    const rno = getUrlParam(url, "rno");
    p.raceNo = rno ? `${parseInt(rno, 10)}R` : "R?";
  }

  const key = `${p.place || "?"}_${p.raceNo || "?"}`;
  if (races.some((x) => x.key === key)) return false;

  const bank = T[p.place];
  if (!bank) console.warn("bank data not found:", p.place, url);

  let r;
  try {
    r = predict(p, bank, p.place, LEARN_W);
  } catch (e) {
    console.error("predict failed:", p.place, p.raceNo, e.message);
    return false;
  }

  let sx = null;
  try {
    sx = sujiExpect(p, r, bank ? bank[10] : null);
  } catch (e) {
    console.error("sujiExpect failed:", p.place, p.raceNo, e.message);
  }

  const posOf = {};
  for (const line of p.lines || []) {
    if (line.length === 1) {
      posOf[line[0]] = 3;
    } else {
      line.forEach((car, i) => {
        posOf[car] = Math.min(i, 2);
      });
    }
  }

  const rankOf = {};
  for (let i = 0; i < (r.scores || []).length; i++) {
    rankOf[r.scores[i].car] = i + 1;
  }

  const riders = p.entries.map((en) => {
    const score = (r.scores || []).find((sc) => sc.car === en.car);
    return [
      en.car,
      en.age || 0,
      parseInt(en.ki, 10) || 0,
      posOf[en.car] ?? 3,
      rankOf[en.car] || 9,
      Number((score?.total || 0).toFixed(1)),
    ];
  });

  races.push({
    key,
    place: p.place,
    raceNo: p.raceNo,
    startTime: p.startTime || "",
    grade: p.grade,
    date: p.date,
    klass: r.klass,
    fLabel: r.fLabel,
    pattern: r.linePattern,
    score: sx ? sx.score : null,
    verdict: sx ? sx.verdict : "対象外",
    reasons: sx ? sx.reasons : ["ガールズ(ライン無し)"],
    marks: (r.marks || [])
      .slice(0, 3)
      .map((mk) => `${mk.mark}${mk.car} ${mk.name}`)
      .join(" / "),
    lines: p.lines || [],
    marksCars: (r.marks || []).map((mk) => mk.car),
    riders,
    gap:
      r.scores && r.scores[1]
        ? Number((r.scores[0].total - r.scores[1].total).toFixed(1))
        : null,
    nishatan: r.bets?.nishatan,
    sanrentan: r.bets?.sanrentan,
    raw: text,
    url,
  });

  console.log(
    "OK:",
    p.place,
    p.raceNo,
    sx ? `${sx.score}%` : "girls",
    "lines=" + JSON.stringify(p.lines || [])
  );

  return true;
}

function saveDebug(kind, text, url, err) {
  const debugPath = path.join(__dirname, `debug-gamboo-${kind}.txt`);
  if (!fs.existsSync(debugPath)) {
    try {
      fs.writeFileSync(
        debugPath,
        `URL: ${url}\nERROR: ${err?.stack || err || ""}\n\n${text}`,
        "utf8"
      );
      console.error("debug saved:", debugPath);
    } catch {}
  }
}

// ------------------------------------------------------------
// 取得
// ------------------------------------------------------------

async function fetchRace(url, races) {
  const html = await get(url);
  return processRace(html, url, races);
}

async function tryRaceVariants(pid, rno, rdt, races) {
  // 現行サイトでは compact / dashed の両方が検索・公開されているため、
  // まずcompact、レース判定できなければdashedを試す。
  const urls = [
    makeRaceUrl(pid, rdt, rno, false),
    makeRaceUrl(pid, rdt, rno, true),
  ];

  for (const url of urls) {
    if (deadlineReached()) return false;

    try {
      await sleep(WAIT_MS);
      const html = await get(url);

      if (!isRacePage(html)) continue;
      if (processRace(html, url, races)) return true;
      return false;
    } catch (e) {
      console.error("race skip:", url, e.message);
    }
  }

  return false;
}

async function discoverPids(rdt) {
  const pids = new Set();

  for (const idx of INDEX_URLS) {
    if (deadlineReached()) break;

    try {
      await sleep(WAIT_MS);
      const html = await get(idx);
      for (const pid of collectVenuePids(html, idx)) pids.add(pid);
      console.log("venue candidates:", idx, [...pids]);
    } catch (e) {
      console.error("index skip:", idx, e.message);
    }
  }

  // 開催場ページへの実リンクが見えない場合、日付付きページを
  // フォールバックpidで直接確認する。
  if (pids.size === 0) {
    console.log("pid自動発見なし。フォールバック一覧を使用します。");
    FALLBACK_PIDS.forEach((pid) => pids.add(String(pid)));
  }

  return [...pids];
}

async function discoverRaceLinks(rdt) {
  const links = new Set();

  for (const idx of INDEX_URLS) {
    if (deadlineReached()) break;

    try {
      await sleep(WAIT_MS);
      const html = await get(idx);
      for (const u of collectRaceLinks(html, idx)) links.add(u);
    } catch (e) {
      console.error("link discovery skip:", idx, e.message);
    }
  }

  // 開催場ページも巡回して1R〜12Rの実リンクを取得。
  const pids = await discoverPids(rdt);

  for (const pid of pids) {
    if (deadlineReached() || links.size >= MAX_QUEUE) break;

    for (const dashed of [false, true]) {
      if (deadlineReached()) break;

      const venueUrl = makeVenueUrl(pid, rdt, dashed);
      try {
        await sleep(WAIT_MS);
        const html = await get(venueUrl);

        for (const u of collectRaceLinks(html, venueUrl)) {
          links.add(u);
          if (links.size >= MAX_QUEUE) break;
        }
      } catch (e) {
        console.error("venue link skip:", venueUrl, e.message);
      }

      if ([...links].some((u) => getUrlParam(u, "pid") === String(pid))) break;
    }
  }

  return [...links].slice(0, MAX_QUEUE);
}

// ------------------------------------------------------------
// main
// ------------------------------------------------------------

async function main() {
  const races = [];
  const rdt = getJstDate();

  console.log("========================================");
  console.log("Gamboo 全レース更新");
  console.log("JST date:", rdt.dashed, "(compact:", rdt.compact + ")");
  console.log("========================================");

  // ----------------------------------------------------------
  // Phase 1: トップページから実際のレースURLを探す
  // ----------------------------------------------------------

  console.log("phase1: 実リンク探索");
  const directLinks = await discoverRaceLinks(rdt);
  console.log("candidate race links:", directLinks.length);

  directLinks.sort((a, b) => {
    const score = (u) =>
      /\/keirin\/yoso(?:u)?\//i.test(u) && getUrlParam(u, "rno") ? 1 : 0;
    return score(b) - score(a);
  });

  const seen = new Set();

  for (const url of directLinks) {
    if (deadlineReached() || races.length >= MAX_RACES) break;
    if (seen.has(url)) continue;
    seen.add(url);

    try {
      await sleep(WAIT_MS);
      const html = await get(url);
      if (isRacePage(html)) processRace(html, url, races);
    } catch (e) {
      console.error("direct race skip:", url, e.message);
    }
  }

  console.log("phase1 done:", races.length, "races");

  // ----------------------------------------------------------
  // Phase 2: pid × R番号を日付形式2種類で直接取得
  // ----------------------------------------------------------

  if (!deadlineReached() && races.length < MAX_RACES) {
    console.log("phase2: pid×rno直接取得");

    const pids = await discoverPids(rdt);

    for (const pid of pids) {
      if (deadlineReached() || races.length >= MAX_RACES) break;

      let consecutiveMiss = 0;

      for (let rno = 1; rno <= 12; rno++) {
        if (deadlineReached() || races.length >= MAX_RACES) break;

        const before = races.length;
        try {
          await tryRaceVariants(pid, rno, rdt, races);
        } catch (e) {
          console.error(`pid=${pid} rno=${rno}:`, e.message);
        }

        if (races.length === before) {
          consecutiveMiss++;
        } else {
          consecutiveMiss = 0;
        }

        // 開催場で1R/2Rが無い場合は早期終了。
        if (rno <= 2 && consecutiveMiss >= 2) break;
        if (consecutiveMiss >= 3) break;
      }
    }

    console.log("phase2 done:", races.length, "races");
  }

  // ----------------------------------------------------------
  // Phase 3: 0件時だけ検索インデックスを再探索
  // ----------------------------------------------------------

  if (!deadlineReached() && races.length === 0) {
    console.log("phase3: 0件のため再探索");

    for (const idx of INDEX_URLS) {
      if (deadlineReached()) break;

      try {
        await sleep(WAIT_MS);
        const html = await get(idx);

        const links = collectRaceLinks(html, idx);
        for (const url of links) {
          if (deadlineReached() || races.length >= MAX_RACES) break;

          try {
            await sleep(WAIT_MS);
            const raceHtml = await get(url);
            if (isRacePage(raceHtml)) processRace(raceHtml, url, races);
          } catch (e) {
            console.error("phase3 race skip:", url, e.message);
          }
        }
      } catch (e) {
        console.error("phase3 index skip:", idx, e.message);
      }
    }

    console.log("phase3 done:", races.length, "races");
  }

  // ----------------------------------------------------------
  // 重複除去 / 並び替え
  // ----------------------------------------------------------

  const unique = new Map();
  for (const race of races) {
    if (!unique.has(race.key)) unique.set(race.key, race);
  }

  const finalRaces = [...unique.values()];
  finalRaces.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  // ----------------------------------------------------------
  // 出力
  // ----------------------------------------------------------

  const outPath = path.join(__dirname, "races.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const output = {
    updatedAt: new Date().toISOString(),
    count: finalRaces.length,
    races: finalRaces,
  };

  fs.writeFileSync(outPath, JSON.stringify(output), "utf8");

  console.log("========================================");
  console.log("written:", outPath);
  console.log("races:", finalRaces.length);
  console.log(
    "elapsed:",
    Math.round((Date.now() - startedAt) / 1000),
    "sec"
  );
  console.log("========================================");

  if (finalRaces.length === 0) {
    console.error("ERROR: レースを1件も取得できませんでした。");
    console.error("GambooのHTML/URL仕様、アクセス制限、engine.jsのparseCardを確認してください。");
    process.exitCode = 1;
    return;
  }

  console.log("SUCCESS:", finalRaces.length, "races");
}

main().catch((e) => {
  console.error("FATAL:", e?.stack || e);
  process.exit(1);
});
