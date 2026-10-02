// datacheck.js — 合言葉の暗号化(datafile.js)をアプリ(index.html の openData)が解けるか。ずれたら終了コード1
//   index.html の「合言葉」の部分をそのまま取り出して Node の WebCrypto で動かす(ブラウザと同じ API)
"use strict";
process.env.KEIRIN_PASS = "テスト用の合言葉-not-real";
const fs = require("fs");
const DF = require("./datafile.js");
let bad = 0;
const ok = (c, m) => { console.log((c ? "○ " : "× ") + m); if (!c) bad++; };

const html = fs.readFileSync(__dirname + "/index.html", "utf8");
const a = html.indexOf("// ---- 合言葉"), b = html.indexOf("let LOCK_SAMPLE");
if (a < 0 || b < 0) { console.log("index.html に合言葉の部分が見つかりません"); process.exit(1); }
const store = {};
const localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
const page = new Function("localStorage", "crypto", html.slice(a, b) + "\nreturn { deriveKey, openData, setKey: (k) => { LOCK_KEY = Promise.resolve(k); } };")(localStorage, globalThis.crypto);

(async () => {
  const obj = { updatedAt: "2026-10-02T00:00:00.000Z", date: "20261002", source: "PC", races: { "防府_4R": { t: "12:00:00", o: [12.3, 9999.9] } }, 日本語: "競輪・合言葉" };
  const text = DF.stringify(obj, { updatedAt: obj.updatedAt, date: obj.date, source: obj.source });
  const j = JSON.parse(text);
  ok(DF.isSealed(j) && j.source === "PC" && j.date === "20261002" && !j.races && !/防府/.test(text), "暗号化され、見せてよい項目だけ見える");
  ok(JSON.stringify(DF.open(j)) === JSON.stringify(obj), "Node で元に戻る");
  ok(JSON.stringify(DF.parse(JSON.stringify(obj))) === JSON.stringify(obj), "暗号化していないファイルはそのまま読める");

  ok(await page.openData(j).then(() => false, (e) => !!e.lock), "アプリ: 鍵が無いと合言葉の画面になる");
  const k = await page.deriveKey("  " + process.env.KEIRIN_PASS + "\n");   // 前後の空白・改行は無視
  page.setKey(k.key);
  ok(JSON.stringify(await page.openData(j)) === JSON.stringify(obj), "アプリ: 同じ合言葉で解ける(Node で暗号化 → ブラウザで解く)");
  ok(k.raw.byteLength === 32 && Buffer.from(k.raw).equals(require("crypto").pbkdf2Sync(process.env.KEIRIN_PASS, DF.SALT, DF.ITER, 32, "sha256")), "アプリと Node の鍵が同じ");
  page.setKey((await page.deriveKey("ちがう合言葉")).key);
  ok(await page.openData(j).then(() => false, (e) => !!e.lock), "アプリ: 違う合言葉だと解けない");
  ok(JSON.stringify(await page.openData(obj)) === JSON.stringify(obj), "アプリ: 暗号化していないファイルはそのまま");

  const t2 = JSON.parse(text); t2.enc.ct = Buffer.from(Buffer.from(t2.enc.ct, "base64").map((x, i) => (i === 3 ? x ^ 1 : x))).toString("base64");
  ok((() => { try { DF.open(t2); return false; } catch (e) { return /合言葉/.test(e.message); } })(), "Node: 書き換えられたファイルは解かない");
  ok(JSON.parse(DF.stringify(obj)).enc.iv !== j.enc.iv, "毎回ちがう iv");

  if (bad) { console.log("★" + bad + "件 合いません"); process.exit(1); }
  console.log("一致");
})().catch((e) => { console.log("★" + e.stack); process.exit(1); });
