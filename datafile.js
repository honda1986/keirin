// ============================================================
// datafile.js — races.json・latest.json を合言葉で暗号化して置く(他の人がアプリを使えないように。hikitsugi §4-22)
//
// ・合言葉は GitHub の Secrets の KEIRIN_PASS(Actions)か、PC の .keirin_pass(pc\set_pass.bat で作る。git には入れない)。
//   ★合言葉そのものはどこにも書かない(このファイルにも、リポジトリにも)
// ・合言葉があれば書くときに暗号化、無ければ今までどおりそのまま書く(合言葉を設定した時点から暗号化が始まる)
// ・読むときは暗号化されていれば解く。合言葉が無いのに暗号化されていたら、何をすればいいかを書いたエラーにする
// ・形: { ...そのまま見せてよい項目(updatedAt・date・source), enc: { v:1, iv, ct } }
//   鍵 = PBKDF2-SHA256(合言葉, "keirin-data-v1", 150000回) の32バイト / 暗号 = AES-256-GCM(ct の最後の16バイトが認証タグ)
//   アプリ(index.html の openData)も同じ形で解く。node datacheck.js で突き合わせる
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SALT = "keirin-data-v1";
const ITER = 150000;
const PASS_FILE = path.join(__dirname, ".keirin_pass");
const NOKEY = "races.json などが合言葉で暗号化されていますが、合言葉が設定されていません。" +
  "PC は pc\\set_pass.bat で、GitHub は Settings → Secrets and variables → Actions の KEIRIN_PASS で設定してください";

let cache = null;
function passphrase() {
  const e = (process.env.KEIRIN_PASS || "").trim();   // Secrets に改行ごと入れても同じになるように(アプリも trim する)
  if (e) return e;
  try { const s = fs.readFileSync(PASS_FILE, "utf8").trim(); return s || null; } catch (e) { return null; }
}
function key() {
  const p = passphrase();
  if (!p) return null;
  if (cache && cache.p === p) return cache.k;
  cache = { p, k: crypto.pbkdf2Sync(p, SALT, ITER, 32, "sha256") };
  return cache.k;
}
const hasKey = () => !!passphrase();

// obj を暗号化した形にする。合言葉が無ければ null
function seal(obj, header) {
  const k = key();
  if (!k) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final(), c.getAuthTag()]);
  return { ...(header || {}), enc: { v: 1, iv: iv.toString("base64"), ct: ct.toString("base64") } };
}
// 暗号化されていれば解く。されていなければそのまま
function open(j) {
  if (!j || typeof j !== "object" || !j.enc) return j;
  const k = key();
  if (!k) throw new Error(NOKEY);
  const iv = Buffer.from(j.enc.iv, "base64"), buf = Buffer.from(j.enc.ct, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", k, iv);
  d.setAuthTag(buf.subarray(buf.length - 16));
  try {
    return JSON.parse(Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString("utf8"));
  } catch (e) {
    throw new Error("races.json などを解けません。合言葉が GitHub(KEIRIN_PASS)と PC(pc\\set_pass.bat)で違っていないか確かめてください");
  }
}
const isSealed = (j) => !!(j && typeof j === "object" && j.enc);
const parse = (text) => open(JSON.parse(text));
const read = (file) => parse(fs.readFileSync(file, "utf8"));
// 書く文字列。合言葉があれば暗号化(header はそのまま見せてよい項目だけ)
const stringify = (obj, header) => JSON.stringify(seal(obj, header) || obj);
function write(file, obj, header) { fs.writeFileSync(file, stringify(obj, header)); return hasKey(); }

module.exports = { seal, open, parse, read, write, stringify, isSealed, hasKey, SALT, ITER, PASS_FILE };
