#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""selector.py -- 「いま買う／見送ると決める」レースを選ぶ。ネットも画面も触らない純関数

★買い目も判定も作り直さない。betplan.js（アプリと同じ ev.js）の verdict をそのまま使う。
  ここで決めるのは「いつ決めるか」と「上限」だけ。

いつ決めるか（2026-09-26 に変更）:
  締切まで decide_at_minutes（既定2.5分）になるまで待ち、そのとき手元にある**いちばん新しい倍率**で1回だけ決める。
  期待値の成績は確定オッズで測っているので、決めるのは確定に近いほどよい。
  締切前オッズは PC の snap.js が締切15〜2分前に3分おき（🔥は締切6分前から1分おき）に取る。
  それより前の倍率では決めない（途中で見送りに見えても、最後の倍率で1以上なら買う）。
  ★「一度でも1以上になったら買う」にはしない。1の前後を行き来するだけのレースを拾い、検証していない別のルールになる。
  決めたら、あとで倍率が動いても決め直さない。
  倍率が max_snap_age_minutes より古ければ、その2倍までなら注記を付けて使い、それより古ければ見送り。
"""
from dataclasses import dataclass, field

from bet_store import make_key
from jst import minutes_to_close

LATE_WINDOW = 30          # 締切を何分過ぎたぶんまで「間に合わなかった」と報せるか
LOOK_MINUTES = 16         # 締切まで何分以内のレースを見るか（snap.js は15分前から）
MAX_D_POINTS = 4          # モデルDを1レースで何点まで買うか（5年で4点を超えたレースは無い）


@dataclass(frozen=True)
class Bet:
    date: str
    place: str
    rno: int
    key: str
    ticket: str
    close: str
    cars: int
    need_odds: bool
    yen: int
    minutes: float
    ev: "float | None" = None
    odds: "float | None" = None
    verdict: str = ""
    snap_left: "float | None" = None
    snap_age: "float | None" = None
    note: str = ""
    kind: str = "hot"          # "hot"=🔥（本命ライン3人） / "D"=モデルD
    n: int = 1                 # モデルDの何点目か

    @property
    def label(self):
        if self.kind != "D":
            return f"{self.place}{self.rno}R"
        return f"{self.place}{self.rno}R(モデルD" + (f" {self.n}点目" if self.n > 1 else "") + ")"


@dataclass
class Result:
    bets: list = field(default_factory=list)       # いま買う
    skips: list = field(default_factory=list)      # 見送りと決めた (Bet, 理由)
    late: list = field(default_factory=list)       # 間に合わなかった (キー, 説明)
    warnings: list = field(default_factory=list)
    quiet: list = field(default_factory=list)      # 黙って決めたキー（モデルDで買う組が無かった等。記録もログもしない）


def skip_reason(r):
    v = r.get("verdict")
    if v == "skipEv":
        return f"期待値{r.get('ev'):.2f}（1未満）" if r.get("ev") is not None else "期待値1未満"
    if v == "skipBand":
        return f"{r.get('odds')}倍は帯{r.get('bandLo')}〜{r.get('bandHi')}倍の外"
    if v == "thin":
        return "票が薄く期待値を出せない"
    if v == "noOdds":
        return "締切前の倍率が無い"
    if v == "noDelta":
        return "選手データが足りず期待値を出せない"
    return f"判定 {v}"


def _in_band(r):
    """帯の中か。betplan の inBand（無い古い出力なら倍率と bandLo〜bandHi から）"""
    if isinstance(r.get("inBand"), bool):
        return r["inBand"]
    v = r.get("verdict")
    if v in ("buy", "skipEv"):
        return True
    if v == "skipBand" or not r.get("needOdds"):
        return False
    o, lo, hi = r.get("odds"), r.get("bandLo"), r.get("bandHi")
    return isinstance(o, (int, float)) and isinstance(lo, (int, float)) and isinstance(hi, (int, float)) and lo <= o <= hi


def hot_decision(r, mode):
    """🔥1レースを買うか → (買う?, 見送りの理由)。mode は config の hot9_mode / hot7_mode
    both=期待値1以上 かつ 帯の中 / ev=期待値1以上だけ / band=帯の中だけ / either=どちらか / all=全部 / off=買わない"""
    if mode == "all":
        return True, ""
    if mode == "off":
        return False, "買わない設定"
    ev = r.get("ev")
    ev_ok = isinstance(ev, (int, float)) and ev >= 1
    band_ok = _in_band(r)
    if mode == "both":
        buy = ev_ok and band_ok
    elif mode == "ev":
        buy = ev_ok
    elif mode == "band":
        buy = band_ok
    elif mode == "either":
        buy = ev_ok or band_ok
    else:
        return False, f"買い方の設定が読めない（{mode!r}）"
    if buy:
        return True, ""
    o, lo, hi = r.get("odds"), r.get("bandLo"), r.get("bandHi")
    ev_txt = (f"期待値{ev:.2f}（1未満）" if isinstance(ev, (int, float)) else
              {"thin": "票が薄く期待値を出せない", "noDelta": "選手データが足りず期待値を出せない",
               "noOdds": "締切前の倍率が無い"}.get(r.get("verdict"), "期待値を出せない"))
    band_txt = f"{o}倍は帯{lo}〜{hi}倍の外" if isinstance(o, (int, float)) else "倍率が読めず帯を確かめられない"
    if mode == "ev":
        return False, ev_txt
    if mode == "band":
        return False, band_txt
    parts = ([] if ev_ok else [ev_txt]) + ([] if band_ok else [band_txt])
    return False, "・".join(parts)


def _bet(r, cfg, minutes, note="", t=None, n=1):
    """t: モデルDの1点（{ticket, ev, odds}）。無ければレースの ticket・ev・odds"""
    snap = r.get("snap") or {}
    kind = "D" if r.get("kind") == "D" else "hot"
    t = t or {"ticket": r.get("ticket"), "ev": r.get("ev"), "odds": r.get("odds")}
    return Bet(
        kind=kind, n=n,
        date=r["date"], place=r["place"], rno=r["rno"], key=make_key(r["date"], r["place"], r["rno"], kind, n),
        ticket=t["ticket"], close=r["close"], cars=int(r.get("cars") or 0), need_odds=bool(r.get("needOdds")),
        yen=cfg.bet_yen, minutes=round(minutes, 1), ev=t.get("ev"), odds=t.get("odds"),
        verdict=r.get("verdict") or "", snap_left=snap.get("left"), snap_age=snap.get("age"), note=note,
    )


def _d_tickets(r):
    """モデルDの買う組（期待値の高い順・最大 MAX_D_POINTS 点）。古い betplan（tickets 無し）なら ticket の1点"""
    ts = r.get("tickets")
    if not isinstance(ts, list):
        ts = [{"ticket": r.get("ticket"), "ev": r.get("ev"), "odds": r.get("odds"), "sameAsHot": r.get("sameAsHot")}] if r.get("ticket") else []
    return [t for t in ts if isinstance(t, dict) and isinstance(t.get("ticket"), str)][:MAX_D_POINTS]


def _snap_ok(r, cfg):
    """(使える?, 注記, 使えない理由)"""
    snap = r.get("snap") or None
    age = snap.get("age") if snap else None
    left = snap.get("left") if snap else None
    if snap is None or age is None or age > cfg.max_snap_age_minutes * 2:
        return False, "", "締切前の倍率が届かない" + (f"（いちばん新しいのが{age:.0f}分前）" if age is not None else "")
    if age > cfg.max_snap_age_minutes:
        return True, f"少し古い倍率（{age:.0f}分前に取った・締切{left}分前）で判断", ""
    return True, (f"締切{left}分前の倍率で判断" if left is not None else ""), ""


def select(plan, done_keys, spent_yen, races_bought, cfg, at, bought_keys=()):
    """今この瞬間に買う／見送ると決めるレースを返す

    plan         : betplan.js の出力（kind "hot"=🔥 / "D"=モデルD）
    done_keys    : 記録済み（買った・見送りと決めた）のキー
    spent_yen    : 今日使った額 / races_bought: 今日買った件数
    bought_keys  : 実際に買ったキー（モデルDが🔥と同じ組のとき、🔥を買ったなら重ねて買わないため）
    """
    res = Result()
    if not isinstance(plan, dict):
        return res
    races = [r for r in plan.get("races") or [] if isinstance(r, dict)]
    races.sort(key=lambda r: 0 if r.get("kind") != "D" else 1)      # 🔥を先に（モデルDの重なりを判定するため）
    hot_now = set()
    for r in races:
        kind = "D" if r.get("kind") == "D" else "hot"
        date, place, rno, close, ticket = r.get("date"), r.get("place"), r.get("rno"), r.get("close"), r.get("ticket")
        if not (isinstance(date, str) and place and isinstance(rno, int)):
            continue
        if kind == "hot" and not isinstance(ticket, str):
            continue
        key = make_key(date, place, rno, kind)
        d_keys = [make_key(date, place, rno, "D", i) for i in range(1, MAX_D_POINTS + 1)] if kind == "D" else []
        if (kind == "hot" and key in done_keys) or (kind == "D" and all(k in done_keys for k in d_keys)):
            continue
        minutes = minutes_to_close(date, close, at)
        if minutes is None:
            if kind == "hot":
                res.warnings.append(f"{place}{rno}R: 締切が読めない（{close!r}）。見送り")
            continue
        if minutes < cfg.close_min_minutes:
            if minutes > -LATE_WINDOW and kind == "hot":
                res.late.append((key, f"{place}{rno}R {ticket} 締切{close}: 決める前に締切が近づいた（あと{minutes:.1f}分）"))
            continue
        if minutes > LOOK_MINUTES:
            continue

        if kind == "D":
            if not cfg.buy_model_d:
                continue
            if minutes > cfg.decide_at_minutes:
                continue
            ok, note, why = _snap_ok(r, cfg)
            tks = list(enumerate(_d_tickets(r), 1))          # [(何点目, 組)]
            buy_now = ok and r.get("verdict") == "buy" and tks
            if key in done_keys:
                # もう決めたレース。2点目以降で買えていないもの（失敗して次の周に回ったもの）だけ買い直す
                tks = [(i, t) for i, t in tks if i > 1 and d_keys[i - 1] not in done_keys]
                if not buy_now or not tks:
                    continue
            elif not buy_now:
                res.quiet.extend(d_keys)       # 買う組が無い・倍率が無い: 全レースなので記録もログもしない
                continue
            else:
                # 決めるのはこの1回だけ。このとき無かった番号は黙って決めておく（あとで倍率が動いて組が増えても買わない）
                res.quiet.extend(d_keys[len(tks):])
            hot_key = make_key(date, place, rno, "hot")
            for i, t in tks:
                b = _bet(r, cfg, minutes, note, t, i)
                if b.key in done_keys:
                    continue
                if t.get("sameAsHot") and (hot_key in hot_now or hot_key in bought_keys):
                    res.skips.append((b, "🔥と同じ組を買ったので重ねない"))
                    continue
                res.bets.append(b)
            continue

        is7 = int(r.get("cars") or 0) < 8
        mode = cfg.hot7_mode if is7 else cfg.hot9_mode       # 7車立て・9車立て（8車以上）で別々に決める
        side = "7車立て" if is7 else "9車立て"
        if mode == "off":
            res.skips.append((_bet(r, cfg, minutes), f"🔥の{side}は買わない設定"))
            continue
        if minutes > cfg.decide_at_minutes:
            continue                      # まだ決めない（締切 decide_at_minutes 分前まで待つ）
        ok, note, why = _snap_ok(r, cfg)
        if mode == "all":
            # 🔥を全部: 倍率は見ない（届いていなくても買う）
            res.bets.append(_bet(r, cfg, minutes, note if ok else "倍率を見ずに買う（🔥を全部買う設定）"))
            hot_now.add(key)
            continue
        if not ok:
            res.skips.append((_bet(r, cfg, minutes), why))
            continue
        buy, reason = hot_decision(r, mode)
        if buy:
            res.bets.append(_bet(r, cfg, minutes, note))
            hot_now.add(key)
        else:
            res.skips.append((_bet(r, cfg, minutes, note), reason))

    res.bets.sort(key=lambda b: (b.minutes, b.place, b.rno))

    # 上限。数えるのは bet_done.json の当日分（見送り yen=0 は数えない）
    kept, spent, n = [], spent_yen, races_bought
    for b in res.bets:
        if cfg.max_yen_per_day is not None and spent + b.yen > cfg.max_yen_per_day:
            res.warnings.append(f"1日の上限 {cfg.max_yen_per_day}円 に達したので {b.label} は見送り（使用済み {spent}円）")
            continue
        if cfg.max_races_per_day is not None and n + 1 > cfg.max_races_per_day:
            res.warnings.append(f"1日の上限 {cfg.max_races_per_day}点 に達したので {b.label} は見送り。★多すぎます。何かおかしくないか確かめてください")
            continue
        kept.append(b)
        spent += b.yen
        n += 1
    res.bets = kept
    return res


def summary(plan, at):
    """(今日の🔥の数, 次のレースの説明)。動いていることが分かるように毎周1行出す（モデルDは買う組があるものだけ）"""
    races = [r for r in (plan or {}).get("races") or [] if isinstance(r, dict)
             and (r.get("kind") != "D" or r.get("verdict") == "buy")]
    nxt = None
    for r in races:
        m = minutes_to_close(r.get("date"), r.get("close"), at)
        if m is None or m < 0:
            continue
        if nxt is None or m < nxt[0]:
            snap = r.get("snap")
            s = (f" 倍率:締切{snap.get('left')}分前 判定:{r.get('verdict')}"
                 + (f" 期待値{r['ev']:.2f}" if r.get("ev") is not None else "")) if snap else ""
            tag = "モデルD " if r.get("kind") == "D" else ""
            nxt = (m, f"次は {tag}{r.get('place')}{r.get('rno')}R {r.get('ticket')} 締切{r.get('close')}（あと{m:.0f}分）{s}")
    return len(races), (nxt[1] if nxt else "このあとの勝負レースは無し")
