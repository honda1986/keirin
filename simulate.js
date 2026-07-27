// ============================================================
// バックテスト・シミュレーター
// history.json の全レースに様々な買い目パターンを適用し、
// 的中率・回収率・収支を比較して sim.json に出力する。
// 使い方: node simulate.js
// 前提: history.json の各エントリに ranks(評価順の全車番), f/s/t(着順), p3pay(3連単配当) が必要。
//        ranks が無い古いデータは自動でスキップします。
// ============================================================
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const hist = JSON.parse(fs.readFileSync(path.join(dir, "history.json"), "utf8"));
// 2車単だけを評価するため、3連単配当が無いレースも対象に含める(2車単配当があれば十分)
const ALL = (hist.entries || []).filter((e) => Array.isArray(e.ranks) && e.ranks.length >= 4 && (e.p2pay || e.p3pay || e.p3fpay));
console.log("シミュレーション対象:", ALL.length, "レース (ranks付き)");
{
  const n2 = ALL.filter((e) => e.p2pay != null).length;
  const f3 = ALL.filter((e) => e.p3fpay != null && e.t != null).length;
  console.log("  うち 2車単を評価できる:", n2, "レース / 3連複を評価できる:", f3, "レース");
  if (!f3) console.log("  ※ 3連複データがありません。sanpuku.js --apply を先に実行してください");
}

// 学習補正を読み込み、riders(素点付き)から「補正後の評価順」を再構築
let LW = null;
try { LW = JSON.parse(fs.readFileSync(path.join(dir, "weights.json"), "utf8")); } catch (e) {}
const kiBand = (ki) => ki >= 121 ? "期121+(若手)" : ki >= 111 ? "期111-120" : ki >= 100 ? "期100-110" : ki > 0 ? "期99以下(ベテラン)" : null;
const ageBand = (a) => a > 0 && a <= 23 ? "23歳以下" : a > 0 && a <= 27 ? "24-27歳" : a > 0 && a <= 35 ? "28-35歳" : a > 35 ? "36歳以上" : null;
let adjCount = 0;
if (LW) {
  for (const e of ALL) {
    if (!Array.isArray(e.riders) || e.riders.length < 5) continue;
    const adj = e.riders.map((rd) => {
      const [car, age, ki, pos, , total] = rd;
      let b = 0;
      const pk = ["head", "second", "third", "tanki"][pos];
      if (LW.posBonus && LW.posBonus[pk]) b += LW.posBonus[pk];
      const kb = kiBand(ki); if (kb && LW.kiBonus && LW.kiBonus[kb]) b += LW.kiBonus[kb];
      const ab = ageBand(age); if (ab && LW.ageBonus && LW.ageBonus[ab]) b += LW.ageBonus[ab];
      return { car, t: (total || 0) + b };
    }).sort((x, y) => y.t - x.t).map((x) => x.car);
    e.adjRanks = e.ranks; // 二重補正を廃止: 保存ranksが既に補正込み
  }
  console.log("注: 保存ランクが既に学習補正込みのため、二重補正[補正後]は生成しません (weights " + (LW ? LW.updatedAt : "なし") + ")");
}

// 3連単の順列を生成するヘルパ
function perms3(firsts, seconds, thirds) {
  const out = new Set();
  for (const a of firsts) for (const b of seconds) for (const c of thirds) {
    if (a === b || b === c || a === c) continue;
    out.add(a + "-" + b + "-" + c);
  }
  return [...out];
}

// ライン補助: 車番cの所属ラインと、その中の隣接車(スジ相手)を返す
function lineOf(lines, c) { return (lines || []).find((l) => l.includes(c)) || null; }
function sujiMates(lines, c) {
  const l = lineOf(lines, c);
  if (!l || l.length < 2) return [];
  const i = l.indexOf(c);
  const out = [];
  if (i > 0) out.push(l[i - 1]);          // 前(先頭側)
  if (i < l.length - 1) out.push(l[i + 1]); // 後(番手側)
  return out;
}
// 買い目パターン定義。(ranks, e) を受けて3連単の目リストを返す。eはレースエントリ(linesを含む)
const PATTERNS = {
  // 現行: 1着=1位固定, 2-3着=2〜4位
  "現行(1着1位固定/相手2-4位)": (r) => perms3([r[0]], [r[1], r[2], r[3]], [r[1], r[2], r[3]]),
  // 1着=1〜2位, 2-3着=1〜4位
  "1着1-2位/相手1-4位": (r) => perms3([r[0], r[1]], [r[0], r[1], r[2], r[3]], [r[0], r[1], r[2], r[3]]),
  // 1着=1位, 2着=2〜4位, 3着=2〜5位(3着広め)
  "1着1位/2着2-4位/3着2-5位": (r) => perms3([r[0]], [r[1], r[2], r[3]], [r[1], r[2], r[3], r[4]]),
  // ◎を1-2着に流す: (1位-2〜4位-2〜4位)+(2〜4位-1位-2〜4位)
  "◎1-2着流し(1・2位軸)": (r) => {
    const a = perms3([r[0]], [r[1], r[2], r[3]], [r[1], r[2], r[3]]);
    const b = perms3([r[1], r[2], r[3]], [r[0]], [r[1], r[2], r[3]]);
    return [...new Set([...a, ...b])];
  },
  // 1-3位ボックス(6点)
  "1-3位BOX(6点)": (r) => perms3([r[0], r[1], r[2]], [r[0], r[1], r[2]], [r[0], r[1], r[2]]),
  // 1着=1位, 2-3着=2〜5位
  "1着1位/相手2-5位": (r) => perms3([r[0]], [r[1], r[2], r[3], r[4]], [r[1], r[2], r[3], r[4]]),
  // 1-4位ボックス(24点)
  "1-4位BOX(24点)": (r) => perms3([r[0], r[1], r[2], r[3]], [r[0], r[1], r[2], r[3]], [r[0], r[1], r[2], r[3]]),
  // 1着=1〜2位, 2着=1〜3位, 3着=1〜5位(手広く)
  "1着1-2/2着1-3/3着1-5": (r) => perms3([r[0], r[1]], [r[0], r[1], r[2]], [r[0], r[1], r[2], r[3], r[4]]),
  // 超タイト系(点数を絞って回収率を狙う)
  "1着1位/相手2-3位(2点)": (r) => perms3([r[0]], [r[1], r[2]], [r[1], r[2]]),
  "1着1位/2着2-3位/3着2-4位(4点)": (r) => perms3([r[0]], [r[1], r[2]], [r[1], r[2], r[3]]),

  // ===== 穴狙い(3連単) =====
  // 決勝型: 1着は◎で堅く、2-3着に人気薄を絡める
  "穴3 1位→4-7位→4-7位": (r) => perms3([r[0]], [r[3], r[4], r[5], r[6]].filter(Boolean), [r[3], r[4], r[5], r[6]].filter(Boolean)),
  "穴3 1位→2-3位→5-7位": (r) => perms3([r[0]], [r[1], r[2]], [r[4], r[5], r[6]].filter(Boolean)),
  "穴3 1位→非スジ→総流し": (r, e) => {
    const m = sujiMates(e.lines, r[0]);
    const others = r.slice(1).filter((c) => !m.includes(c));
    return others.length >= 2 ? perms3([r[0]], others, r.slice(1)) : [];
  },
  // ===== ライン(スジ)考慮パターン =====
  // スジ本線: 1着=評価1位, 2着=その同ライン隣接(スジ), 3着=評価2-4位
  "スジ本線(1位→同ライン→2-4位)": (r, e) => {
    const m = sujiMates(e.lines, r[0]);
    if (!m.length) return [];
    return perms3([r[0]], m, [r[1], r[2], r[3]]);
  },
  // スジ+評価: 1着=評価1位, 2着=同ライン隣接 or 評価2位, 3着=評価2-4位
  "スジ+評価2位(1位→スジ/2位→2-4位)": (r, e) => {
    const m = sujiMates(e.lines, r[0]);
    const seconds = [...new Set([...m, r[1]])];
    return perms3([r[0]], seconds, [r[1], r[2], r[3]]);
  },
  // ライン1-2着固め: 評価1位のライン内で1-2着(順不同)→3着は評価2-4位
  "本命ライン1-2着固め": (r, e) => {
    const l = lineOf(e.lines, r[0]);
    if (!l || l.length < 2) return [];
    const out = new Set();
    for (const a of l) for (const b of l) {
      if (a === b) continue;
      for (const c of [r[1], r[2], r[3]]) { if (c !== a && c !== b) out.add(a + "-" + b + "-" + c); }
    }
    return [...out];
  },
  // スジ2着固定・3着広め: 1着=1位, 2着=同ライン隣接, 3着=評価2-5位
  "スジ2着/3着2-5位": (r, e) => {
    const m = sujiMates(e.lines, r[0]);
    if (!m.length) return [];
    return perms3([r[0]], m, [r[1], r[2], r[3], r[4]]);
  },
  // 逆スジ: 同ライン隣接が1着、評価1位が2着(番手抜け・先頭残り)
  "逆スジ(スジ→1位→2-4位)": (r, e) => {
    const m = sujiMates(e.lines, r[0]);
    if (!m.length) return [];
    return perms3(m, [r[0]], [r[1], r[2], r[3]]);
  },
  // スジ表裏: 1-2着を評価1位と同ライン隣接の双方向、3着は評価2-4位
  "スジ表裏(1位⇔スジ)": (r, e) => {
    const m = sujiMates(e.lines, r[0]);
    if (!m.length) return [];
    const a = perms3([r[0]], m, [r[1], r[2], r[3]]);
    const b = perms3(m, [r[0]], [r[1], r[2], r[3]]);
    return [...new Set([...a, ...b])];
  },
};

// ===== 2車単パターン(1着-2着) =====
const perms2 = (fs, ss) => { const o = new Set(); for (const a of fs) for (const b of ss) { if (a === b) continue; o.add(a + "-" + b); } return [...o]; };
const N2_PATTERNS = {
  "2車単 1位→2-3位(2点)": (r) => perms2([r[0]], [r[1], r[2]]),
  "2車単 1位→2-4位(3点)": (r) => perms2([r[0]], [r[1], r[2], r[3]]),
  "2車単 1-2位BOX(2点)": (r) => perms2([r[0], r[1]], [r[0], r[1]]),
  "2車単 1位→スジ相手": (r, e) => { const m = sujiMates(e.lines, r[0]); return m.length ? perms2([r[0]], m) : []; },
  "2車単 スジ表裏(1位⇔スジ)": (r, e) => { const m = sujiMates(e.lines, r[0]); if (!m.length) return []; return [...new Set([...perms2([r[0]], m), ...perms2(m, [r[0]])])]; },
  "2車単 1位→2位(1点)": (r) => perms2([r[0]], [r[1]]),
  // ===== 穴狙い(荒れ想定) =====
  // 1着は評価1位で固定しつつ、2着に人気薄を置く
  "穴 1位→5-7位(3点)": (r) => perms2([r[0]], [r[4], r[5], r[6]].filter(Boolean)),
  "穴 1位→4-7位(4点)": (r) => perms2([r[0]], [r[3], r[4], r[5], r[6]].filter(Boolean)),
  // スジを外す: 1着1位→同ライン以外の全員(番手が来ない前提の穴)
  "穴 1位→非スジ全流し": (r, e) => {
    const m = sujiMates(e.lines, r[0]);
    const others = r.slice(1).filter((c) => !m.includes(c));
    return others.length ? perms2([r[0]], others) : [];
  },
  // 1着に人気薄、2着に評価上位(大穴の頭)
  "穴 4-6位→1-2位": (r) => perms2([r[3], r[4], r[5]].filter(Boolean), [r[0], r[1]]),
  // 逆転狙い: 評価2-3位が頭、相手は1位
  "穴 2-3位→1位(2点)": (r) => perms2([r[1], r[2]], [r[0]]),
};
const N2_PATTERN_ID = {
  "2車単 1位→2-3位(2点)": "n2_1_23",
  "2車単 1位→2-4位(3点)": "n2_1_234",
  "2車単 1-2位BOX(2点)": "n2_box12",
  "2車単 1位→スジ相手": "n2_suji",
  "2車単 スジ表裏(1位⇔スジ)": "n2_suji_both",
  "2車単 1位→2位(1点)": "n2_1_2",
  "穴 1位→5-7位(3点)": "n2_ana_567",
  "穴 1位→4-7位(4点)": "n2_ana_4567",
  "穴 1位→非スジ全流し": "n2_ana_nonsuji",
  "穴 4-6位→1-2位": "n2_ana_head456",
  "穴 2-3位→1位(2点)": "n2_ana_23_1",
};

// ===== 3連複パターン(着順を問わない3車の組み合わせ) =====
// 券面は車番を昇順に並べて "=" で連結した文字列。例: 2=4=5
// 3連単と違い順序が無いので、3車選べば必ず1点になる。
const c3 = (cars) => {
  const u = [...new Set((cars || []).filter((c) => c != null))];
  const out = new Set();
  for (let i = 0; i < u.length; i++)
    for (let j = i + 1; j < u.length; j++)
      for (let k = j + 1; k < u.length; k++)
        out.add([u[i], u[j], u[k]].sort((a, b) => a - b).join("="));
  return [...out];
};
// 軸流し: axis の車を必ず含み、残りを others から埋める
const c3nagashi = (axis, others) => {
  const ax = [...new Set((axis || []).filter((c) => c != null))];
  if (!ax.length || ax.length > 3) return [];
  if (ax.length === 3) return c3(ax);
  const rest = [...new Set((others || []).filter((c) => c != null && !ax.includes(c)))];
  const out = new Set();
  if (ax.length === 2) {
    for (const c of rest) out.add([...ax, c].sort((a, b) => a - b).join("="));
  } else {
    for (let i = 0; i < rest.length; i++)
      for (let j = i + 1; j < rest.length; j++)
        out.add([ax[0], rest[i], rest[j]].sort((a, b) => a - b).join("="));
  }
  return [...out];
};

const F3_PATTERNS = {
  // ★基準値。3車選べば1点なので、2車単1点買いと同じ土俵で比較できる
  "3連複 評価上位3車(1点)": (r) => c3([r[0], r[1], r[2]]),
  "3連複 上位4車BOX(4点)": (r) => c3([r[0], r[1], r[2], r[3]]),
  "3連複 上位5車BOX(10点)": (r) => c3([r[0], r[1], r[2], r[3], r[4]]),
  "3連複 1位軸→2-4位(3点)": (r) => c3nagashi([r[0]], [r[1], r[2], r[3]]),
  "3連複 1位軸→2-5位(6点)": (r) => c3nagashi([r[0]], [r[1], r[2], r[3], r[4]]),
  "3連複 1-2位軸→3-5位(3点)": (r) => c3nagashi([r[0], r[1]], [r[2], r[3], r[4]]),
  // ===== ライン狙い(3連複の本命) =====
  // ライン3人がそのまま上位独占するかを直接測る
  "3連複 本命ライン3人(1点)": (r, e) => {
    const l = lineOf(e.lines, r[0]);
    return l && l.length >= 3 ? c3(l.slice(0, 3)) : [];
  },
  "3連複 本命ラインBOX": (r, e) => {
    const l = lineOf(e.lines, r[0]);
    return l && l.length >= 3 ? c3(l) : [];
  },
  "3連複 1位+スジ相手軸→2-4位": (r, e) => {
    const m = sujiMates(e.lines, r[0]);
    return m.length ? c3nagashi([r[0], m[0]], [r[1], r[2], r[3]]) : [];
  },
  "3連複 1位+スジ+評価2位(1点)": (r, e) => {
    const m = sujiMates(e.lines, r[0]);
    if (!m.length) return [];
    const third = m[0] === r[1] ? r[2] : r[1];  // スジ相手が評価2位なら3位を繰り上げ
    return c3([r[0], m[0], third]);
  },
  // ===== 穴狙い =====
  "3連複 1位軸→4-7位(6点)": (r) => c3nagashi([r[0]], [r[3], r[4], r[5], r[6]]),
  "3連複 評価2-4位(1点/本命抜き)": (r) => c3([r[1], r[2], r[3]]),
};
// 注: F3_PATTERNS は PATTERN_ID / N2_PATTERN_ID に登録しない。
//   sim.json の winners / allPatterns は anyPatId() で絞られるため、3連複は自動的に除外される。
//   → アプリ側が未対応のうちに3連複の買い目を提示してしまう事故を防ぐ。
//   採用が決まった構成だけ、後で PATTERN_ID に足してアプリを対応させること。

// フィルタ定義(どのレースを買うか)。e.score=期待度%, e.p3pay=3連単配当, e.verdict/klass/place
const FILTERS_ANCHOR = true;
// ライン構造の判定ヘルパ(複合条件で使う)
const _l0 = (e) => ((e.lines || []).find((x) => x.includes((e.ranks || [])[0])) || null);
const _isHead = (e) => { const l = _l0(e); return !!(l && l.length >= 2 && l[0] === e.ranks[0]); };
const _isTail = (e) => { const l = _l0(e); return !!(l && l.length >= 2 && l[l.length - 1] === e.ranks[0]); };
const _lsize = (e) => { const l = _l0(e); return l ? l.length : 1; };
const _isYosen = (e) => /予選/.test(e.grade || "");
const _isKesshou = (e) => /決勝/.test((e.grade || "").replace(/準決勝?/, ""));

const FILTERS = {
  "全レース": () => true,
  "×荒れ含みを除外": (e) => e.verdict !== "×荒れ含み",
  "◎○のみ": (e) => e.verdict === "◎スジ堅い" || e.verdict === "○スジ寄り",
  "予選のみ": (e) => /予選/.test(e.grade || ""),
  "決勝除外": (e) => !/決勝/.test((e.grade || "").replace(/準決勝?/, "")),
  "予選+一般のみ": (e) => /予選|一般/.test(e.grade || ""),
  "期待度60%以上・決勝除外": (e) => e.score >= 60 && !/決勝/.test((e.grade || "").replace(/準決勝?/, "")),
  // ===== 荒れそうなレース(穴狙い用) =====
  "×荒れ含みのみ": (e) => e.verdict === "×荒れ含み",
  "期待度50%未満(荒れ)": (e) => e.score != null && e.score < 50,
  "期待度45%未満(大荒れ)": (e) => e.score != null && e.score < 45,
  "上位拮抗(2点差未満)": (e) => e.gap != null && e.gap < 2,
  "決勝のみ": (e) => /決勝/.test((e.grade || "").replace(/準決勝?/, "")),
  "荒れ判定+拮抗(3点差未満)": (e) => e.verdict === "×荒れ含み" && e.gap != null && e.gap < 3,
  "S級かつ荒れ": (e) => e.klass === "s" && e.verdict === "×荒れ含み",
  // ===== ライン構造フィルタ =====
  "二分戦": (e) => /^(4-3|5-2|3-4|2-5|4-4|5-4|6-3)/.test(e.pattern || ""),
  "三分戦": (e) => /^(3-3-1|3-2-2|2-3-2|3-3-3|4-2-1|2-2-3|3-3-2)/.test(e.pattern || ""),
  "本命ライン3人以上": (e) => { const l = (e.lines || []).find((x) => x.includes((e.ranks || [])[0])); return !!(l && l.length >= 3); },
  "本命ライン2人": (e) => { const l = (e.lines || []).find((x) => x.includes((e.ranks || [])[0])); return !!(l && l.length === 2); },
  "本命が先頭": (e) => { const l = (e.lines || []).find((x) => x.includes((e.ranks || [])[0])); return !!(l && l.length >= 2 && l[0] === e.ranks[0]); },
  "本命が番手以降": (e) => { const l = (e.lines || []).find((x) => x.includes((e.ranks || [])[0])); return !!(l && l.length >= 2 && l[0] !== e.ranks[0]); },
  "本命ライン3人以上・期待度58%以上": (e) => { const l = (e.lines || []).find((x) => x.includes((e.ranks || [])[0])); return !!(l && l.length >= 3) && e.score >= 58; },
  "本命が先頭・期待度58%以上": (e) => { const l = (e.lines || []).find((x) => x.includes((e.ranks || [])[0])); return !!(l && l.length >= 2 && l[0] === e.ranks[0]) && e.score >= 58; },
  // ===== 再検証: データ修復後に効き目を測り直す複合条件 =====
  // 予選 × ライン構造
  "予選・本命が先頭": (e) => _isYosen(e) && _isHead(e),
  "予選・本命が先頭・ライン3人以上": (e) => _isYosen(e) && _isHead(e) && _lsize(e) >= 3,
  "予選・本命が先頭・期待度58%以上": (e) => _isYosen(e) && _isHead(e) && e.score >= 58,
  "予選・最後尾除外": (e) => _isYosen(e) && !_isTail(e),
  // 決勝除外 × ライン構造
  "決勝除外・本命が先頭": (e) => !_isKesshou(e) && _isHead(e),
  "決勝除外・本命が先頭・ライン3人以上": (e) => !_isKesshou(e) && _isHead(e) && _lsize(e) >= 3,
  // クラス × ライン構造
  "A級・本命が先頭": (e) => e.klass === "a12" && _isHead(e),
  "A級・本命が先頭・ライン3人以上": (e) => e.klass === "a12" && _isHead(e) && _lsize(e) >= 3,
  "S級・本命が先頭": (e) => e.klass === "s" && _isHead(e),
  "S級除外・本命が先頭・ライン3人以上": (e) => e.klass !== "s" && _isHead(e) && _lsize(e) >= 3,
  "チャレンジ・本命が先頭": (e) => e.klass === "challenge" && _isHead(e),
  "ガールズ除外・本命が先頭": (e) => e.klass !== "girls" && _isHead(e),
  // ライン4人以上(診断で最も回収率が高かった)
  "ライン4人以上": (e) => _lsize(e) >= 4,
  "ライン4人以上・本命が先頭": (e) => _lsize(e) >= 4 && _isHead(e),
  "ライン4人以上・期待度58%以上": (e) => _lsize(e) >= 4 && e.score >= 58,
  // 隊形(診断で3-2-1型・3-2-2-2型が高かった)
  "隊形3-2-2": (e) => /^3-2-2/.test(e.pattern || ""),
  "隊形3-3-1": (e) => /^3-3-1/.test(e.pattern || ""),
  "隊形3-2-2・本命が先頭": (e) => /^3-2-2/.test(e.pattern || "") && _isHead(e),
  // 点差 × ライン構造
  "本命が先頭・8点差以上リード": (e) => _isHead(e) && e.gap != null && e.gap >= 8,
  "本命が先頭・ライン3人以上・5点差以上": (e) => _isHead(e) && _lsize(e) >= 3 && e.gap != null && e.gap >= 5,
  // 荒れ系の再検証(基準値が正しくなったため測り直す)
  "荒れ・拮抗・S級除外": (e) => e.verdict === "×荒れ含み" && e.gap != null && e.gap < 3 && e.klass !== "s",
  "荒れ・拮抗・予選": (e) => e.verdict === "×荒れ含み" && e.gap != null && e.gap < 3 && _isYosen(e),
  "荒れ・拮抗・A級": (e) => e.verdict === "×荒れ含み" && e.gap != null && e.gap < 3 && e.klass === "a12",
  "拮抗(3点差未満)": (e) => e.gap != null && e.gap < 3,
  "拮抗・本命が先頭": (e) => e.gap != null && e.gap < 3 && _isHead(e),

  // ===== 複合条件(診断:ライン人数が多い/本命が先頭 ほど有利) =====
  "本命が先頭・ライン3人以上": (e) => { const l = (e.lines || []).find((x) => x.includes((e.ranks || [])[0])); return !!(l && l.length >= 3 && l[0] === e.ranks[0]); },
  "本命が先頭・ライン3人以上・期待度58%以上": (e) => { const l = (e.lines || []).find((x) => x.includes((e.ranks || [])[0])); return !!(l && l.length >= 3 && l[0] === e.ranks[0]) && e.score >= 58; },
  "本命が先頭・ライン3人以上・期待度60%以上": (e) => { const l = (e.lines || []).find((x) => x.includes((e.ranks || [])[0])); return !!(l && l.length >= 3 && l[0] === e.ranks[0]) && e.score >= 60; },
  "本命が先頭・期待度60%以上": (e) => { const l = (e.lines || []).find((x) => x.includes((e.ranks || [])[0])); return !!(l && l.length >= 2 && l[0] === e.ranks[0]) && e.score >= 60; },
  "本命が先頭・期待度60%以上・S級除外": (e) => { const l = (e.lines || []).find((x) => x.includes((e.ranks || [])[0])); return !!(l && l.length >= 2 && l[0] === e.ranks[0]) && e.score >= 60 && e.klass !== "s"; },
  "本命が最後尾のレースを除外": (e) => { const l = (e.lines || []).find((x) => x.includes((e.ranks || [])[0])); return !(l && l.length >= 2 && l[l.length - 1] === e.ranks[0]); },
  "最後尾除外・期待度60%以上": (e) => { const l = (e.lines || []).find((x) => x.includes((e.ranks || [])[0])); return !(l && l.length >= 2 && l[l.length - 1] === e.ranks[0]) && e.score >= 60; },
  "本命が先頭・5点差以上リード": (e) => { const l = (e.lines || []).find((x) => x.includes((e.ranks || [])[0])); return !!(l && l.length >= 2 && l[0] === e.ranks[0]) && e.gap != null && e.gap >= 5; },
  "◎スジ堅いのみ": (e) => e.verdict === "◎スジ堅い",
  // 期待度スコアの閾値(判定バケットより細かく)
  "期待度55%以上": (e) => (e.score || 0) >= 55,
  "期待度58%以上": (e) => (e.score || 0) >= 58,
  "期待度60%以上": (e) => (e.score || 0) >= 60,
  "期待度62%以上": (e) => (e.score || 0) >= 62,
  // 配当ゾーン(3連単配当。当たったレースの配当なので事前フィルタではないが傾向把握用)
  // ※注: p3payは結果配当。買う前には分からないが「どの配当帯が的中に寄与するか」を見る参考
  // クラス
  "S級のみ": (e) => e.klass === "s",
  "A級のみ": (e) => e.klass === "a12",
  "チャレンジのみ": (e) => e.klass === "challenge",
  "ガールズのみ": (e) => e.klass === "girls",
  "ガールズ除外": (e) => e.klass !== "girls",
  // 複合
  "◎のみ・ガールズ除外": (e) => e.verdict === "◎スジ堅い" && e.klass !== "girls",
  "期待度58%以上・ガールズ除外": (e) => (e.score || 0) >= 58 && e.klass !== "girls",
  "◎○のみ・ガールズ除外": (e) => (e.verdict === "◎スジ堅い" || e.verdict === "○スジ寄り") && e.klass !== "girls",
  // 複合(診断結果より: S級は評価1位の1着率が低い=足を引っ張る)
  "期待度60%以上・S級除外": (e) => (e.score || 0) >= 60 && e.klass !== "s",
  "期待度62%以上・S級除外": (e) => (e.score || 0) >= 62 && e.klass !== "s",
  "期待度64%以上": (e) => (e.score || 0) >= 64,
  "期待度66%以上": (e) => (e.score || 0) >= 66,
  "A級・期待度58%以上": (e) => e.klass === "a12" && (e.score || 0) >= 58,
  "チャレンジ・期待度58%以上": (e) => e.klass === "challenge" && (e.score || 0) >= 58,
  // 接戦度(評価1位と2位の点差)。gapフィールドがあるデータのみ対象
  "本命が5点差以上リード": (e) => (e.gap || 0) >= 5,
  "本命が8点差以上リード": (e) => (e.gap || 0) >= 8,
  "5点差以上・期待度58%以上": (e) => (e.gap || 0) >= 5 && (e.score || 0) >= 58,
};

// 🔥勝負レース採用のしきい値(緩すぎる構成が混ざるのを防ぐ)
const SHOUBU_MIN_ROI = 105;    // 回収率の下限
const SHOUBU_MIN_RACES = 200;  // サンプル数の下限
const SHOUBU_MAX_COV = 40;     // 構成単体で全レースに占める割合の上限(%)
const SHOUBU_MAX_UNION = 25;   // 勝負レース全体が占める割合の上限(%)。複数構成の合計で絞る
const TOTAL_RACES = ALL.length;

// bet: "n2"=2車単 / "p3"=3連単 / "f3"=3連複。旧来の true(=2車単)も受け付ける。
function evaluate(patternFn, filterFn, useAdj, bet) {
  const B = bet === true ? "n2" : (bet || "p3");
  let races = 0, bets = 0, hits = 0, ret = 0;
  for (const e of ALL) {
    if (!filterFn(e)) continue;
    // 配当が無いレースは対象外。ここを緩めると、的中しても払戻0円として集計され回収率が下がる
    if (B === "n2" && e.p2pay == null) continue;
    if (B === "p3" && (e.p3pay == null || e.t == null)) continue;
    if (B === "f3" && (e.p3fpay == null || e.t == null)) continue;
    const rk = useAdj ? e.adjRanks : e.ranks;
    if (!rk) continue;
    const tickets = patternFn(rk, e);
    if (!tickets.length) continue;
    races++;
    bets += tickets.length;
    const hitTicket =
      B === "n2" ? e.f + "-" + e.s :
      B === "f3" ? [e.f, e.s, e.t].sort((a, b) => a - b).join("=") :
      e.f + "-" + e.s + "-" + e.t;
    if (tickets.includes(hitTicket)) {
      hits++;
      ret += (B === "n2" ? e.p2pay : B === "f3" ? e.p3fpay : e.p3pay);
    }
  }
  const cost = bets * 100;
  return {
    races, avgPoints: races ? +(bets / races).toFixed(1) : 0,
    hitRate: races ? +(hits / races * 100).toFixed(1) : 0,
    roi: cost ? +(ret / cost * 100).toFixed(1) : 0,
    profit: Math.round(ret - cost), breakEvenOdds: hits ? +((cost / hits) / 100).toFixed(1) : null,
  };
}

const results = [];
// 【方針】現在の戦略は2車単のみ。3連単は払戻データの取得が不安定なため評価対象から外す。
//   (3連単を再開する場合は下の false を true に戻す)
const EVAL_SANRENTAN = false;
for (const [pname, pfn] of Object.entries(EVAL_SANRENTAN ? PATTERNS : {})) {
  for (const [fname, ffn] of Object.entries(FILTERS)) {
    const r = evaluate(pfn, ffn, false);
    if (r.races >= 15) results.push({ pattern: pname, filter: fname, adj: false, ...r });
    if (adjCount >= 100) {
      const r2 = evaluate(pfn, ffn, true);
      if (r2.races >= 15) results.push({ pattern: "[補正後]" + pname, filter: fname, adj: true, ...r2 });
    }
  }
}

// 2車単パターンのバックテスト(配当があるレースのみ対象)
for (const [pname, pfn] of Object.entries(N2_PATTERNS)) {
  for (const [fname, ffn] of Object.entries(FILTERS)) {
    const r = evaluate(pfn, ffn, false, true);
    if (r.races >= 15) results.push({ pattern: pname, filter: fname, adj: false, nishatan: true, ...r });
    if (adjCount >= 100) {
      const r2 = evaluate(pfn, ffn, true, true);
      if (r2.races >= 15) results.push({ pattern: "[補正後]" + pname, filter: fname, adj: true, nishatan: true, ...r2 });
    }
  }
}

// 3連複パターンのバックテスト(3連複配当と3着が揃っているレースのみ対象)
const EVAL_SANPUKU = true;
for (const [pname, pfn] of Object.entries(EVAL_SANPUKU ? F3_PATTERNS : {})) {
  for (const [fname, ffn] of Object.entries(FILTERS)) {
    const r = evaluate(pfn, ffn, false, "f3");
    if (r.races >= 15) results.push({ pattern: pname, filter: fname, adj: false, sanpuku: true, ...r });
  }
}

// 回収率の高い順
results.sort((a, b) => b.roi - a.roi);

console.log("\n===== 回収率トップ25 =====");
console.log("回収率  的中率  平均点  レース数  収支     | パターン × フィルタ");
for (const r of results.slice(0, 25)) {
  console.log(
    String(r.roi).padStart(5) + "%  " +
    String(r.hitRate).padStart(5) + "%  " +
    String(r.avgPoints).padStart(5) + "  " +
    String(r.races).padStart(6) + "  " +
    (r.profit >= 0 ? "+" : "") + String(r.profit).padStart(6) + "円 | " +
    (r.nishatan ? "[2車単]" : r.sanpuku ? "[3連複]" : "") + r.pattern + " × " + r.filter
  );
}

// ===== 3連複だけを取り出した比較表 =====
{
  const f3 = results.filter((r) => r.sanpuku);
  console.log("\n===== 3連複 回収率トップ20 =====");
  if (!f3.length) {
    console.log("  該当なし(3連複データが無いか、サンプルが15R未満)");
  } else {
    console.log("回収率  的中率  平均点  レース数  収支     | パターン × フィルタ");
    for (const r of f3.slice(0, 20)) {
      console.log(
        String(r.roi).padStart(5) + "%  " +
        String(r.hitRate).padStart(5) + "%  " +
        String(r.avgPoints).padStart(5) + "  " +
        String(r.races).padStart(6) + "  " +
        (r.profit >= 0 ? "+" : "") + String(r.profit).padStart(6) + "円 | " +
        r.pattern + " × " + r.filter
      );
    }
    // 基準値の対比。ここが本題。
    const base3 = results.find((r) => r.sanpuku && r.pattern === "3連複 評価上位3車(1点)" && r.filter === "全レース");
    const base2 = results.find((r) => r.nishatan && r.pattern === "2車単 1位→2位(1点)" && r.filter === "全レース");
    const suji2 = results.find((r) => r.nishatan && r.pattern === "2車単 1位→スジ相手" && r.filter === "全レース");
    const line3 = results.find((r) => r.sanpuku && r.pattern === "3連複 本命ライン3人(1点)" && r.filter === "全レース");
    console.log("\n----- 1点買いどうしの比較(全レース) -----");
    const row = (label, r) => r
      ? console.log("  " + label.padEnd(26) + " 回収" + String(r.roi).padStart(6) + "%  的中" + String(r.hitRate).padStart(5) + "%  " + String(r.races).padStart(5) + "R")
      : console.log("  " + label.padEnd(26) + " (該当なし)");
    row("2車単 1位→2位", base2);
    row("2車単 1位→スジ相手", suji2);
    row("3連複 評価上位3車", base3);
    row("3連複 本命ライン3人", line3);
    console.log("  ※ 控除率は3賭式とも25%。どれも75%前後なら、賭式を変えても壁は動いていないということ。");
  }
}

// 現行構成の位置づけ
const cur = results.find((r) => r.pattern.startsWith("現行") && r.filter === "全レース");
if (cur) console.log("\n【参考:3連単 全レース(データ不完全のため参考値)】 回収率" + cur.roi + "% 的中" + cur.hitRate + "% 平均" + cur.avgPoints + "点 収支" + cur.profit + "円");

// ---- アプリ用: 各構成に「機械可読な条件」と「買い目タイプ」を付与して勝ちパターンを抽出 ----
// パターン名→買い目タイプID(アプリ側で同じ関数を実装)
const PATTERN_ID = {
  "現行(1着1位固定/相手2-4位)": "p_1_234",
  "1着1位/相手2-5位": "p_1_2345",
  "1着1位/2着2-4位/3着2-5位": "p_1_234_2345",
  "1着1-2位/相手1-4位": "p_12_1234",
  "1-3位BOX(6点)": "p_box123",
  "1着1位/相手2-5位": "p_1_2345",
  "1着1位/相手2-3位(2点)": "p_1_23",
  "1着1位/2着2-3位/3着2-4位(4点)": "p_1_23_234",
  "1着1-2/2着1-3/3着1-5": "p_12_123_12345",
  "1-4位BOX(24点)": "p_box1234",
  "スジ本線(1位→同ライン→2-4位)": "p_suji_main",
  "スジ+評価2位(1位→スジ/2位→2-4位)": "p_suji_plus",
  "本命ライン1-2着固め": "p_line12",
  "スジ2着/3着2-5位": "p_suji_wide",
  "逆スジ(スジ→1位→2-4位)": "p_suji_rev",
  "スジ表裏(1位⇔スジ)": "p_suji_both",
  "穴3 1位→4-7位→4-7位": "p_ana_4567",
  "穴3 1位→2-3位→5-7位": "p_ana_23_567",
  "穴3 1位→非スジ→総流し": "p_ana_nonsuji",
};
// フィルタ名→機械可読な条件(アプリ側で判定)
const FILTER_COND = {
  "全レース": {},
  "◎スジ堅いのみ": { verdict: "◎スジ堅い" },
  "期待度58%以上": { scoreMin: 58 },
  "期待度60%以上": { scoreMin: 60 },
  "期待度62%以上": { scoreMin: 62 },
  "期待度64%以上": { scoreMin: 64 },
  "期待度66%以上": { scoreMin: 66 },
  "期待度62%以上・S級除外": { scoreMin: 62, notKlass: "s" },
  "期待度60%以上・S級除外": { scoreMin: 60, notKlass: "s" },
  "期待度58%以上・ガールズ除外": { scoreMin: 58, notKlass: "girls" },
  "A級・期待度58%以上": { klass: "a12", scoreMin: 58 },
  "チャレンジ・期待度58%以上": { klass: "challenge", scoreMin: 58 },
  "本命が5点差以上リード": { gapMin: 5 },
  "本命が8点差以上リード": { gapMin: 8 },
  "5点差以上・期待度58%以上": { gapMin: 5, scoreMin: 58 },
  "ガールズのみ": { klass: "girls" },
  "S級のみ": { klass: "s" },
  "A級のみ": { klass: "a12" },
  "チャレンジのみ": { klass: "challenge" },
  "ガールズ除外": { notKlass: "girls" },
  "◎○のみ": { verdictIn: ["◎スジ堅い", "○スジ寄り"] },
  "×荒れ含みを除外": { notVerdict: "×荒れ含み" },
  "◎のみ・ガールズ除外": { verdict: "◎スジ堅い", notKlass: "girls" },
  "◎○のみ・ガールズ除外": { verdictIn: ["◎スジ堅い", "○スジ寄り"], notKlass: "girls" },
  "予選のみ": { gradeRe: "予選" },
  "決勝除外": { notGradeRe: "(?<!準)決勝" },
  "予選+一般のみ": { gradeRe: "予選|一般" },
  "期待度60%以上・決勝除外": { scoreMin: 60, notGradeRe: "(?<!準)決勝" },
  "×荒れ含みのみ": { verdict: "×荒れ含み" },
  "期待度50%未満(荒れ)": { scoreMax: 50 },
  "期待度45%未満(大荒れ)": { scoreMax: 45 },
  "上位拮抗(2点差未満)": { gapMax: 2 },
  "決勝のみ": { gradeRe: "(?<!準)決勝" },
  "荒れ判定+拮抗(3点差未満)": { verdict: "×荒れ含み", gapMax: 3 },
  "S級かつ荒れ": { klass: "s", verdict: "×荒れ含み" },
  "二分戦": { patternRe: "^(4-3|5-2|3-4|2-5|4-4|5-4|6-3)" },
  "三分戦": { patternRe: "^(3-3-1|3-2-2|2-3-2|3-3-3|4-2-1|2-2-3|3-3-2)" },
  "本命ライン3人以上": { lineSizeMin: 3 },
  "本命ライン2人": { lineSizeEq: 2 },
  "本命が先頭": { topIsHead: true },
  "本命が番手以降": { topIsHead: false, lineSizeMin: 2 },  // 単騎は含めない(シミュレーター側の定義に合わせる)
  "本命ライン3人以上・期待度58%以上": { lineSizeMin: 3, scoreMin: 58 },
  "本命が先頭・期待度58%以上": { topIsHead: true, scoreMin: 58 },
  "予選・本命が先頭": { gradeRe: "予選", topIsHead: true },
  "予選・本命が先頭・ライン3人以上": { gradeRe: "予選", topIsHead: true, lineSizeMin: 3 },
  "予選・本命が先頭・期待度58%以上": { gradeRe: "予選", topIsHead: true, scoreMin: 58 },
  "予選・最後尾除外": { gradeRe: "予選", topNotTail: true },
  "決勝除外・本命が先頭": { notGradeRe: "(?<!準)決勝", topIsHead: true },
  "決勝除外・本命が先頭・ライン3人以上": { notGradeRe: "(?<!準)決勝", topIsHead: true, lineSizeMin: 3 },
  "A級・本命が先頭": { klass: "a12", topIsHead: true },
  "A級・本命が先頭・ライン3人以上": { klass: "a12", topIsHead: true, lineSizeMin: 3 },
  "S級・本命が先頭": { klass: "s", topIsHead: true },
  "S級除外・本命が先頭・ライン3人以上": { notKlass: "s", topIsHead: true, lineSizeMin: 3 },
  "チャレンジ・本命が先頭": { klass: "challenge", topIsHead: true },
  "ガールズ除外・本命が先頭": { notKlass: "girls", topIsHead: true },
  "ライン4人以上": { lineSizeMin: 4 },
  "ライン4人以上・本命が先頭": { lineSizeMin: 4, topIsHead: true },
  "ライン4人以上・期待度58%以上": { lineSizeMin: 4, scoreMin: 58 },
  "隊形3-2-2": { patternRe: "^3-2-2" },
  "隊形3-3-1": { patternRe: "^3-3-1" },
  "隊形3-2-2・本命が先頭": { patternRe: "^3-2-2", topIsHead: true },
  "本命が先頭・8点差以上リード": { topIsHead: true, gapMin: 8 },
  "本命が先頭・ライン3人以上・5点差以上": { topIsHead: true, lineSizeMin: 3, gapMin: 5 },
  "荒れ・拮抗・S級除外": { verdict: "×荒れ含み", gapMax: 3, notKlass: "s" },
  "荒れ・拮抗・予選": { verdict: "×荒れ含み", gapMax: 3, gradeRe: "予選" },
  "荒れ・拮抗・A級": { verdict: "×荒れ含み", gapMax: 3, klass: "a12" },
  "拮抗(3点差未満)": { gapMax: 3 },
  "拮抗・本命が先頭": { gapMax: 3, topIsHead: true },

  "期待度55%以上": { scoreMin: 55 },
  "本命が先頭・ライン3人以上": { topIsHead: true, lineSizeMin: 3 },
  "本命が先頭・ライン3人以上・期待度58%以上": { topIsHead: true, lineSizeMin: 3, scoreMin: 58 },
  "本命が先頭・ライン3人以上・期待度60%以上": { topIsHead: true, lineSizeMin: 3, scoreMin: 60 },
  "本命が先頭・期待度60%以上": { topIsHead: true, scoreMin: 60 },
  "本命が先頭・期待度60%以上・S級除外": { topIsHead: true, scoreMin: 60, notKlass: "s" },
  "本命が最後尾のレースを除外": { topNotTail: true },
  "最後尾除外・期待度60%以上": { topNotTail: true, scoreMin: 60 },
  "本命が先頭・5点差以上リード": { topIsHead: true, gapMin: 5 },
};
// 回収率100%超の構成を「勝ちパターン」として、条件・買い目・回収率つきで保存
const stripAdj = (n) => n.replace(/^\[補正後\]/, "");
  const anyPatId = (n) => PATTERN_ID[stripAdj(n)] || N2_PATTERN_ID[stripAdj(n)];
const winners = results
  .filter((r) => r.roi >= 100 && (adjCount >= 100 ? r.adj : !r.adj) && anyPatId(r.pattern) && FILTER_COND[r.filter])
  .map((r) => ({
    roi: r.roi, hitRate: r.hitRate, avgPoints: r.avgPoints, races: r.races,
    patternId: anyPatId(r.pattern), patternName: r.pattern, betType: r.nishatan ? "nishatan" : "sanrentan", adj: !!r.adj,
    filterName: r.filter, cond: FILTER_COND[r.filter],
  }))
  .sort((a, b) => b.roi - a.roi);

// アプリ用: 条件付き全構成(100%未満も含む)を回収率降順で保存。
// アプリは各レースで「条件に合致する中で最も回収率が高い構成」の買い目を提示する
const allPatterns = results
  .filter((r) => (adjCount >= 100 ? r.adj : !r.adj) && anyPatId(r.pattern) && FILTER_COND[r.filter] && r.races >= 30)
  .map((r) => {
    const coverage = TOTAL_RACES ? +(r.races / TOTAL_RACES * 100).toFixed(1) : 0;
    return {
      roi: r.roi, hitRate: r.hitRate, avgPoints: r.avgPoints, races: r.races, coverage,
      patternId: anyPatId(r.pattern), patternName: r.pattern, betType: r.nishatan ? "nishatan" : "sanrentan", adj: !!r.adj,
      filterName: r.filter, cond: FILTER_COND[r.filter],
      // 🔥勝負レースに採用する構成の条件:
      //  ①回収率に余裕がある(105%以上) ②サンプルが十分(300R以上) ③条件が絞れている(全体の40%以下)
      //  ③が無いと「ほぼ全レースが対象の緩い構成」が混ざり、勝負レースが全レース化してしまう
      shoubuCand: r.roi >= SHOUBU_MIN_ROI && r.races >= SHOUBU_MIN_RACES && coverage <= SHOUBU_MAX_COV,
      shoubu: false, // 後段の貪欲選択で決定
    };
  })
  .sort((a, b) => b.roi - a.roi);

// ---- 🔥勝負レース構成の選定 ----
// 単体条件を満たす候補を回収率の高い順に見ていき、
// 「勝負レースの合計が全体のSHOUBU_MAX_UNION%を超えない」範囲だけ採用する。
// (構成ごとに40%以下でも、合計すると8割になってしまうため)
{
  const keyOf = (e) => e.id || (e.date + "_" + e.place + "_" + e.raceNo);
  const patFnOf = (name) => PATTERNS[stripAdj(name)] || N2_PATTERNS[stripAdj(name)];
  const matchedKeys = (p) => {
    const ff = FILTERS[p.filterName], pf = patFnOf(p.patternName);
    const out = new Set();
    if (!ff || !pf) return out;
    const isN2 = p.betType === "nishatan";
    for (const e of ALL) {
      if (!ff(e)) continue;
      if (isN2 && e.p2pay == null) continue;
      const rk = e.ranks;
      if (!rk) continue;
      const t = pf(rk, e);
      if (t && t.length) out.add(keyOf(e));
    }
    return out;
  };
  const union = new Set();
  const cap = Math.round(TOTAL_RACES * SHOUBU_MAX_UNION / 100);
  for (const p of allPatterns) {
    if (!p.shoubuCand) continue;
    const ks = matchedKeys(p);
    const merged = new Set(union);
    for (const k of ks) merged.add(k);
    if (merged.size <= cap || !union.size) { // 1件目は必ず採用(TOP構成)
      p.shoubu = true;
      for (const k of ks) union.add(k);
    }
    if (union.size >= cap) break;
  }
  console.log("\n🔥勝負レース対象: " + union.size + "R / 全体 " + TOTAL_RACES + "R (" + (TOTAL_RACES ? (union.size / TOTAL_RACES * 100).toFixed(1) : 0) + "%)");
}

fs.writeFileSync(path.join(dir, "sim.json"), JSON.stringify({
  updatedAt: new Date().toISOString(),
  sampleRaces: ALL.length,
  winners,                    // 回収率100%超の勝ちパターン
  allPatterns,                // 全構成(アプリが最良構成を選ぶのに使用)
  // 3連複は検証中のため winners / allPatterns には入れない(アプリが拾って提示しないように)。
  // 別枠で保存しておき、採用が決まった構成だけ後で移す。
  sanpuku: results.filter((r) => r.sanpuku && r.races >= 30)
    .map((r) => ({ roi: r.roi, hitRate: r.hitRate, avgPoints: r.avgPoints, races: r.races, profit: r.profit, patternName: r.pattern, filterName: r.filter })),
  results: results.slice(0, 40),
}, null, 0));
console.log("allPatterns:", allPatterns.length, "件を保存(条件付き・30R以上)");
console.log("\n回収率100%超の勝ちパターン:", winners.length, "件");
winners.forEach((w) => console.log("  " + w.roi + "% " + w.patternName + " × " + w.filterName + " (" + w.races + "R)"));

{
  const sh = allPatterns.filter((p) => p.shoubu);
  {
  const nPat = (EVAL_SANRENTAN ? Object.keys(PATTERNS).length : 0) + Object.keys(N2_PATTERNS).length + (EVAL_SANPUKU ? Object.keys(F3_PATTERNS).length : 0);
  const nFil = Object.keys(FILTERS).length;
  console.log("\n※ 試した組み合わせ: 約" + (nPat * nFil) + "通り。");
  console.log("   これだけ試せば、実力が無くても偶然100%を超えるものがいくつか出ます。");
  console.log("   サンプルが薄い(300R未満)構成は特に疑ってください。");
  console.log("   有望な構成は forward.js に登録し、これから来るレースで確かめるのが確実です。");
}
console.log("\n===== 🔥勝負レース採用構成 (回収率" + SHOUBU_MIN_ROI + "%以上・" + SHOUBU_MIN_RACES + "R以上・全体の" + SHOUBU_MAX_COV + "%以下) =====");
  if (!sh.length) console.log("  該当なし(条件を満たす構成がありません)");
  for (const p of sh.slice(0, 10)) {
    console.log("  " + String(p.roi).padStart(6) + "% " + String(p.races).padStart(5) + "R (全体の" + String(p.coverage).padStart(5) + "%) " + p.patternName + " × " + p.filterName);
  }
  const loose = allPatterns.filter((p) => p.roi >= 100 && !p.shoubu && p.coverage > SHOUBU_MAX_COV);
  if (loose.length) {
    console.log("\n  [除外] 回収率100%超だが条件が緩すぎる構成(勝負レースが全レース化する原因):");
    for (const p of loose.slice(0, 5)) console.log("    " + p.roi + "% " + p.races + "R (全体の" + p.coverage + "%) " + p.filterName);
  }
}
console.log("sim.json に保存しました。");
