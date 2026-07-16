// ============================================================
// ローカル予想エンジン(API不使用・純粋JS)
// 1) WINTICKET形式の出走表テキストをパース
// 2) バンク特性×選手データで採点し、印・展開・買い目を生成
// ============================================================

// ---------- パーサー ----------
function parseWinticket(text, trackNames) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const joined = lines.join("\n");

  // レース情報
  const meta = {};
  {
    let best = "", bestIdx = Infinity;
    for (const n of trackNames) {
      const i = text.indexOf(n);
      if (i !== -1 && i < bestIdx) { bestIdx = i; best = n; }
    }
    meta.place = best;
  }
  const mR = joined.match(/(\d{1,2})\s*R/); meta.raceNo = mR ? mR[1] + "R" : "";
  const mG = joined.match(/[SAL]級[^\n]{0,8}/); meta.grade = mG ? mG[0].trim() : "";
  const mD = joined.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/); meta.date = mD ? mD[0] : "";
  const mW = joined.match(/(晴|曇|雨|雪)/); const mT = joined.match(/([\d.]+)℃/);
  const mWind = joined.match(/(北|南|東|西|北東|北西|南東|南西)?\s*([\d.]+)\s*m\/s/);
  meta.weather = [mW ? mW[1] : "", mT ? mT[1] + "℃" : "", mWind ? (mWind[1] || "") + mWind[2] + "m/s" : ""].filter(Boolean).join(" ");
  meta.windSpeed = mWind ? parseFloat(mWind[2]) : null;

  // 選手テーブル: 「コメント」ヘッダー以降〜「並び予想」まで
  const start = lines.lastIndexOf("コメント");
  const end = lines.indexOf("並び予想");
  if (start === -1) throw new Error("出走表の選手データ(コメント列)が見つかりません");
  const body = lines.slice(start + 1, end === -1 ? undefined : end);

  const isInt = (s) => /^\d{1,2}$/.test(s);
  const isProfile = (s) => /[SAL]\d\s*\d+歳\s*\d+期/.test(s.replace(/\s+/g, " "));
  const num = (s) => { const v = parseFloat(s); return isNaN(v) ? 0 : v; };

  const entries = [];
  let i = 0;
  while (i < body.length) {
    if (!isInt(body[i])) { i++; continue; }
    // 枠(任意)+車番: 整数が2連続なら [枠,車]、1つなら車のみ
    let waku = null, car;
    if (i + 1 < body.length && isInt(body[i + 1]) && !isProfile(body[i + 2] || "")) {
      waku = parseInt(body[i]); car = parseInt(body[i + 1]); i += 2;
    } else { car = parseInt(body[i]); i += 1; }
    // 選手名(次の非数値行)、その次がプロフィール行であること
    if (i + 1 >= body.length || !isProfile(body[i + 1])) { continue; }
    const name = body[i]; i++;
    const pm = body[i].replace(/\s+/g, " ").match(/(\S+)\s+([SAL]\d)\s+(\d+)歳\s+(\d+)期/);
    i++;
    if (!pm) continue;
    // 数値列: 得点,S,H,B,(脚),逃,捲,差,マ,1着,2着,3着,着外,勝率,2連,3連,ギヤ,(コメント)
    const nums = []; let kyaku = ""; let comment = "";
    while (i < body.length && nums.length < 17) {
      const t = body[i];
      if (/^(追|逃|両)$/.test(t)) { kyaku = t; i++; continue; }
      if (/^-?[\d.]+$/.test(t)) { nums.push(num(t)); i++; continue; }
      break; // 数値でも脚質でもない → コメントか次の選手
    }
    if (i < body.length && !isInt(body[i]) && !isProfile(body[i]) && body[i] !== "並び予想") {
      comment = body[i]; i++;
    }
    if (nums.length < 16) continue; // データ不足行はスキップ
    entries.push({
      waku, car, name, pref: pm[1], grade: pm[2], age: parseInt(pm[3]), ki: pm[4] + "期",
      score: nums[0], S: nums[1], H: nums[2], B: nums[3], kyaku,
      k: { nige: nums[4], makuri: nums[5], sashi: nums[6], mark: nums[7] },
      seiseki: { win1: nums[8], win2: nums[9], win3: nums[10], out: nums[11] },
      rate: { win: nums[12], niren: nums[13], sanren: nums[14] },
      gear: nums[15] ?? null, comment,
    });
  }
  if (entries.length < 5) throw new Error("選手データを" + entries.length + "名しか読み取れませんでした。貼り付け範囲をご確認ください");

  // 並び予想の数列
  let narabi = [];
  if (end !== -1) {
    for (let j = end + 1; j < lines.length; j++) {
      if (isInt(lines[j])) narabi.push(parseInt(lines[j]));
      else break;
    }
  }
  if (narabi.length === 0) narabi = entries.map((e) => e.car);

  // ライン構成: コメントの「○○君/○○さん」から追走関係を構築
  const parent = {}; // car -> 追走先car
  for (const e of entries) {
    const c = e.comment || "";
    if (/決めず|単騎/.test(c)) continue;
    let best = null, bestLen = 0;
    for (const o of entries) {
      if (o.car === e.car) continue;
      for (const len of [3, 2]) {
        const key = o.name.slice(0, len);
        if (key.length === len && c.includes(key) && len > bestLen) { best = o.car; bestLen = len; }
      }
    }
    if (best != null) parent[e.car] = best;
  }
  // 追走の連鎖からラインを構築(並び順を尊重)
  const order = (c) => { const k = narabi.indexOf(c); return k === -1 ? 99 : k; };
  const children = {};
  Object.entries(parent).forEach(([f, t]) => { (children[t] = children[t] || []).push(parseInt(f)); });
  Object.values(children).forEach((a) => a.sort((x, y) => order(x) - order(y)));
  const roots = entries.map((e) => e.car).filter((c) => parent[c] == null);
  const chainOf = (c) => { const out = [c]; (children[c] || []).forEach((ch) => out.push(...chainOf(ch))); return out; };
  const linesArr = roots.map(chainOf).sort((a, b) => order(a[0]) - order(b[0]));
  return { ...meta, entries, lines: linesArr, narabi };
}

// ---------- 遠山競輪研究所データ(2016/9〜2019/8・64,321レース実測) ----------
// スジ車券回収率の高い競輪場グループA(33全場+400スジ比率上位14場)。他はグループB
const GROUP_A = new Set(["奈良","前橋","伊東","松戸","小田原","防府","富山","佐世保","青森","松山","西武園","取手","別府","大垣","松阪","川崎","弥彦","小倉","静岡","久留米","広島"]);
// SIM[分戦数][ライン人気順] = { o:先→二, u:二→先 } 各[的中A,回収A,的中B,回収B,的中計,回収計]
const SIM = {
  2: { 1: { o: [25.10, 90.73, 22.36, 82.42, 23.80, 86.79], u: [11.73, 66.08, 10.25, 62.23, 11.03, 64.26] },
       2: { o: [6.43, 98.84, 5.41, 93.94, 5.94, 96.52], u: [4.88, 80.25, 4.46, 88.74, 4.68, 84.28] } },
  3: { 1: { o: [19.83, 83.87, 17.42, 79.39, 18.65, 81.67], u: [10.51, 68.31, 10.02, 65.12, 10.27, 66.74] },
       2: { o: [6.56, 95.82, 5.62, 89.62, 6.10, 92.77], u: [4.29, 75.35, 4.17, 77.42, 4.23, 76.37] },
       3: { o: [2.65, 92.24, 2.29, 75.26, 2.47, 83.89], u: [1.77, 65.55, 1.62, 63.33, 1.70, 64.46] } },
  4: { 1: { o: [16.03, 79.88, 14.33, 77.52, 15.17, 78.69], u: [9.52, 70.29, 8.90, 64.26, 9.20, 67.25] },
       2: { o: [5.41, 81.47, 5.30, 85.03, 5.36, 83.27], u: [4.32, 72.34, 3.79, 72.88, 4.05, 72.61] },
       3: { o: [3.47, 99.74, 2.86, 84.00, 3.16, 91.79], u: [1.53, 55.69, 1.38, 50.14, 1.45, 52.89] },
       4: { o: [1.41, 69.51, 1.06, 64.44, 1.23, 66.95], u: [0.94, 66.46, 0.59, 44.41, 0.77, 55.33] } },
};
// クラス別スジ内訳(先→二% / 二→先%)。チャレンジは押し切り最多・番手差し最少
const KLASS_SUJI = { s: [23.47, 16.76], a12: [26.35, 16.05], challenge: [31.77, 13.04] };

// ---------- Gamboo「基本出走データ」パーサー ----------
const CIRC = { "①":1,"②":2,"③":3,"④":4,"⑤":5,"⑥":6,"⑦":7,"⑧":8,"⑨":9,
  "❶":1,"❷":2,"❸":3,"❹":4,"❺":5,"❻":6,"❼":7,"❽":8,"❾":9 };
function parseGamboo(text, trackNames) {
  const meta = {};
  const mTitle = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日[^\n]{0,20}?([぀-ヿ一-龥]{2,5})\s*(\d{1,2})R\s*\d{3,4}m/);
  if (mTitle) { meta.date = `${mTitle[1]}年${mTitle[2]}月${mTitle[3]}日`; meta.place = mTitle[4]; meta.raceNo = mTitle[5] + "R"; }
  if (!meta.place) {
    let best = "", idx = Infinity;
    for (const n of trackNames) { const i = text.indexOf(n); if (i !== -1 && i < idx) { idx = i; best = n; } }
    meta.place = best;
  }
  // レース番号のフォールバック: 「7/13 松山4R 基本出走データ」等の見出しや、単独の「4R」から拾う
  if (!meta.raceNo) {
    const m1 = text.match(/\d{1,2}\/\d{1,2}\s*[぀-ヿ一-龥]{2,5}\s*(\d{1,2})R/);
    const m2 = text.match(/([぀-ヿ一-龥]{2,5})\s*(\d{1,2})R\s*(?:基本出走|\d{3,4}m)/);
    const m3 = text.match(/(?:^|\s)(\d{1,2})R(?:\s|$)/m);
    const rn = (m1 && m1[1]) || (m2 && m2[2]) || (m3 && m3[1]);
    if (rn) meta.raceNo = rn + "R";
  }
  if (!meta.date) {
    const md = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (md) meta.date = `${md[1]}年${md[2]}月${md[3]}日`;
  }
  const mG = text.match(/[SALＳＡＬ]級\s*[^\s\n]{0,6}/);
  meta.grade = mG ? mG[0].replace(/\s+/g, " ").trim() : "";
  meta.weather = ""; meta.windSpeed = null;

  // 成績列が「1着/2着/3着/着外の回数」形式か「勝率/2連/3連/着外率(%)」形式かを判定
  const countMode = /1着\s*回数|着\s*回数/.test(text) && !/2連\s*対率/.test(text.slice(0, text.indexOf("逃") > 0 ? text.indexOf("逃") + 400 : 800));
  const tokens = text.split(/[\s\t\r\n]+/).filter(Boolean);
  const profRe = /^(.+?)\(([^)]*)\)\/(\d{1,3})\/(\d{1,3})$/;
  const isFloat = (s) => /^\d{1,3}\.\d{1,2}$/.test(s);
  const isInt = (s) => /^\d{1,3}$/.test(s);
  const timeOk = (v) => v >= 9 && v <= 18;
  const entries = [];
  let car = 0;
  for (let i = 0; i < tokens.length; i++) {
    const pm = tokens[i].match(profRe);
    if (!pm || i === 0) continue;
    const name = tokens[i - 1];
    if (/予想|情報|成績|得点|注目/.test(name) || name.length < 2) continue;
    car += 1;
    const e = { car, name, pref: pm[1], home: pm[2], ki: pm[3] + "期", age: parseInt(pm[4]),
      grade: "", gradePrev: "", kyaku: "", score: 0, prevScore: null, scoreDiff: 0,
      S: 0, H: 0, B: 0, k: { nige: 0, makuri: 0, sashi: 0, mark: 0 },
      seiseki: { win1: 0, win2: 0, win3: 0, out: 0 }, rate: { win: 0, niren: 0, sanren: 0 },
      results: [], avgTime: null, recentWinRate: null, recentRaces: 0, kiken: false, comment: "" };
    let j = i + 1;
    const nums = [];
    // 級班・脚質・得点(現/前)・失違・決まり手4・B・成績値 を順に収集
    while (j < tokens.length && !tokens[j].match(profRe) && tokens[j] !== "並び予想") {
      const t = tokens[j];
      const km = t.match(/^([SALＳＡＬ]\d)\/([SALＳＡＬ]\d)$/);
      if (km && !e.grade) { e.grade = km[1]; e.gradePrev = km[2]; j++; continue; }
      if (/^(逃|追|両)$/.test(t) && !e.kyaku) { e.kyaku = t; j++; continue; }
      // 得点(現): 小数値20〜130点。直後の「/前得点」とセットで確実に判定(ガールズは40点台なので閾値は低めに)
      if (!e.score && isFloat(t) && parseFloat(t) >= 20 && parseFloat(t) <= 130) {
        const nxt = tokens[j + 1] || "";
        if (/^\/\d{1,3}\.\d{1,2}$/.test(nxt) || km === null) { e.score = parseFloat(t); j++; continue; }
      }
      // 得点確定後、前得点(/xx.xx)が来るまでの間に現得点が重複表記される新レイアウト対応: 同値の小数はスキップ
      if (e.score && e.prevScore == null && isFloat(t) && Math.abs(parseFloat(t) - e.score) < 0.005) { j++; continue; }
      // 前得点: 「/46.32」または「/」+「46.32」の分離表記の両方に対応
      if (e.score && e.prevScore == null && /^\/\d{1,3}\.\d{1,2}$/.test(t)) { e.prevScore = parseFloat(t.slice(1)); j++; continue; }
      if (e.score && e.prevScore == null && t === "/") {
        const nx = tokens[j + 1] || "";
        if (/^\d{1,3}\.\d{1,2}$/.test(nx)) { e.prevScore = parseFloat(nx); j += 2; continue; }
        j++; continue;
      }
      // 数値収集(失違+決まり手4+B の6個 → その後の成績値。最大14個まで拾う)
      if (e.score && e.prevScore != null && nums.length < 14 && (isInt(t) || isFloat(t))) {
        nums.push(parseFloat(t)); j++; continue;
      }
      if (e.score && e.prevScore != null && nums.length >= 14) break;
      j++;
    }
    // nums 前半6個: [失違, 逃, 捲, 差, マ, B]。以降が成績値
    if (nums.length >= 10) {
      e.k = { nige: nums[1], makuri: nums[2], sashi: nums[3], mark: nums[4] };
      e.B = nums[5]; e.H = nums[5];
      const w1 = e.k.nige + e.k.makuri + e.k.sashi + e.k.mark;
      const rest = nums.slice(6); // 成績値部分
      // レイアウト判定:
      //  A) 率/回数の交互8値(勝率,1着,2連,2着,3連,3着,着外率,着外) → rest.length>=8 かつ 交互パターン
      //  B) 回数のみ4値 [1着,2着,3着,着外] (countMode)
      //  C) 率のみ4値 [勝率,2連,3連,着外率]
      const looksInterleaved = rest.length >= 8 &&
        rest[0] >= rest[1] && rest[2] >= rest[3] && rest[4] >= rest[5] && // 率>=回数の傾向
        (rest[0] + rest[2] + rest[4]) > (rest[1] + rest[3] + rest[5]);   // 率合計>回数合計
      if (looksInterleaved) {
        // A: 交互。奇数番目(index1,3,5,7)が回数
        const c1 = rest[1], c2 = rest[3], c3 = rest[5], cOut = rest[7];
        e.seiseki = { win1: c1, win2: c2, win3: c3, out: cOut };
        e.rate = { win: rest[0], niren: rest[2], sanren: rest[4] };
      } else if (countMode) {
        // B: 回数のみ
        const c1 = rest[0], c2 = rest[1], c3 = rest[2], cOut = rest[3];
        const starts = c1 + c2 + c3 + cOut || 1;
        e.seiseki = { win1: c1, win2: c2, win3: c3, out: cOut };
        e.rate = {
          win: +(c1 / starts * 100).toFixed(1),
          niren: +((c1 + c2) / starts * 100).toFixed(1),
          sanren: +((c1 + c2 + c3) / starts * 100).toFixed(1),
        };
      } else {
        // C: 率のみ → 回数を逆算
        e.rate = { win: rest[0], niren: rest[1], sanren: rest[2] };
        const outRate = rest[3];
        let starts = e.rate.win > 0 ? Math.round((w1 / e.rate.win) * 100) : 12;
        starts = Math.max(Math.max(w1, 1), Math.min(40, starts));
        e.seiseki = {
          win1: w1,
          win2: Math.max(0, Math.round(starts * (e.rate.niren - e.rate.win) / 100)),
          win3: Math.max(0, Math.round(starts * (e.rate.sanren - e.rate.niren) / 100)),
          out: Math.max(0, Math.round(starts * outRate / 100)),
        };
      }
    }
    // 成績欄: 着順(数字/丸数字/棄など) + 任意のB/決まり手/タイム、日付・場名はスキップ
    while (j < tokens.length && !tokens[j].match(profRe) && tokens[j] !== "並び予想") {
      const t = tokens[j];
      if (/^\d{1,2}\/\d{1,2}$/.test(t) || /^[぀-ヿ一-龥]{1,3}(G[1-3]|F[1-2]|GP)$/.test(t)) { j++; continue; }
      let place = null;
      if (/^[1-9]$/.test(t)) place = parseInt(t);
      else if (CIRC[t] != null) place = CIRC[t];
      else if (/^(棄|落|失|欠)$/.test(t)) { e.kiken = true; e.results.push({ place: null }); j++; continue; }
      if (place != null) {
        const res = { place };
        j++;
        while (j < tokens.length) {
          const u = tokens[j];
          if (u === "B") { res.b = true; j++; continue; }
          if (/^(逃|捲|差|マ)$/.test(u)) { res.k = u; j++; continue; }
          if (isFloat(u) && timeOk(parseFloat(u))) { res.t = parseFloat(u); j++; break; }
          break;
        }
        e.results.push(res);
        continue;
      }
      j++;
    }
    const times = e.results.map((r) => r.t).filter((v) => v != null);
    if (times.length) e.avgTime = times.reduce((a2, v) => a2 + v, 0) / times.length;
    const finished = e.results.filter((r) => r.place != null);
    if (finished.length) {
      e.recentRaces = finished.length;
      e.recentWinRate = finished.filter((r) => r.place === 1).length / finished.length;
    }
    if (e.prevScore != null) e.scoreDiff = +(e.score - e.prevScore).toFixed(2);
    entries.push(e);
    i = j - 1;
  }
  if (entries.length < 5) throw new Error("Gamboo出走データを" + entries.length + "名しか読み取れませんでした。表全体を含めてコピーしてください");

  // 並び予想: 「63・147・25」形式(middle point表記にも対応)。区切り不明ならすべて単騎にして手動修正に委ねる
  let linesArr = null;
  const ni = text.indexOf("並び予想");
  if (ni !== -1) {
    let seg = text.slice(ni + 4, ni + 120);
    const stop = seg.search(/情報元|注目/);
    if (stop !== -1) seg = seg.slice(0, stop);
    seg = seg.replace(/middle\s*point/gi, "・");
    const groups = seg.match(/[1-9]+/g);
    if (groups && groups.length) {
      const cars = entries.map((e) => e.car);
      const flat = groups.join("");
      const uniq = new Set(flat.split("").map(Number));
      if (flat.length === cars.length && uniq.size === cars.length) {
        linesArr = groups.map((g) => g.split("").map(Number));
      }
    }
  }
  if (!linesArr) linesArr = entries.map((e) => [e.car]);
  return { ...meta, entries, lines: linesArr, narabi: linesArr.flat() };
}

// 形式自動判別ディスパッチャ(WINTICKET / Gamboo基本出走データ)
function parseCard(text, trackNames) {
  const looksGamboo = /基本出走データ/.test(text) || (text.match(/\([^)]*\)\/\d{1,3}\/\d{1,3}/g) || []).length >= 5;
  if (looksGamboo) {
    try { return parseGamboo(text, trackNames); } catch (e) { /* fallback */ }
  }
  return parseWinticket(text, trackNames);
}

// ---- 記事014: クラス×バンク長別の決まり手(2017/5〜2019/4実測) ----
// CLS_K[バンク長][クラス] = 1着決まり手 [逃げ,捲り,差し] %
const CLS_K = {
  33:  { s: [16.1, 44.4, 39.3], a12: [24.0, 37.1, 38.9], challenge: [41.8, 30.6, 27.5], girls: [34.2, 50.0, 15.6] },
  400: { s: [13.1, 36.4, 50.3], a12: [18.7, 34.1, 47.0], challenge: [35.4, 29.8, 34.6], girls: [24.4, 48.2, 27.3] },
  500: { s: [10.2, 30.1, 59.5], a12: [13.7, 31.2, 55.1], challenge: [32.5, 28.3, 39.0], girls: [24.0, 41.1, 34.9] },
};
// 全クラス混合の基準値(場別データとの差分=その場のクセ を求めるため)
const BASE_K = { 33: [30.9, 31.9, 37.1], 400: [24.0, 29.2, 46.7], 500: [21.5, 25.6, 52.8] };
// COND2[バンク長][クラス] = 1着決まり手別の2着決まり手分布 {n:1着逃げ時, m:1着捲り時, s:1着差し時} 各[逃,捲,差,マーク]%
const COND2 = {
  33: { s: { n: [0.6, 10.9, 27.4, 61.2], m: [8.0, 13.4, 27.2, 51.4], s: [34.1, 29.4, 20.2, 16.3] },
        a12: { n: [0.5, 8.2, 21.1, 70.2], m: [10.5, 13.0, 25.3, 51.2], s: [36.4, 26.1, 22.4, 15.1] },
        challenge: { n: [2.1, 7.2, 20.6, 70.2], m: [20.2, 11.4, 21.1, 47.3], s: [50.9, 18.6, 15.4, 15.1] },
        girls: { n: [6.0, 11.9, 7.5, 74.6], m: [28.1, 15.8, 11.7, 44.4], s: [52.5, 19.7, 6.6, 21.3] } },
  400: { s: { n: [0.8, 9.8, 29.7, 59.6], m: [7.3, 12.5, 32.3, 47.9], s: [23.5, 28.2, 31.4, 16.9] },
        a12: { n: [0.8, 8.5, 27.4, 63.3], m: [9.6, 11.8, 31.5, 47.1], s: [26.9, 23.6, 29.9, 19.6] },
        challenge: { n: [1.5, 7.3, 25.2, 66.0], m: [18.2, 11.7, 27.0, 43.0], s: [38.9, 18.6, 23.2, 19.3] },
        girls: { n: [3.5, 12.1, 23.4, 61.0], m: [18.5, 18.2, 14.3, 49.0], s: [24.4, 37.2, 12.9, 25.5] } },
  500: { s: { n: [2.0, 5.1, 37.8, 55.1], m: [8.0, 7.6, 35.0, 49.5], s: [14.4, 24.0, 41.5, 20.1] },
        a12: { n: [0.4, 7.9, 32.2, 59.5], m: [8.8, 8.4, 39.5, 43.2], s: [17.9, 17.1, 44.5, 20.5] },
        challenge: { n: [0.0, 4.5, 28.7, 66.9], m: [23.4, 12.0, 27.4, 37.2], s: [25.9, 18.8, 34.1, 21.2] },
        girls: { n: [2.4, 9.5, 21.4, 66.7], m: [8.3, 11.1, 13.9, 66.7], s: [26.2, 26.2, 18.0, 29.5] } },
};

// ---- 記事029: S級戦・7車立ての特徴(2020/7〜9実測・400バンク) ----
// 7車立て補正係数(記事014のクラス基準値に乗じる): S級・A12は7車だと逃げ増・捲り減
const SEVEN_ADJ = { s: [1.31, 0.79, 1.07], a12: [1.29, 0.88, 0.97] };
// ラインパターン別特徴(S級7車400バンク実測): freq出現率, backバック取得ライン1着率, win[先頭,番手,3番手以降/単騎]1着率, sujiスジ率, kind 2分=先行有利/3分=捲り有利
const LP = {
  "3-2-2":   { freq: 62.8, back: 56.4, win: [50.8, 47.1, 2.1],  suji: 54.7, kind: "3分" },
  "3-3-1":   { freq: 13.3, back: 67.1, win: [33.8, 54.2, 12.0], suji: 59.2, kind: "2分" },
  "2-2-2-1": { freq: 8.5,  back: 45.5, win: [50.6, 40.7, 8.8],  suji: 35.2, kind: "3分" },
  "3-2-1-1": { freq: 6.6,  back: 55.7, win: [44.3, 41.4, 14.3], suji: 48.6, kind: "2分" },
  "4-3":     { freq: 5.3,  back: 73.2, win: [39.3, 48.2, 12.5], suji: 66.1, kind: "2分" },
};
const LP_SOFT = 0.7; // S級7車の実測を他クラスへ適用する際の減衰係数
// クラス×車立ての配当中央値(2車単/3連単) 記事029
const CLASS_PAYOUT = { s9: [1740, 9140], s7: [1205, 4540], a12_7: [990, 4020], ch7: [645, 2595] };

// ---- 記事027: バック取得ラインの予測(2017/5〜2020/4実測・ロジスティック回帰) ----
// LOGIT[key] = [x1:先頭の直近B数(21走換算), x2:同H数, x3:ライン長, x4:G指数値(得点の中央値差), x5:番手が年上, 定数]
// x4はチャレンジのみ先頭選手、他は番手選手の値を使う
const LOGIT = {
  s:      [0.113, 0.050, 0.556, 0.051, -0.021, -3.416],
  a12_9:  [0.111, 0.047, 0.671, 0.053, -0.051, -3.764],
  a12_7:  [0.110, 0.064, 0.815, 0.067,  0.046, -3.784],
  ch:     [0.063, 0.085, 0.902, 0.131, -0.090, -4.112],
};
// バック取得ラインの実測成績 BK[key].head/second = [[33勝率,33連対],[400勝率,400連対],[500勝率,500連対]]
const BK = {
  s:     { head: [[27.58, 49.49], [19.72, 38.30], [18.28, 33.46]], second: [[26.00, 50.97], [28.30, 50.05], [24.97, 44.79]] },
  a12_9: { head: [[32.85, 54.14], [24.57, 42.99], [17.36, 33.43]], second: [[25.17, 51.02], [25.33, 48.63], [22.84, 44.85]] },
  a12_7: { head: [[39.85, 62.60], [30.48, 52.22], [26.83, 46.33]], second: [[25.84, 57.46], [25.58, 52.77], [22.78, 48.65]] },
  ch:    { head: [[52.82, 72.67], [44.68, 65.07], [44.29, 63.96]], second: [[17.22, 50.31], [17.80, 47.59], [17.47, 46.26]] },
};
const bkKey = (klass, nCars) => klass === "challenge" ? "ch" : klass === "s" ? "s" : nCars >= 8 ? "a12_9" : "a12_7";

// ラインのバック取得確率(研究所回帰式)
function backProb(line, byCar, klass, nCars, medianScore) {
  if (line.length < 2) return null;
  const head = byCar[line[0]], second = byCar[line[1]];
  const st = head.seiseki, starts = st.win1 + st.win2 + st.win3 + st.out;
  const x1 = Math.min(21, starts > 0 ? (head.B / starts) * 21 : 0);
  const x2 = Math.min(21, starts > 0 ? (head.H / starts) * 21 : 0);
  const x3 = line.length;
  const gTarget = klass === "challenge" ? head : second;
  const x4 = gTarget.score - medianScore;
  const x5 = second.age > head.age ? 1 : 0;
  const c = LOGIT[bkKey(klass, nCars)];
  const z = c[0] * x1 + c[1] * x2 + c[2] * x3 + c[3] * x4 + c[4] * x5 + c[5];
  return 1 / (1 + Math.exp(-z));
}

function detectKlass(grade) {
  const g = grade || "";
  if (/ガールズ|[LＬ]級/.test(g)) return "girls";
  if (/チャレンジ|[AＡ]級チ/.test(g)) return "challenge";
  if (/[SＳ]級/.test(g)) return "s";
  return "a12";
}

// ---------- 採点モデル ----------
// bank: [周長,直線,カント,ドーム,雨率,風率,逃%,捲%,差%,2着マ%,スジ率,力率,先頭1着%,番手1着%,3番手2着%,単騎1着%,3連単平均]
function predict(parsed, bank, trackName, learnW) {
  const es = parsed.entries;
  const byCar = {}; es.forEach((e) => (byCar[e.car] = e));
  const b = bank || [400, 54.1, 31.9, 0, 10, 6, 24, 29.2, 46.7, 40.6, 53.3, 27, 54.4, 38.7, 9.3, 3.8, 14000];
  const [, , , dome, , windRate, bNige, bMakuri, bSashi, bMark, suji, chikara, hL1, hL2, , hTanki, p3avg] = b;
  const klass = detectKlass(parsed.grade);
  const lines = klass === "girls" ? es.map((e) => [e.car]) : parsed.lines;

  // 記事014: クラス×バンク長の基準決まり手に「その場のクセ(全クラス平均との差)」を上乗せした実効決まり手
  const lenKey = (b[0] || 400) < 400 ? 33 : (b[0] || 400) > 400 ? 500 : 400;
  const base = BASE_K[lenKey];
  let cls = CLS_K[lenKey][klass];
  // 記事029: S級・A12は7車立てだと逃げ増・捲り減(基準値に補正係数を乗じて正規化)
  if (es.length <= 7 && SEVEN_ADJ[klass]) {
    const adj = SEVEN_ADJ[klass];
    const t0 = [cls[0] * adj[0], cls[1] * adj[1], cls[2] * adj[2]];
    const tSum = t0[0] + t0[1] + t0[2];
    cls = [t0[0] / tSum * 100, t0[1] / tSum * 100, t0[2] / tSum * 100];
  }
  // 記事029: ラインパターン(2分戦=先行有利/3分戦=捲り有利)
  const patStr = [...parsed.lines].map((l) => l.length).sort((x, y) => y - x).join("-");
  const lp = klass !== "girls" ? LP[patStr] : null;
  const lpKimarite = lp ? (lp.kind === "2分" ? [1 + 0.10 * LP_SOFT, 1 - 0.10 * LP_SOFT, 1] : [1 - 0.08 * LP_SOFT, 1 + 0.10 * LP_SOFT, 1]) : [1, 1, 1];
  const devN = bNige - base[0], devM = bMakuri - base[1], devS = bSashi - base[2];
  let effRaw = [Math.max(2, (cls[0] + devN) * lpKimarite[0]), Math.max(2, (cls[1] + devM) * lpKimarite[1]), Math.max(2, (cls[2] + devS) * lpKimarite[2])];
  const effSum = effRaw[0] + effRaw[1] + effRaw[2];
  const eff = { n: effRaw[0] / effSum * 100, m: effRaw[1] / effSum * 100, s: effRaw[2] / effSum * 100 };
  const cond2 = COND2[lenKey][klass];
  const isRain = /雨|雪/.test(parsed.weather || "");

  // 役割(先頭/番手/3番手〜/単騎)
  const role = {};
  lines.forEach((line) => line.forEach((c, idx) => {
    role[c] = line.length === 1 ? "単騎" : idx === 0 ? "先頭" : idx === 1 ? "番手" : "3番手";
  }));

  // 主導権(バック取得予測)ライン: 記事027のロジスティック回帰式で各ラインのPbkを算出
  const nCars = es.length;
  const sortedPts = es.map((x) => x.score).sort((a, b2) => a - b2);
  const medianScore = sortedPts.length % 2 ? sortedPts[(sortedPts.length - 1) / 2]
    : (sortedPts[sortedPts.length / 2 - 1] + sortedPts[sortedPts.length / 2]) / 2;
  const backProbs = [];
  lines.forEach((line) => {
    const p = backProb(line, byCar, klass, nCars, medianScore);
    if (p != null) backProbs.push({ line, p });
  });
  backProbs.sort((x, y) => y.p - x.p);
  const leadLine = backProbs.length ? backProbs[0].line : null;
  const backBalanced = backProbs.length >= 2 && (backProbs[0].p - backProbs[1].p) < 0.05;
  const bkT = BK[bkKey(klass, nCars)];
  const bankIdx = (b[0] || 400) < 400 ? 0 : (b[0] || 400) > 400 ? 2 : 1;
  const baseWin = 100 / nCars;

  // 捲り脅威(主導権ライン外の自力)
  let threat = null, threatV = -1;
  es.forEach((e) => {
    if (leadLine && leadLine.includes(e.car)) return;
    const v = e.k.makuri * 2 + e.k.nige + (e.kyaku !== "追" ? 2 : 0) + e.B * 0.5;
    if ((role[e.car] === "先頭" || role[e.car] === "単騎") && v > threatV) { threatV = v; threat = e; }
  });

  // 記事048: 直近3場所勝率60%以上は得点に+0.1〜3.0点、得点の現/前トレンドも微補正して実力順位を判定
  const hotOf = {}, adj048 = {};
  es.forEach((e) => {
    let hot = 0, trend = 0;
    if (e.recentWinRate != null && e.recentRaces >= 3 && e.recentWinRate >= 0.6)
      hot = Math.min(3, 0.1 + (e.recentWinRate - 0.6) * 7);
    if (e.scoreDiff) trend = Math.max(-1.5, Math.min(1.5, e.scoreDiff)) * 0.6;
    hotOf[e.car] = hot; adj048[e.car] = hot + trend;
  });
  const ptRank = [...es].sort((a, b2) => (b2.score + (adj048[b2.car] || 0)) - (a.score + (adj048[a.car] || 0))).map((x) => x.car);
  const timed = es.filter((e) => e.avgTime != null);
  const fieldAvgTime = timed.length ? timed.reduce((a2, e) => a2 + e.avgTime, 0) / timed.length : null;

  const scores = es.map((e) => {
    const st = e.seiseki, starts = st.win1 + st.win2 + st.win3 + st.out;
    const d = { n: e.k.nige, m: e.k.makuri, s: e.k.sashi, mk: e.k.mark };
    const dSum = d.n + d.m + d.s + d.mk || 1;

    const rk = ptRank.indexOf(e.car);
    let ptScore = es.length > 1 ? (22 * (es.length - 1 - rk)) / (es.length - 1) : 11;
    if (klass === "girls") ptScore *= 1.25; // 記事048: ガールズは実力(得点)寄与が約70%

    const shrink = Math.min(1, starts / 10);
    const rateS = (e.rate.win * 0.5 + e.rate.niren * 0.3 + e.rate.sanren * 0.2) / 100;
    const outPen = starts > 0 ? st.out / starts : 0.5;
    let form = (rateS * 26 + (1 - outPen) * 8) * shrink + 13 * (1 - shrink);
    if (e.avgTime != null && fieldAvgTime != null && timed.length >= es.length / 2)
      form += Math.max(-3, Math.min(3, (fieldAvgTime - e.avgTime) * 6)); // 直近平均上がりの相対評価

    const wins = (Math.min(st.win1, 8) / 8) * 10;

    const fit = ((d.n / dSum) * eff.n + (d.m / dSum) * eff.m + (d.s / dSum) * eff.s + (d.mk / dSum) * bMark) / 100 * 32
      * (0.5 + 0.5 * Math.min(dSum, 8) / 8);

    const r = role[e.car];
    let pos = r === "先頭" ? hL1 * 0.22 : r === "番手" ? hL2 * 0.28 : r === "単騎" ? hTanki * 2.2 : 5.5;
    // バック取得予測ラインへのボーナス(記事027の実測勝率と全選手平均勝率の差でスケール)
    // 記事029: パターンによりバック取得の有利度が変わる(4-3:73.2%〜2-2-2-1:45.5%、全体58.9%)
    const lpBkScale = lp ? 1 + (lp.back / 58.9 - 1) * LP_SOFT : 1;
    const bkBonusFor = (line, factor) => {
      if (!line || !line.includes(e.car)) return 0;
      let v = 0;
      if (r === "先頭") v = (bkT.head[bankIdx][0] - baseWin) * 0.16 * factor * lpBkScale + devN * 0.2;
      if (r === "番手") v = (bkT.second[bankIdx][0] - baseWin) * 0.16 * factor * lpBkScale + devS * 0.15;
      if (r === "3番手") v = 1.5 * factor;
      // パターン別の先頭/番手の1着率差(S級7車実測、全体47.3/47.2)を微反映
      if (lp && r === "先頭") v += (lp.win[0] - 47.3) * 0.05 * LP_SOFT;
      if (lp && r === "番手") v += (lp.win[1] - 47.2) * 0.05 * LP_SOFT;
      return v;
    };
    pos += bkBonusFor(leadLine, 1);
    if (backBalanced && backProbs[1]) pos += bkBonusFor(backProbs[1].line, 0.6);
    // 記事029: 3-3-1/3-2-1-1/4-3型は「3番手以降・単騎」の1着が12〜14%と紛れが出やすい
    if (lp && (r === "3番手" || r === "単騎")) pos += (lp.win[2] - 5.5) * 0.15 * LP_SOFT;
    if (threat && threat.car === e.car) pos += 2.5 + devM * 0.2;
    // 記事014: 風速と逃げ率は負の相関(-0.42)。当日風3m以上で先頭を段階減点、風の強い場は影響増幅
    if (!dome && (parsed.windSpeed || 0) >= 3 && r === "先頭") {
      pos -= Math.min(4, parsed.windSpeed - 2) * 0.8 * (windRate >= 12 ? 1.5 : 1);
    }
    // 記事014: 雨天はA級(A12・チャレンジ)に限り先行やや有利(S級は逆に不利傾向のため加点なし)
    if (!dome && isRain && (klass === "a12" || klass === "challenge") && r === "先頭") pos += 0.8;

    if (klass === "girls") pos *= 0.75; // 記事048: ガールズは展開寄与が小さい
    const sB = Math.min(e.S, 9) / 9 * 3;

    let gap = 0;
    if (rk <= 1 && e.rate.win < 10) gap -= 5;
    if (rk <= 1 && st.win1 === 0) gap -= 3;

    // 学習補正(learn.jsがweights.jsonに出力した実測ベースのボーナス)
    let lw = 0;
    if (learnW) {
      const posKey = r === "先頭" ? "head" : r === "番手" ? "second" : r === "単騎" ? "tanki" : "third";
      if (learnW.posBonus && learnW.posBonus[posKey]) lw += learnW.posBonus[posKey];
      const ki = parseInt(e.ki) || 0;
      const kb = ki >= 121 ? "期121+(若手)" : ki >= 111 ? "期111-120" : ki >= 100 ? "期100-110" : ki > 0 ? "期99以下(ベテラン)" : null;
      if (kb && learnW.kiBonus && learnW.kiBonus[kb]) lw += learnW.kiBonus[kb];
      const a = e.age || 0;
      const ab = a > 0 && a <= 23 ? "23歳以下" : a <= 27 && a > 0 ? "24-27歳" : a <= 35 && a > 0 ? "28-35歳" : a > 35 ? "36歳以上" : null;
      if (ab && learnW.ageBonus && learnW.ageBonus[ab]) lw += learnW.ageBonus[ab];
    }
    const total = ptScore + form + wins + fit + pos + sB + gap + lw;
    return { car: e.car, name: e.name, total, br: { 得点: ptScore, 調子: form, 勝ち星: wins, 適性: fit, 位置: pos, S: sB, 乖離: gap, 学習: +lw.toFixed(1) }, role: r };
  }).sort((a, b2) => b2.total - a.total);
  const totalOf = {}; scores.forEach((s) => (totalOf[s.car] = s.total));

  // ---- レース形態(二分戦/三分戦/四分戦)とライン人気順(スコア代用) ----
  const multi = lines.filter((l) => l.length >= 2);
  const formation = multi.length;
  const rankedLines = [...multi].sort((x, y) => Math.max(...y.map((c) => totalOf[c])) - Math.max(...x.map((c) => totalOf[c])));
  const topIsTanki = scores.length && role[scores[0].car] === "単騎";
  const group = GROUP_A.has(trackName) ? "A" : "B";
  const gi = group === "A" ? 0 : 2;
  const simTable = SIM[Math.min(Math.max(formation, 2), 4)];
  const sujiPlan = [];
  if (klass !== "girls" && formation >= 2 && formation <= 4 && !topIsTanki && simTable) {
    rankedLines.forEach((l, i) => {
      const row = simTable[i + 1]; if (!row) return;
      sujiPlan.push({
        rank: i + 1, line: l, ticket: l[0] + "-" + l[1],
        hit: row.o[gi], roi: row.o[gi + 1], hitAll: row.o[4], roiAll: row.o[5],
        uraRoi: row.u[gi + 1],
        grade: row.o[gi + 1] >= 90 ? "妙味" : row.o[gi + 1] >= 75 ? "標準" : "低",
      });
    });
  }

  // 印
  const MARKS = ["◎", "○", "▲", "△", "×", "注"];
  const marks = scores.slice(0, Math.min(6, scores.length)).map((s, i) => {
    const e = byCar[s.car];
    const reasons = [];
    const brTop = Object.entries(s.br).filter(([k]) => k !== "乖離").sort((a, b3) => b3[1] - a[1]).slice(0, 2).map(([k]) => k);
    if (brTop.includes("得点")) reasons.push("得点上位");
    if (hotOf[s.car] >= 0.5) reasons.push("直近勝率" + (e.recentWinRate * 100).toFixed(0) + "%の急上昇(研究所048:得点+" + hotOf[s.car].toFixed(1) + "点相当)");
    if (brTop.includes("調子") || brTop.includes("勝ち星")) reasons.push(`直近好調(1着${e.seiseki.win1}回/勝率${e.rate.win}%)`);
    if (brTop.includes("適性")) reasons.push("脚質がこのバンク向き");
    if (brTop.includes("位置")) reasons.push(s.role === "番手" ? "有利な番手" : s.role === "先頭" ? "主導権濃厚" : s.role === "単騎" ? "単騎自在" : "位置有利");
    if (s.br.乖離 < 0) reasons.push("※得点の割に直近勝ち星なく過信禁物");
    if (leadLine && leadLine[0] === s.car) reasons.push("先行力最上位");
    if (klass === "challenge" && s.role === "先頭") reasons.push("チャレンジ戦は押し切り最多");
    if (threat && threat.car === s.car) reasons.push("捲り一撃");
    return { mark: MARKS[i], car: s.car, name: s.name, reason: [...new Set(reasons)].slice(0, 3).join("・"), role: s.role };
  });

  // 展開文
  const lh = leadLine ? byCar[leadLine[0]] : null;
  const l2 = leadLine && leadLine[1] ? byCar[leadLine[1]] : null;
  const parts = [];
  if (lh && backProbs.length) {
    const pb = (backProbs[0].p * 100).toFixed(0);
    parts.push(`バック取得予測は[${leadLine.join("")}]ライン(確率${pb}%・研究所回帰式)。先頭${lh.car}番${lh.name}${l2 ? `、番手${l2.car}番${l2.name}は${eff.s >= 40 ? "このクラス実効差し比率" + eff.s.toFixed(0) + "%の展開では絶好の位置" : "1着逃げ時の2着マーク率" + cond2.n[3].toFixed(0) + "%と残り目十分"}` : ""}。`);
    if (backBalanced) parts.push(`ただし[${backProbs[1].line.join("")}]ラインと確率が均衡(差5%未満)しており、主導権争いで荒れる可能性あり。`);
  } else if (lh) {
    parts.push(`主導権は${lh.car}番${lh.name}のラインが最有力。`);
  }
  if (threat) parts.push(`${threat.car}番${threat.name}(${role[threat.car]})が中団から捲る動きに警戒。`);
  parts.push(`本命は総合力最上位の${marks[0].car}番${marks[0].name}。`);
  if (klass === "challenge") parts.push(`チャレンジ戦は「先頭→番手」決着が31.8%と全クラス最多、番手が差し返す「番手→先頭」は13.0%しかなく、素直に先行力を評価したい。`);
  if (klass === "s") parts.push(`S級戦は番手が差す「番手→先頭」も16.8%あり、番手勢の頭も一考。`);
  {
    const top = scores[0], topE = byCar[top.car];
    if (top.role === "先頭" && topE.kyaku !== "追") parts.push(`本命が逃げ切る場合、2着はマーク(番手)が${cond2.n[3].toFixed(0)}%と圧倒的(研究所014)。`);
    else if ((topE.k.sashi >= topE.k.nige && topE.k.sashi >= topE.k.makuri) || top.role === "番手") parts.push(`1着が差しの場合の2着は逃げ(先頭残り)${cond2.s[0].toFixed(0)}%が最多で、差した相手のラインが残りやすい(研究所014)。`);
  }
  if (!dome && isRain && klass !== "s") parts.push(`雨天のA級戦は先行やや有利の傾向(研究所014)。`);
  if (!dome && windRate >= 12) parts.push(`当場は風レース率${windRate}%${(parsed.windSpeed || 0) >= 3 ? "、当日も風" + parsed.windSpeed + "m/sで先行勢はやや割引" : "。当日の風は" + (parsed.windSpeed != null ? parsed.windSpeed + "m/sと穏やか" : "要確認")}。`);
  const tenkai = parts.join("");

  // ---- 買い目(方針: 隊列の先頭役=ライン先頭+単騎 を評価で比較。単騎が抜きん出れば単騎頭、それ以外は先頭同士で強い方のラインを本線) ----
  const [a1, a2, a3, a4, a5x] = marks.map((m) => m.car);
  const rankOf = {}; scores.forEach((sc, i) => (rankOf[sc.car] = i));
  const isMulti = (l) => l && l.length >= 2;
  // 各ラインを「先頭選手の総合評価」で順位付け
  const headsInfo = lines.filter(isMulti)
    .map((l) => ({ line: l, head: l[0], t: totalOf[l[0]] || 0 }))
    .sort((x, y) => y.t - x.t);
  const tankiList = klass === "girls" ? [] : lines.filter((l) => l.length === 1).map((l) => l[0]);
  const bestHeadT = headsInfo.length ? headsInfo[0].t : -Infinity;
  // 単騎が「ライン先頭の最上位」より一定以上強ければ、その単騎を頭に据える
  const STRONG_MARGIN = 5;
  let strongTanki = null;
  const tankiSorted = [...tankiList].sort((x, y) => (totalOf[y] || 0) - (totalOf[x] || 0));
  if (tankiSorted.length && (totalOf[tankiSorted[0]] || 0) - bestHeadT >= STRONG_MARGIN) strongTanki = tankiSorted[0];

  let mainLine = null, planNote = "";
  if (headsInfo.length) {
    const topH = headsInfo[0], secH = headsInfo[1];
    // 先頭同士の総合評価が拮抗 → バック取得予測1位ラインを主導権本線に
    if (secH && (topH.t - secH.t) < 4 && leadLine && isMulti(leadLine) && leadLine[0] !== topH.head) {
      mainLine = leadLine;
      const lpp = backProbs[0] ? (backProbs[0].p * 100).toFixed(0) : "";
      planNote = `先頭同士が拮抗(${topH.head}番 vs ${secH.head}番)のため、主導権を取りそうな[${leadLine.join("")}]ライン(バック取得予測${lpp}%)を本線に。`;
    } else {
      mainLine = topH.line;
      planNote = `先頭同士を比べて評価上位の${topH.head}番がいる[${topH.line.join("")}]ラインを本線に。`;
    }
  }
  // 単騎の組込(頭にはしないが3着圏内で押さえる単騎)
  const inTankis = tankiList.filter((c) => c !== strongTanki && (rankOf[c] <= 4 || backBalanced));
  if (strongTanki != null) planNote = `単騎${strongTanki}番の評価が各ライン先頭より抜けているため単騎を1着(アタマ)に据える。相手は` + planNote.replace(/^先頭同士を比べて評価上位の/, "先頭最上位の");
  if (inTankis.length) planNote += ` 単騎${inTankis.join(",")}番は3着以内の可能性ありと見て買い目に組込。`;

  // フォーメーション構築(買い目: 1着=評価1位固定 / 2・3着=評価2〜4位 の3連単6点、2車単なし)
  const uniq = (arr) => [...new Set(arr.filter((v) => v != null))];
  const ranked = scores.map((sc) => sc.car); // 総合評価の高い順
  const first = [ranked[0]];
  const second = uniq([ranked[1], ranked[2], ranked[3]]);
  const third = uniq([ranked[1], ranked[2], ranked[3]]);

  const nishatan = []; // 2車単は使用しない
  const sanrentan = [];
  const addS = (x, y, z) => { if (x == null || y == null || z == null || x === y || y === z || x === z) return; const t = x + "-" + y + "-" + z; if (!sanrentan.includes(t)) sanrentan.push(t); };
  // 1着=評価1位、2着3着=評価2〜4位の順列(3P2 = 6点)
  first.forEach((f) => second.forEach((s2c) => third.forEach((t3) => addS(f, s2c, t3))));

  // 買い目方針(表示用)を新方式に上書き
  planNote = "買い目は評価1位の" + ranked[0] + "番を1着固定、2・3着に評価2〜4位(" + [ranked[1], ranked[2], ranked[3]].filter((v) => v != null).join("・") + "番)を配した3連単" + sanrentan.length + "点。";

  if (lp) {
    if (lp.kind === "2分") parts.push(`隊形は${patStr}型の2分戦。先行有利・捲り減の形(研究所029)。`);
    else parts.push(`隊形は${patStr}型の3分戦。捲りが決まりやすい形(研究所029)。`);
  }

  const gap12 = scores[1] ? scores[0].total - scores[1].total : 99;
  const confidence = gap12 >= 6 && p3avg < 14000 ? "高" : gap12 < 2.5 || p3avg > 15000 ? "低" : "中";
  const fLabel = klass === "girls" ? "ガールズ(ライン無し)" : formation >= 2 && formation <= 4 ? ["", "", "二分戦", "三分戦", "四分戦"][formation] : formation < 2 ? "先行一車型" : formation + "分戦";
  const bankFit = `${trackName || parsed.place}は差し${bSashi}%・スジ率${suji}%、クラス補正後の実効決まり手は逃${eff.n.toFixed(0)}/捲${eff.m.toFixed(0)}/差${eff.s.toFixed(0)}%(研究所014)${dome ? "・屋内ドーム" : ""}、スジ回収率グループ${group}(${group === "A" ? "スジ有利" : "スジ薄め・スジ違い警戒"})。${bSashi >= 48 ? "番手勢を厚めに評価" : bNige >= 28 ? "先行勢を厚めに評価" : "脚質バランス型として評価"}した。`;
  const kikenCars = es.filter((e) => e.kiken).map((e) => e.car);
  let caution = planNote + (kikenCars.length ? kikenCars.join(",") + "番は直近に棄権・落車・失格あり。" : "") + (topIsTanki ? "本命が単騎のためスジ実測データの適用外。荒れやすい形。" : "") + (confidence === "低" ? "上位が拮抗。点数は絞りすぎない方が良い。" : `裏(番手→先頭)は実測回収率60%台のため原則非推奨。${threat ? threat.car + "番の捲り不発ならライン決着濃厚。" : ""}`);
  if (lp) {
    if (lp.suji <= 40) caution += `${patStr}型はスジ率${lp.suji}%と崩れやすく(S級7車実測)、スジ違いも視野に。`;
    else if (lp.suji >= 59) caution += `${patStr}型はスジ率${lp.suji}%と堅い形(S級7車実測)。`;
    if (lp.win[2] >= 10) caution += `この型は3番手以降・単騎の1着が${lp.win[2]}%あり一発に注意。`;
  }
  const cpKey = klass === "challenge" ? "ch7" : klass === "s" ? (es.length >= 8 ? "s9" : "s7") : "a12_7";
  const cp = CLASS_PAYOUT[cpKey];
  const oddsGuide = cp ? `このクラスの配当中央値は2車単${cp[0].toLocaleString()}円/3連単${cp[1].toLocaleString()}円(研究所029)。2車単は約32倍以下なら回収率75%前後が実測値、316倍超の大穴は極端に非効率。` : "";

  return { scores, marks, tenkai, bets: { nishatan, sanrentan }, bankFit, caution, confidence, leadLine, threat: threat ? threat.car : null, klass, formation, fLabel, group, sujiPlan, topIsTanki,
    effK: eff, linePattern: patStr, lpInfo: lp || null, oddsGuide, backProbs, backBalanced, bkStats: { key: bkKey(klass, nCars), head: bkT.head[bankIdx], second: bkT.second[bankIdx], baseWin },
    mainLine, planNote, strongTanki, inTankis, betFirst: first, betSecond: second, betThird: third };
}

// ---------- スジ決着期待度(1・2着がラインで決まりそうか) ----------
// 場のスジ率を基準に、隊形・クラス・主導権の明確さ・単騎数で加減点(研究所020/027/029)
function sujiExpect(parsed, r, bankSuji) {
  if (r.klass === "girls") return null; // ガールズはライン無し=対象外
  const reasons = [];
  let s = bankSuji != null ? bankSuji : 53;
  reasons.push("場のスジ率" + s + "%");
  if (r.lpInfo) {
    const d = (r.lpInfo.suji - 54.1) * 0.8;
    s += d;
    reasons.push(r.linePattern + "型(実測スジ率" + r.lpInfo.suji + "%)" + (d >= 0 ? "+" : "") + d.toFixed(1));
  } else if (r.formation === 2) { s += 2; reasons.push("二分戦+2"); }
  else if (r.formation >= 4) { s -= 2; reasons.push("四分戦以上-2"); }
  if (r.klass === "challenge") { s += 3; reasons.push("チャレンジ戦(先→二が全クラス最多)+3"); }
  if (r.klass === "s") { s -= 1; reasons.push("S級-1"); }
  const pb = r.backProbs && r.backProbs[0] ? r.backProbs[0].p : 0;
  if (r.backBalanced) { s -= 4; reasons.push("主導権拮抗-4"); }
  else if (pb >= 0.35) { s += 3; reasons.push("主導権明確(Pbk" + (pb * 100).toFixed(0) + "%)+3"); }
  const tankis = (parsed.lines || []).filter((l) => l.length === 1).length;
  if (tankis) { s -= tankis * 1.5; reasons.push("単騎" + tankis + "名-" + (tankis * 1.5).toFixed(1)); }
  if (r.topIsTanki) { s -= 4; reasons.push("本命が単騎-4"); }
  s = Math.max(20, Math.min(78, s));
  const verdict = s >= 60 ? "◎スジ堅い" : s >= 54 ? "○スジ寄り" : s >= 48 ? "△互角" : "×荒れ含み";
  return { score: +s.toFixed(1), verdict, reasons };
}

if (typeof module !== "undefined") module.exports = { parseCard, predict, detectKlass, sujiExpect };
