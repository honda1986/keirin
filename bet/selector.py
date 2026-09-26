#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""selector.py -- 「いま買う／見送ると決める」レースを選ぶ。ネットも画面も触らない純関数

★買い目も判定も作り直さない。betplan.js（アプリと同じ ev.js）の verdict をそのまま使う。
  ここで決めるのは「いつ決めるか」と「上限」だけ。

いつ決めるか:
  締切前オッズは PC の snap.js が締切15〜2分前に3分おきに取る。
  「締切まで decide_left_minutes（既定6分）以内に取った倍率」が届いた時点で1回だけ決める
  （ふつうは締切3〜6分前の倍率。確定オッズにいちばん近い）。
  決めたら、あとで倍率が動いても決め直さない（何度も見て「買い」を拾うと、検証していない別のルールになる）。
  締切間際（close_min_minutes + 1.5分）になっても届かなければ、そのとき手元にある最後の倍率で決める。
  それも無ければ見送り。
"""
from dataclasses import dataclass, field

from bet_store import make_key
from jst import minutes_to_close

LATE_WINDOW = 30          # 締切を何分過ぎたぶんまで「間に合わなかった」と報せるか
LOOK_MINUTES = 16         # 締切まで何分以内のレースを見るか（snap.js は15分前から）
LAST_CHANCE = 1.5         # close_min_minutes にこれを足した時刻を過ぎたら、手元の倍率で決める


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

    @property
    def label(self):
        return f"{self.place}{self.rno}R"


@dataclass
class Result:
    bets: list = field(default_factory=list)       # いま買う
    skips: list = field(default_factory=list)      # 見送りと決めた (Bet, 理由)
    late: list = field(default_factory=list)       # 間に合わなかった (キー, 説明)
    warnings: list = field(default_factory=list)


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


def _bet(r, cfg, minutes, note=""):
    snap = r.get("snap") or {}
    return Bet(
        date=r["date"], place=r["place"], rno=r["rno"], key=make_key(r["date"], r["place"], r["rno"]),
        ticket=r["ticket"], close=r["close"], cars=int(r.get("cars") or 0), need_odds=bool(r.get("needOdds")),
        yen=cfg.bet_yen, minutes=round(minutes, 1), ev=r.get("ev"), odds=r.get("odds"),
        verdict=r.get("verdict") or "", snap_left=snap.get("left"), snap_age=snap.get("age"), note=note,
    )


def select(plan, done_keys, spent_yen, races_bought, cfg, at):
    """今この瞬間に買う／見送ると決めるレースを返す

    plan         : betplan.js の出力
    done_keys    : 記録済み（買った・見送りと決めた）のキー
    spent_yen    : 今日使った額 / races_bought: 今日買ったレース数
    """
    res = Result()
    if not isinstance(plan, dict):
        return res
    for r in plan.get("races") or []:
        if not isinstance(r, dict):
            continue
        date, place, rno, close, ticket = r.get("date"), r.get("place"), r.get("rno"), r.get("close"), r.get("ticket")
        if not (isinstance(date, str) and place and isinstance(rno, int) and isinstance(ticket, str)):
            continue
        key = make_key(date, place, rno)
        if key in done_keys:
            continue
        minutes = minutes_to_close(date, close, at)
        if minutes is None:
            res.warnings.append(f"{place}{rno}R: 締切が読めない（{close!r}）。見送り")
            continue
        if minutes < cfg.close_min_minutes:
            if minutes > -LATE_WINDOW:
                res.late.append((key, f"{place}{rno}R {ticket} 締切{close}: 決める前に締切が近づいた（あと{minutes:.1f}分）"))
            continue
        if minutes > LOOK_MINUTES:
            continue
        if r.get("needOdds") and not cfg.buy_7car:
            res.skips.append((_bet(r, cfg, minutes), "7車立ては買わない設定"))
            continue

        snap = r.get("snap") or None
        age = snap.get("age") if snap else None
        left = snap.get("left") if snap else None
        usable = snap is not None and age is not None and left is not None and age <= cfg.max_snap_age_minutes
        last_chance = minutes <= cfg.close_min_minutes + LAST_CHANCE
        note = ""
        use_ev = cfg.use_ev_7car if r.get("needOdds") else cfg.use_ev_9car     # 7車立て・9車立て（8車以上）で別々に決める
        if not use_ev and not r.get("needOdds"):
            # 期待値を使わない設定の9車立ては、倍率が無くても買う（アプリの「期待値で絞る」をオフにしたのと同じ）
            if minutes > cfg.decide_left_minutes:
                continue
            res.bets.append(_bet(r, cfg, minutes, "期待値を使わない設定"))
            continue
        ready = usable and left <= cfg.decide_left_minutes
        if not ready and last_chance and snap is not None and age is not None and age <= cfg.max_snap_age_minutes * 2:
            ready, note = True, f"締切{left}分前の倍率で判断（それより新しい倍率が届かない）"
        if not ready:
            if last_chance:
                res.skips.append((_bet(r, cfg, minutes), "締切前の倍率が届かない"))
            continue

        v = r.get("verdict")
        if use_ev:
            buy = v == "buy"
        else:       # 7車立て: 帯だけ見る
            buy = v in ("buy", "skipEv")
        if buy:
            res.bets.append(_bet(r, cfg, minutes, note))
        else:
            res.skips.append((_bet(r, cfg, minutes, note), skip_reason(r)))

    res.bets.sort(key=lambda b: (b.minutes, b.place, b.rno))

    # 上限。数えるのは bet_done.json の当日分（見送り yen=0 は数えない）
    kept, spent, n = [], spent_yen, races_bought
    for b in res.bets:
        if cfg.max_yen_per_day is not None and spent + b.yen > cfg.max_yen_per_day:
            res.warnings.append(f"1日の上限 {cfg.max_yen_per_day}円 に達したので {b.label} は見送り（使用済み {spent}円）")
            continue
        if cfg.max_races_per_day is not None and n + 1 > cfg.max_races_per_day:
            res.warnings.append(f"1日の上限 {cfg.max_races_per_day}レース に達したので {b.label} は見送り。★多すぎます。何かおかしくないか確かめてください")
            continue
        kept.append(b)
        spent += b.yen
        n += 1
    res.bets = kept
    return res


def summary(plan, at):
    """(今日の🔥の数, 次のレースの説明)。動いていることが分かるように毎周1行出す"""
    races = [r for r in (plan or {}).get("races") or [] if isinstance(r, dict)]
    nxt = None
    for r in races:
        m = minutes_to_close(r.get("date"), r.get("close"), at)
        if m is None or m < 0:
            continue
        if nxt is None or m < nxt[0]:
            snap = r.get("snap")
            s = (f" 倍率:締切{snap.get('left')}分前 判定:{r.get('verdict')}"
                 + (f" 期待値{r['ev']:.2f}" if r.get("ev") is not None else "")) if snap else ""
            nxt = (m, f"次は {r.get('place')}{r.get('rno')}R {r.get('ticket')} 締切{r.get('close')}（あと{m:.0f}分）{s}")
    return len(races), (nxt[1] if nxt else "このあとの勝負レースは無し")
