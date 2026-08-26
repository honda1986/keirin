// ============================================================
// Gamboo 競輪予想情報を巡回し、本日の全レースのスジ期待度を算出して
// races.json に書き出す (GitHub Actions から実行)
//
// 使い方:
//   node fetch.js
//
// Gambooのサイト構造変更に対応した取得版
// ============================================================

const fs = require("fs");
const path = require("path");

const {
  parseCard,
  predict,
  sujiExpect,
} = require("./engine.js");

const {
  T,
  TRACK_NAMES,
} = require("./bankdata.js");

// ------------------------------------------------------------
// 学習補正
// learn.js が生成した weights.json があれば適用
// ------------------------------------------------------------

let LEARN_W = null;

try {
  const weightPath = path.join(__dirname, "weights.json");

  LEARN_W = JSON.parse(
    fs.readFileSync(weightPath, "utf8")
  );

  console.log(
    "学習補正を適用:",
    LEARN_W.updatedAt || "(updatedAtなし)"
  );
} catch (e) {
  console.log("学習補正なし");
}

// ------------------------------------------------------------
// Gamboo URL
// ------------------------------------------------------------

const BASE_URL = "https://gamboo.jp";

const INDEX_URLS = [
  "https://gamboo.jp/keirin/",
  "https://gamboo.jp/keirin/yosou/",
  "https://gamboo.jp/keirin/yoso/",
];

// ------------------------------------------------------------
// 設定
// ------------------------------------------------------------

const UA =
  "keirin-local-app/1.0 (personal use; contact: set-your-email)";

const WAIT_MS = 500;

// 最大レース数
const MAX_RACES = 150;

// リンク巡回上限
const MAX_QUEUE = 500;

// 1リクエストのタイムアウト
const FETCH_TIMEOUT = 15000;

// 全体15分
const DEADLINE_MS = 15 * 60 * 1000;

const startedAt = Date.now();

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------
// JSTの日付
//
// Gamboo現在仕様:
//   20260826
//
// 旧:
//   2026-08-26
// ------------------------------------------------------------

function getJstDateString() {
  const now = new Date();

  const jst = new Date(
    now.getTime() + 9 * 60 * 60 * 1000
  );

  return jst
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
}

// ------------------------------------------------------------
// HTTP GET
// ------------------------------------------------------------

async function get(url) {
  const ctrl = new AbortController();

  const timer = setTimeout(
    () => ctrl.abort(),
    FETCH_TIMEOUT
  );

  try {
    const res = await fetch(url, {
      method: "GET",

      headers: {
        "User-Agent": UA,

        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

        "Accept-Language":
          "ja-JP,ja;q=0.9,en-US;q=0.7,en;q=0.5",

        "Cache-Control":
          "no-cache",

        "Pragma":
          "no-cache",
      },

      redirect: "follow",

      signal: ctrl.signal,
    });

    const html = await res.text();

    if (!res.ok) {
      throw new Error(
        `${res.status} ${res.statusText} ${url} body=${html.slice(0, 300)}`
      );
    }

    if (!html || html.length < 100) {
      throw new Error(
        `empty response ${url} length=${html.length}`
      );
    }

    return html;

  } catch (e) {

    if (e.name === "AbortError") {
      throw new Error(
        `timeout ${FETCH_TIMEOUT}ms ${url}`
      );
    }

    throw e;

  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------
// HTML → テキスト
// ------------------------------------------------------------

function htmlToText(html) {

  let s = html
    .replace(
      /<script[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(
      /<style[\s\S]*?<\/style>/gi,
      " "
    )
    .replace(
      /<!--[\s\S]*?-->/g,
      " "
    )

    // Gambooの車番画像
    .replace(
      /<img[^>]*alt="([^"]*)"[^>]*>/gi,
      (m, alt) => {
        if (/^[1-9]$/.test(alt)) {
          return alt;
        }

        if (
          /middle|nakaguro|middle\s*point/i.test(
            alt
          )
        ) {
          return " ・ ";
        }

        return " ";
      }
    )

    .replace(
      /<img[^>]*>/gi,
      " "
    )

    .replace(
      /<(br|\/tr|\/td|\/th|\/p|\/div|\/li|\/h[1-6])[^>]*>/gi,
      "\n"
    )

    .replace(
      /<[^>]+>/g,
      " "
    );

  const ent = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&nbsp;": " ",
  };

  s = s.replace(
    /&[a-z#0-9]+;/gi,
    (m) => ent[m] || " "
  );

  // HTML由来の連続空白を整理
  s = s
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n");

  return s;
}

// ------------------------------------------------------------
// 並び予想
//
// Gamboo HTML:
//   alt="1"
//   alt="middle point"
//   alt="2"
//   ...
//
// 現行/旧形式の両方をある程度許容
// ------------------------------------------------------------

function extractNarabi(html, cars) {

  const ni = html.indexOf("並び予想");

  if (ni === -1) {
    return null;
  }

  // 「並び予想」周辺を広めに見る
  const chunk = html.slice(
    ni,
    ni + 5000
  );

  const alts = [
    ...chunk.matchAll(
      /alt\s*=\s*["']([^"']*)["']/gi
    ),
  ].map((m) => m[1]);

  const lines = [];

  let cur = [];
  let started = false;

  for (const a of alts) {

    const v = a
      .replace(/\s+/g, " ")
      .trim();

    // 車番
    if (/^[1-9]$/.test(v)) {
      cur.push(parseInt(v, 10));
      started = true;
      continue;
    }

    // ライン区切り
    if (
      /middle|nakaguro|middle\s*point|・|●|•/i.test(v)
    ) {
      if (cur.length) {
        lines.push(cur);
        cur = [];
      }

      continue;
    }

    // 矢印
    if (
      /←|→|arrow|left|right/i.test(v)
    ) {
      continue;
    }

    // 車番列が始まって、その後関係ない画像になった
    if (started) {
      break;
    }
  }

  if (cur.length) {
    lines.push(cur);
  }

  const flat = lines.flat();

  if (!flat.length) {
    return null;
  }

  // 車番数
  if (flat.length !== cars.length) {
    return null;
  }

  const set = new Set(flat);

  // 重複チェック
  if (set.size !== cars.length) {
    return null;
  }

  // 全車番が存在するか
  if (
    !cars.every((c) => set.has(c))
  ) {
    return null;
  }

  return lines;
}

// ------------------------------------------------------------
// HTML中のリンクを収集
// ------------------------------------------------------------

function collectLinks(html, baseUrl) {

  const out = new Set();

  const re =
    /href\s*=\s*["']([^"']+)["']/gi;

  let m;

  while ((m = re.exec(html))) {

    let href = m[1];

    href = href
      .replace(/&amp;/g, "&")
      .trim();

    if (
      /^(javascript:|#|mailto:|tel:)/i.test(
        href
      )
    ) {
      continue;
    }

    try {
      href = new URL(
        href,
        baseUrl
      ).toString();
    } catch {
      continue;
    }

    // Gambooだけ
    if (
      !/^https?:\/\/(?:www\.)?gamboo\.jp/i.test(
        href
      )
    ) {
      continue;
    }

    href = href.split("#")[0];

    // 競輪関連URL
    if (
      /\/keirin\//i.test(href)
    ) {
      out.add(href);
    }
  }

  return [...out];
}

// ------------------------------------------------------------
// レースURLらしさを判定
// ------------------------------------------------------------

function isRaceUrl(url) {

  if (
    !/gamboo\.jp\/keirin\//i.test(url)
  ) {
    return false;
  }

  // yoso / yosou
  if (
    /\/yoso(?:u)?\//i.test(url)
  ) {
    return true;
  }

  // rno が付いていればレースURLと判断
  if (
    /[?&]rno=\d+/i.test(url)
  ) {
    return true;
  }

  return false;
}

// ------------------------------------------------------------
// URLから pid / rno を取得
// ------------------------------------------------------------

function getUrlParam(url, name) {

  try {
    const u = new URL(url);

    return u.searchParams.get(name);

  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// レースHTMLを解析
// ------------------------------------------------------------

function processRace(
  html,
  url,
  races
) {

  // ----------------------------------------------------------
  // レースページ判定
  // ----------------------------------------------------------

  if (
    !/基本出走データ/.test(html)
  ) {
    return false;
  }

  const text = htmlToText(html);

  // ----------------------------------------------------------
  // parseCard
  // ----------------------------------------------------------

  let p;

  try {

    p = parseCard(
      text,
      TRACK_NAMES
    );

  } catch (e) {

    console.error(
      "parse failed:",
      url,
      e.message
    );

    // 最初の失敗HTMLを保存
    const debugPath =
      path.join(
        __dirname,
        "debug-gamboo.txt"
      );

    if (
      !fs.existsSync(debugPath)
    ) {

      fs.writeFileSync(
        debugPath,
        text,
        "utf8"
      );

      console.error(
        "debug saved:",
        debugPath
      );
    }

    return false;
  }

  // ----------------------------------------------------------
  // 出走選手数確認
  // ----------------------------------------------------------

  if (
    !p ||
    !p.entries ||
    p.entries.length < 5
  ) {

    console.error(
      "invalid race data:",
      url,
      "entries=",
      p?.entries?.length ?? 0
    );

    return false;
  }

  // ----------------------------------------------------------
  // 並び予想
  // ----------------------------------------------------------

  const cars =
    p.entries.map(
      (e) => e.car
    );

  const nb =
    extractNarabi(
      html,
      cars
    );

  if (nb) {

    p.lines = nb;
    p.narabi = nb.flat();

  }

  // ----------------------------------------------------------
  // titleから場・レース番号補完
  // ----------------------------------------------------------

  const tm = html.match(
    /<title>[\s\S]*?(\d{1,2})\/(\d{1,2})\s*([぀-ヿ一-龥]{2,5}?)(\d{1,2})R/
  );

  if (tm) {

    if (
      !p.place ||
      !TRACK_NAMES.includes(p.place)
    ) {
      p.place = tm[3];
    }

    if (!p.raceNo) {
      p.raceNo =
        tm[4] + "R";
    }
  }

  // ----------------------------------------------------------
  // URLからレース番号を補完
  // ----------------------------------------------------------

  if (!p.raceNo) {

    const rno =
      getUrlParam(
        url,
        "rno"
      );

    if (rno) {
      p.raceNo =
        parseInt(rno, 10) + "R";
    }
  }

  // ----------------------------------------------------------
  // 最終フォールバック
  // ----------------------------------------------------------

  if (!p.raceNo) {

    const pm =
      url.match(
        /[?&]rno=(\d+)/
      );

    p.raceNo =
      pm
        ? pm[1] + "R"
        : "R?";
  }

  // ----------------------------------------------------------
  // race key
  // ----------------------------------------------------------

  const key =
    (p.place || "?") +
    "_" +
    (p.raceNo || "?");

  if (
    races.some(
      (x) => x.key === key
    )
  ) {
    return false;
  }

  // ----------------------------------------------------------
  // バンクデータ
  // ----------------------------------------------------------

  const bank =
    T[p.place];

  if (!bank) {

    console.warn(
      "bank data not found:",
      p.place,
      url
    );
  }

  // ----------------------------------------------------------
  // 予想エンジン
  // ----------------------------------------------------------

  let r;

  try {

    r = predict(
      p,
      bank,
      p.place,
      LEARN_W
    );

  } catch (e) {

    console.error(
      "predict failed:",
      p.place,
      p.raceNo,
      e.message
    );

    return false;
  }

  // ----------------------------------------------------------
  // スジ期待度
  // ----------------------------------------------------------

  let sx = null;

  try {

    sx = sujiExpect(
      p,
      r,
      bank
        ? bank[10]
        : null
    );

  } catch (e) {

    console.error(
      "sujiExpect failed:",
      p.place,
      p.raceNo,
      e.message
    );
  }

  // ----------------------------------------------------------
  // riders
  // ----------------------------------------------------------

  const riders =
    (() => {

      const posOf = {};

      for (const l of p.lines || []) {

        if (
          l.length === 1
        ) {

          posOf[l[0]] = 3;

        } else {

          l.forEach(
            (c, li) => {
              posOf[c] =
                Math.min(
                  li,
                  2
                );
            }
          );
        }
      }

      const rankOf = {};

      for (
        let i = 0;
        i < r.scores.length;
        i++
      ) {

        rankOf[
          r.scores[i].car
        ] = i + 1;
      }

      return p.entries.map(
        (en) => {

          const score =
            r.scores.find(
              (sc) =>
                sc.car === en.car
            );

          return [
            en.car,
            en.age || 0,
            parseInt(en.ki) || 0,
            posOf[en.car] ?? 3,
            rankOf[en.car] || 9,
            +(
              score?.total || 0
            ).toFixed(1),
          ];
        }
      );
    })();

  // ----------------------------------------------------------
  // racesへ格納
  // ----------------------------------------------------------

  races.push({

    key,

    place:
      p.place,

    raceNo:
      p.raceNo,

    startTime:
      p.startTime || "",

    grade:
      p.grade,

    date:
      p.date,

    klass:
      r.klass,

    fLabel:
      r.fLabel,

    pattern:
      r.linePattern,

    score:
      sx
        ? sx.score
        : null,

    verdict:
      sx
        ? sx.verdict
        : "対象外",

    reasons:
      sx
        ? sx.reasons
        : ["ガールズ(ライン無し)"],

    marks:
      r.marks
        .slice(0, 3)
        .map(
          (mk) =>
            mk.mark +
            mk.car +
            " " +
            mk.name
        )
        .join(" / "),

    lines:
      p.lines,

    marksCars:
      r.marks.map(
        (mk) => mk.car
      ),

    riders,

    gap:
      r.scores &&
      r.scores[1]
        ? +(
            r.scores[0].total -
            r.scores[1].total
          ).toFixed(1)
        : null,

    nishatan:
      r.bets.nishatan,

    sanrentan:
      r.bets.sanrentan,

    raw:
      text,

    url,
  });

  console.log(
    "OK:",
    p.place,
    p.raceNo,
    sx
      ? sx.score + "%"
      : "girls",
    "lines=" +
      JSON.stringify(
        p.lines
      )
  );

  return true;
}

// ------------------------------------------------------------
// レース取得
// ------------------------------------------------------------

async function fetchRace(
  url,
  races
) {

  const html =
    await get(url);

  return processRace(
    html,
    url,
    races
  );
}

// ------------------------------------------------------------
// レースページ内から
// 1R～12Rなどのリンクを収集
//
// 旧:
//   /keirin/yoso/...rdt=...
//
// 新:
//   /keirin/yoso/?pid=...&rdt=...&rno=...
//
// URLパラメータの順番には依存しない
// ------------------------------------------------------------

function collectRaceLinks(
  html,
  baseUrl
) {

  const out =
    new Set();

  const links =
    collectLinks(
      html,
      baseUrl
    );

  for (const url of links) {

    if (
      !isRaceUrl(url)
    ) {
      continue;
    }

    const rno =
      getUrlParam(
        url,
        "rno"
      );

    if (
      rno &&
      /^\d+$/.test(rno)
    ) {

      out.add(
        url.split("#")[0]
      );
    }
  }

  return [
    ...out
  ];
}

// ------------------------------------------------------------
// 今日のGambooページから
// 開催場pidを抽出
// ------------------------------------------------------------

function collectVenuePids(
  html,
  baseUrl
) {

  const pids =
    new Set();

  const links =
    collectLinks(
      html,
      baseUrl
    );

  for (const url of links) {

    const pid =
      getUrlParam(
        url,
        "pid"
      );

    if (
      pid &&
      /^\d+$/.test(pid)
    ) {

      pids.add(pid);
    }
  }

  return [
    ...pids
  ];
}

// ------------------------------------------------------------
// main
// ------------------------------------------------------------

async function main() {

  const races = [];

  // ----------------------------------------------------------
  // 今日の日付
  // ----------------------------------------------------------

  const rdt =
    getJstDateString();

  console.log(
    "========================================"
  );

  console.log(
    "Gamboo 全レース更新"
  );

  console.log(
    "JST date:",
    rdt
  );

  console.log(
    "========================================"
  );

  // ----------------------------------------------------------
  // 第1段
  //
  // Gamboo現在のURL仕様:
  //
  // https://gamboo.jp/keirin/yoso/
  //   ?pid=53
  //   &rdt=20260826
  //   &rno=1
  //
  // ----------------------------------------------------------

  const VENUE_PIDS = [
    11, 12, 13,
    21, 22, 23, 24, 25, 26, 27, 28,
    31, 32, 34, 35, 36, 37, 38,
    42, 43, 44, 45, 46, 47, 48,
    51, 53, 54, 55, 56,
    61, 62, 63,
    71, 73, 74, 75,
    81, 83, 84, 85, 86, 87,
  ];

  console.log(
    "phase1: 場コード×rno列挙"
  );

  console.log(
    "date:",
    rdt
  );

  for (
    const pid of VENUE_PIDS
  ) {

    if (
      races.length >= MAX_RACES
    ) {
      break;
    }

    if (
      Date.now() - startedAt >
      DEADLINE_MS
    ) {

      console.log(
        "deadline"
      );

      break;
    }

    let venueMiss = 0;

    for (
      let rno = 1;
      rno <= 12;
      rno++
    ) {

      if (
        Date.now() - startedAt >
        DEADLINE_MS
      ) {
        break;
      }

      // 現在のGamboo形式
      const url =
        `${BASE_URL}/keirin/yoso/?pid=${pid}&rdt=${rdt}&rno=${rno}`;

      try {

        await sleep(
          WAIT_MS
        );

        const html =
          await get(url);

        const ok =
          processRace(
            html,
            url,
            races
          );

        if (ok) {

          venueMiss = 0;

        } else {

          venueMiss++;
        }

      } catch (e) {

        venueMiss++;

        console.error(
          "fetch skip:",
          `pid=${pid}`,
          `rno=${rno}`,
          e.message
        );
      }

      // 1R,2Rが連続無効なら非開催
      if (
        rno <= 2 &&
        venueMiss >= 2
      ) {

        break;
      }

      // 3連続無効なら最終Rを越えたと判断
      if (
        venueMiss >= 3
      ) {

        break;
      }
    }
  }

  console.log(
    "phase1 done:",
    races.length,
    "races"
  );

  // ----------------------------------------------------------
  // 第1段で0件の場合
  //
  // Gambooトップから開催場を取得して再試行
  // ----------------------------------------------------------

  if (
    races.length === 0
  ) {

    console.log(
      "phase1 returned 0 races."
    );

    console.log(
      "トップページから開催場を再探索します。"
    );

    const discoveredPids =
      new Set();

    for (
      const idx of INDEX_URLS
    ) {

      if (
        Date.now() - startedAt >
        DEADLINE_MS
      ) {
        break;
      }

      try {

        await sleep(
          WAIT_MS
        );

        const html =
          await get(idx);

        const pids =
          collectVenuePids(
            html,
            idx
          );

        console.log(
          "venue candidates:",
          idx,
          pids
        );

        for (
          const pid of pids
        ) {

          discoveredPids.add(
            pid
          );
        }

      } catch (e) {

        console.error(
          "index skip:",
          idx,
          e.message
        );
      }
    }

    console.log(
      "discovered pids:",
      [
        ...discoveredPids
      ]
    );

    // 発見したpidを実際に当日ページへ
    for (
      const pid of discoveredPids
    ) {

      if (
        races.length >= MAX_RACES
      ) {
        break;
      }

      if (
        Date.now() - startedAt >
        DEADLINE_MS
      ) {
        break;
      }

      for (
        let rno = 1;
        rno <= 12;
        rno++
      ) {

        const url =
          `${BASE_URL}/keirin/yoso/?pid=${pid}&rdt=${rdt}&rno=${rno}`;

        try {

          await sleep(
            WAIT_MS
          );

          const html =
            await get(url);

          processRace(
            html,
            url,
            races
          );

        } catch (e) {

          console.error(
            "discovered race skip:",
            url,
            e.message
          );
        }
      }
    }

    console.log(
      "discovery phase done:",
      races.length,
      "races"
    );
  }

  // ----------------------------------------------------------
  // 第3段
  //
  // トップ/予想ページの実リンクを巡回
  //
  // 第1・第2段で少ない場合のみ実行
  // ----------------------------------------------------------

  if (
    races.length < 30
  ) {

    console.log(
      "phase3: リンク巡回"
    );

    const seen =
      new Set();

    const queue =
      [];

    for (
      const idx of INDEX_URLS
    ) {

      if (
        Date.now() - startedAt >
        DEADLINE_MS
      ) {
        break;
      }

      try {

        await sleep(
          WAIT_MS
        );

        const html =
          await get(idx);

        const links =
          collectRaceLinks(
            html,
            idx
          );

        console.log(
          "race links:",
          idx,
          links.length
        );

        for (
          const u of links
        ) {

          if (
            !seen.has(u)
          ) {

            seen.add(u);

            queue.push(u);
          }
        }

      } catch (e) {

        console.error(
          "index skip:",
          idx,
          e.message
        );
      }
    }

    console.log(
      "candidate race links:",
      queue.length
    );

    // yoso優先
    queue.sort(
      (a, b) => {

        const aa =
          /\/yoso(?:u)?\//i.test(a)
            ? 1
            : 0;

        const bb =
          /\/yoso(?:u)?\//i.test(b)
            ? 1
            : 0;

        return bb - aa;
      }
    );

    for (
      const url of queue
    ) {

      if (
        races.length >= MAX_RACES
      ) {
        break;
      }

      if (
        Date.now() - startedAt >
        DEADLINE_MS
      ) {

        console.log(
          "deadline reached"
        );

        break;
      }

      try {

        await sleep(
          WAIT_MS
        );

        const html =
          await get(url);

        if (
          !/基本出走データ/.test(
            html
          )
        ) {
          continue;
        }

        processRace(
          html,
          url,
          races
        );

      } catch (e) {

        console.error(
          "race skip:",
          url,
          e.message
        );
      }
    }

    console.log(
      "phase3 done:",
      races.length,
      "races"
    );
  }

  // ----------------------------------------------------------
  // 重複除去
  // ----------------------------------------------------------

  const unique =
    new Map();

  for (
    const race of races
  ) {

    if (
      !unique.has(
        race.key
      )
    ) {

      unique.set(
        race.key,
        race
      );
    }
  }

  const finalRaces =
    [
      ...unique.values()
    ];

  // ----------------------------------------------------------
  // スコア順
  // ----------------------------------------------------------

  finalRaces.sort(
    (a, b) =>
      (b.score ?? -1) -
      (a.score ?? -1)
  );

  // ----------------------------------------------------------
  // 出力
  // ----------------------------------------------------------

  const outPath =
    path.join(
      __dirname,
      "races.json"
    );

  fs.mkdirSync(
    path.dirname(outPath),
    {
      recursive: true,
    }
  );

  const output = {
    updatedAt:
      new Date().toISOString(),

    count:
      finalRaces.length,

    races:
      finalRaces,
  };

  fs.writeFileSync(
    outPath,
    JSON.stringify(
      output,
      null,
      0
    ),
    "utf8"
  );

  console.log(
    "========================================"
  );

  console.log(
    "written:",
    outPath
  );

  console.log(
    "races:",
    finalRaces.length
  );

  console.log(
    "elapsed:",
    Math.round(
      (Date.now() - startedAt) /
      1000
    ),
    "sec"
  );

  console.log(
    "========================================"
  );

  // ----------------------------------------------------------
  // 0件はGitHub Actions失敗
  // ----------------------------------------------------------

  if (
    finalRaces.length === 0
  ) {

    console.error(
      "ERROR: レースを1件も取得できませんでした。"
    );

    console.error(
      "GambooのHTML構造またはアクセス仕様が変更された可能性があります。"
    );

    process.exitCode = 1;

    return;
  }

  console.log(
    "SUCCESS:",
    finalRaces.length,
    "races"
  );
}

// ------------------------------------------------------------
// 実行
// ------------------------------------------------------------

main().catch(
  (e) => {

    console.error(
      "FATAL:",
      e
    );

    process.exit(1);
  }
);
