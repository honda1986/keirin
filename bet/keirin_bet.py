#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""keirin_bet.py -- アプリの🔥（期待値で絞ったもの）を、オッズパークで自動購入する

  python keirin_bet.py --mode check   ブラウザを開かず、買う／見送るの判定を並べるだけ
  python keirin_bet.py --mode dry     ブラウザを開き、確認画面まで進んで押さない
  python keirin_bet.py --mode live    実際に購入する（config.json の i_have_read_the_terms が true のときだけ）
  python keirin_bet.py --mode dry --fake 広島-1-3-4-6   疑似の買い目で画面操作を試す（dry / check だけ）

★既定のモードはありません。--mode は毎回自分で書きます。
★いきなり live にしないこと。check を数日 → dry を数日 → live で1日1レース。
★ログインID・パスワード・暗証番号はどこにも保存しません。開いた Chrome で手で入れます。

判定は keirin の betplan.js（アプリと同じ ev.js）が出します。ここでは計算し直しません。
"""
import argparse
import os
import sys
import time
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import betlog                       # noqa: E402
import browser                      # noqa: E402
import config as config_mod         # noqa: E402
import oddspark_page as op          # noqa: E402
import plan_source                  # noqa: E402
import selector                     # noqa: E402
from bet_store import BetDoneCorrupt, BetStore       # noqa: E402
from jst import date_str, earlier, minutes_to_close, now      # noqa: E402

MODES = ("check", "dry", "live")
MAX_FAILS = 2            # 同じレースで画面操作がこれだけ失敗したら、そのレースは見送る
SUMMARY_EVERY = 300      # 何も無いときの「見た」の行を何秒おきに出すか

TERMS_NG = """live は起動できません。
config.json の i_have_read_the_terms が false のままです。

オッズパークの利用規約を、自分で読むこと。自動操作の扱いはそこに書かれています。
読んで、問題ないと自分で判断したときだけ true にしてください（run.bat の 7) からも変えられます）。
判断できないなら false のままで構いません。dry なら、購入を押す直前まで全部動きます。"""


class RecordFailed(Exception):
    """押す直前に bet_done.json へ書けなかった。押していない"""


def fake_plan(spec, at):
    """疑似の買い目を1件だけ作る。画面操作を試すためだけのもの

      --fake 広島-1          広島1R、買い目 1=2=3
      --fake 広島-1-3-4-6    買い目も指定する（三連複なので順不同。昇順にそろえる）
    締切は8分後、倍率は「締切5分前に取った・期待値1.20」ということにするので、そのまま「買い」に入る。
    """
    parts = [p.strip() for p in str(spec).replace("R", "").split("-") if p.strip()]
    if len(parts) < 2 or not parts[1].isdigit() or not (1 <= int(parts[1]) <= 12):
        raise ValueError("--fake は 場-レース番号[-車-車-車] の形で書いてください（例 広島-1 / 広島-1-3-4-6）")
    cars = sorted({int(x) for x in parts[2:5]}) if len(parts) >= 5 else [1, 2, 3]
    if len(cars) != 3 or not all(1 <= c <= 9 for c in cars):
        raise ValueError("買い目は 1〜9 の重複しない3車にしてください")
    close = (at + timedelta(minutes=8)).strftime("%H:%M")
    return {"date": date_str(at), "races": [{
        "key": f"{parts[0]}_{parts[1]}R", "date": date_str(at), "place": parts[0], "rno": int(parts[1]),
        "raceNo": f"{parts[1]}R", "close": close, "cars": 9, "ticket": "=".join(map(str, cars)),
        "needOdds": False, "verdict": "buy", "ev": 1.2, "odds": 9.9,
        "snap": {"t": at.strftime("%H:%M:%S"), "left": 5, "age": 0.1, "src": "疑似"},
    }], "racesFrom": "疑似", "oddsFrom": "疑似"}


class Runner:
    """1周ぶんの流れ。画面操作は bet_fn として外から差し込む（テストは偽物を渡す）"""

    def __init__(self, cfg, store, mode, log, plan_fn, bet_fn=None, cleanup_fn=None,
                 keepalive_fn=None, now_fn=None):
        self.cfg = cfg
        self.store = store
        self.mode = mode
        self.log = log
        self.plan_fn = plan_fn
        self.bet_fn = bet_fn
        self.cleanup_fn = cleanup_fn
        self.keepalive_fn = keepalive_fn
        self.now_fn = now_fn or now
        self.stop_path = cfg.path("stop_file")
        self.halt_reason = ""
        self.decided = set()        # check / dry で決めたレース（live は bet_done.json に書く）
        self.fails = {}
        self._said = set()
        self._last_summary = (None, 0.0)
        self._last_touch = None
        self._plan_why = None

    def stopped(self):
        return os.path.exists(self.stop_path)

    def _once(self, key, result, note):
        if key not in self._said:
            self._said.add(key)
            self.log.event(result, note)

    def _decide_skip(self, b, reason):
        """見送りと決める。live は bet_done.json に yen=0 で書く（決め直さない）"""
        if self.mode == "live":
            try:
                self.store.record(b, self.mode, 0, note="見送り: " + reason)
            except Exception as e:
                self.decided.add(b.key)
                self.log.bet(b, "見送り", f"{reason}（記録できず: {e}）")
                return
        else:
            self.decided.add(b.key)
        self.log.bet(b, "見送り", reason)

    def cycle(self):
        """1周まわす。"stop" / "ok" / "abort"（この周は打ち切り） / "halt"（止める）"""
        if self.stopped():
            return "stop"
        plan, why = self.plan_fn()
        if plan is None:
            if why != self._plan_why:
                self.log.event("見送り", f"判定を取れず（{why}）")
            self._plan_why = why
            return "ok"
        self._plan_why = None
        for n in plan.get("notes") or []:
            self._once("note:" + n, "見た", n)

        at = self.now_fn()
        today = plan.get("date") or date_str(at)
        done = self.store.keys() | self.decided
        spent, bought = self.store.spent_on(today), self.store.races_on(today)
        res = selector.select(plan, done, spent, bought, self.cfg, at)

        for w in res.warnings:
            self._once("w:" + w, "見送り", w)
        for key, text in res.late:
            if not self.store.has(key) and key not in self.decided:
                self._once("late:" + key, "見送り", text)

        n_hot, nxt = selector.summary(plan, at)
        head = f"今日の勝負レース {n_hot}（出走表:{plan.get('racesFrom')} 倍率:{plan.get('oddsFrom')}）/ いま買う {len(res.bets)}件 / {nxt}"
        key0 = (nxt.split("（")[0], len(res.bets), len(res.skips))
        if key0 != self._last_summary[0] or time.time() - self._last_summary[1] > SUMMARY_EVERY or res.bets:
            self.log.event("見た", head)
            self._last_summary = (key0, time.time())

        for b, reason in res.skips:
            self._decide_skip(b, reason)

        if not res.bets:
            return self._keepalive(at)

        for b in res.bets:
            if self.stopped():
                return "stop"
            state = self._one(b, today)
            if state != "ok":
                return state
        return "ok"

    def _one(self, b, today):
        if self.mode == "check":
            self.decided.add(b.key)
            self.log.bet(b, "買い", f"（check なので購入しません）{b.note}")
            return "ok"
        if self.store.has(b.key) or b.key in self.decided:
            return "ok"
        left = minutes_to_close(b.date, b.close, self.now_fn())
        if left is None or left < self.cfg.close_min_minutes:
            self._decide_skip(b, f"押す前に締切が近づいた（あと{left:.1f}分）" if left is not None else "締切が読めない")
            return "ok"

        live = self.mode == "live"
        pressed = {"v": False}

        def guard(site_close):
            eff = earlier(b.date, b.close, site_close)
            if site_close is None and self.cfg.require_site_close and live:
                raise op.SkipRace("オッズパークの画面から締切が読めない（require_site_close が true）")
            m = minutes_to_close(b.date, eff, self.now_fn())
            if m is None or m < self.cfg.close_min_minutes:
                raise op.SkipRace(f"締切{eff}まであと{m:.1f}分しかない" if m is not None else "締切が読めない")

        def before_press():
            try:
                self.store.record(b, self.mode, b.yen, note="押す直前に記録（結果待ち）")
            except Exception as e:
                raise RecordFailed(str(e))
            pressed["v"] = True

        if not live:
            self.decided.add(b.key)            # dry は同じレースを何周も試さない
        try:
            note = self.bet_fn(b, live, guard, before_press)
        except op.BetUncertain as e:
            return self._uncertain(b, e)
        except op.LoggedOut as e:
            self._cleanup_note(b, "失敗", f"{e}。ログインし直します")
            self.fails[b.key] = self.fails.get(b.key, 0) + 1
            if self.keepalive_fn and self.fails[b.key] < MAX_FAILS:
                self._last_touch = self.now_fn()
                try:
                    if self.keepalive_fn() is not False:
                        return "abort"          # 入り直せた。次の周で同じレースをもう一度
                except Exception:
                    pass
            self.halt_reason = "★ログインが切れたまま入り直せませんでした。動かし直して、開いた Chrome でログインしてください"
            return "halt"
        except RecordFailed as e:
            self._cleanup_note(b, "失敗", f"bet_done.json に書けないので押しませんでした（{e}）")
            self.halt_reason = "★bet_done.json に書けません。直してから動かし直してください"
            return "halt"
        except op.SkipRace as e:
            self._cleanup_note(b, "見送り", str(e), log=False)
            self._decide_skip(b, str(e))
            return "ok"
        except Exception as e:
            if pressed["v"]:               # 押した後の例外は press_buy が BetUncertain にするはずだが、念のため
                return self._uncertain(b, e)
            self.fails[b.key] = self.fails.get(b.key, 0) + 1
            self._cleanup_note(b, "失敗", f"{type(e).__name__}: {e} ★手で確認してください")
            if self.fails[b.key] >= MAX_FAILS and b.key not in self.decided:
                self._decide_skip(b, f"画面操作が{MAX_FAILS}回失敗したので見送り")
            return "abort"

        self._last_touch = self.now_fn()
        if not live:
            cleaned = self.cleanup_fn() if self.cleanup_fn else None
            tail = "" if cleaned is None else ("。ベットリストは片付けました" if cleaned else "。★ベットリストが片付いたか確かめてください")
            self.log.bet(b, "見送り", f"{note}{tail}")
            return "ok"
        self.store.set_note(b.key, note)
        self.log.bet(b, "購入した", f"当日計 {self.store.spent_on(today)}円 {note}")
        return "ok"

    def _cleanup_note(self, b, result, note, log=True):
        cleaned = self.cleanup_fn() if self.cleanup_fn else None
        if cleaned is False:
            note += "｜★ベットリストに残りがあるかもしれません。オッズパークの画面で確かめてください"
        if log:
            self.log.bet(b, result, note)

    def _uncertain(self, b, e):
        """押した後で失敗した。購入済みとして記録を残し、止める（次の周で買い直すのがいちばん危ない）"""
        try:
            if self.store.has(b.key):
                self.store.set_note(b.key, f"要確認（{e}）")
            else:
                self.store.record(b, self.mode, b.yen, note=f"要確認（{e}）")
            note = "購入済みとして記録しました"
        except Exception as e2:
            note = f"★記録もできませんでした（{e2}）。次に動かす前に bet_done.json を直すこと"
        self.log.bet(b, "失敗", f"{e} ★オッズパークの投票履歴で確かめてください（{note}）。止めます")
        self.halt_reason = ("★購入の結果が分からないので止めました。オッズパークの投票履歴を見て、"
                            "買えていなければ bet_done.json のその行（note に「要確認」）を消してください")
        return "halt"

    def _keepalive(self, at):
        if not self.keepalive_fn or not self.cfg.keepalive_minutes:
            return "ok"
        if self._last_touch is not None and (at - self._last_touch).total_seconds() < self.cfg.keepalive_minutes * 60:
            return "ok"
        self._last_touch = at
        try:
            alive = self.keepalive_fn()
        except Exception as e:
            self.log.event("見送り", f"画面を読み直せません（{type(e).__name__}: {e}）")
            return "ok"
        if alive is False:
            self.halt_reason = "★ログインが切れたまま入り直せませんでした。動かし直して、開いた Chrome でログインしてください"
            return "halt"
        return "ok"

    def loop(self, once=False):
        self.log.event("開始", f"{self.mode} / {self.cfg.poll_seconds}秒おき / 1日の上限 "
                               f"{self.cfg.max_yen_per_day or '無制限'}円・{self.cfg.max_races_per_day or '無制限'}レース / "
                               f"止めるには {self.stop_path} を作るか Ctrl+C")
        while True:
            state = self.cycle()
            if state == "stop":
                self.log.event("終了", f"{self.stop_path} があるので止めます")
                return 0
            if state == "halt":
                self.log.event("終了", self.halt_reason or "止めました")
                return 4
            if state == "abort":
                self.log.event("打ち切り", "この周は途中で止めました。次の周へ")
            if once:
                return 0
            for _ in range(self.cfg.poll_seconds):
                if self.stopped():
                    break
                time.sleep(1)


def code_version():
    """いま動いている bet/ の版（bet/ を最後に変えたコミットと、その日時）。PC の取り込みが済んだかを確かめるため"""
    import subprocess
    here = os.path.dirname(os.path.abspath(__file__))
    try:
        p = subprocess.run(["git", "log", "-1", "--format=%h %cd", "--date=format-local:%m/%d %H:%M", "--", "."], cwd=here,
                           capture_output=True, encoding="utf-8", timeout=10)
        return p.stdout.strip() or "?"
    except Exception:
        return "?"


def ensure_logged_in(session, tries=3):
    """ログインを確かめ、入っていなければ、開いている Chrome で手でログインしてもらう

    ★ID・パスワード・暗証番号はこのプログラムに入れない。Chrome の画面に自分で入れる。
    """
    for i in range(tries):
        state = op.check_logged_in(session.page)
        if state is True:
            return True
        if not sys.stdin or not sys.stdin.isatty():
            return False                      # 無人。勝手に進まない
        print("\nログインが確認できません。")
        print("いま開いている Chrome（オッズパーク）で、手でログインしてください（暗証番号の画面まで）。")
        print("★ID・パスワード・暗証番号は、この黒い画面には入れないでください。")
        if state is None and i == tries - 1:
            print("（ログイン済みならそのまま Enter。このまま進みます）")
        try:
            input("終わったら Enter を押してください（やめるときは Ctrl+C）... ")
        except EOFError:
            return False
        if state is None and i == tries - 1:
            return True                       # 目印が見つからないだけかもしれない。人が「入った」と言うなら従う
    return op.check_logged_in(session.page) is not False


def main(argv=None):
    ap = argparse.ArgumentParser(description="keirin の🔥 → オッズパーク 自動購入")
    ap.add_argument("--mode", required=True, choices=MODES, help="check / dry / live（既定はありません）")
    ap.add_argument("--config", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json"))
    ap.add_argument("--once", action="store_true", help="1周だけ動かして終わる")
    ap.add_argument("--fake", metavar="場-R[-車-車-車]", help="疑似の買い目で画面操作を試す（dry / check だけ。例 広島-1-3-4-6）")
    args = ap.parse_args(argv)

    _, note = config_mod.ensure(args.config)
    if note:
        print(note)
    try:
        cfg = config_mod.load(args.config)
    except config_mod.ConfigError as e:
        print(f"設定が読めません: {e}")
        return 2
    for k in cfg.unknown_keys:
        print(f"（config.json の {k} は使っていません）")
    if args.fake and args.mode == "live":
        print("--fake は live では使えません（疑似の買い目でお金は使いません）。--mode dry で試してください。")
        return 2
    if args.mode == "live" and not cfg.i_have_read_the_terms:
        print(TERMS_NG)
        return 2

    log = betlog.Log(cfg.path("log_path"), args.mode)
    log.event("版", f"コード {code_version()}（PC は10分おきに GitHub から取り込みます）")
    try:
        store = BetStore(cfg.path("bet_done_path"))
    except BetDoneCorrupt as e:
        print(f"★ {e}")
        print("空で続けると二重購入になります。中身を直すか、退避してから動かしてください。")
        return 3

    if args.fake:
        try:
            fake_plan(args.fake, now())
        except ValueError as e:
            print(e)
            return 2
        print(f"★疑似の買い目で動かします（{args.fake}）。betplan.js は見ません")
        log.event("開始", f"★疑似の買い目 {args.fake}")
        plan_fn = lambda: (fake_plan(args.fake, now()), "")     # noqa: E731
    else:
        plan_fn = lambda: plan_source.run(cfg)                  # noqa: E731
        plan, why = plan_fn()
        if plan is None:
            print(f"判定を取れません: {why}")
            return 2

    if args.mode == "check":
        try:
            return Runner(cfg, store, "check", log, plan_fn).loop(once=args.once)
        except KeyboardInterrupt:
            log.event("終了", "Ctrl+C")
            return 0

    print(f"Chrome を起動しています（数秒かかります）: {cfg.path('profile_dir')}")
    try:
        with browser.open_context(cfg) as (ctx, page):
            session = op.Session(ctx, page, cfg, log)
            op.open_top(page, cfg.oddspark_url)
            if not ensure_logged_in(session):
                print("ログインが確認できないので止めます。")
                log.event("終了", "ログインしていない")
                return 2
            log.event("見た", "ログインを確かめました")
            # 投票の窓を先に開いておく。最初に「本人確認」（パスワード）を聞かれるので、人がいるうちに済ませる
            try:
                session.vote_page()
                log.event("見た", "投票の窓（レースまとめ投票）を開きました")
            except Exception as e:
                log.event("見送り", f"投票の窓をまだ開けません（{type(e).__name__}: {e}）。買うときにもう一度開きます")

            def bet_fn(b, live, guard, before_press):
                return op.bet(session, b, live, guard, before_press)

            def cleanup_fn():
                try:
                    return session.clear_slip()
                except Exception as e:
                    log.event("見送り", f"ベットリストを片付けられません（{e}）")
                    return False

            def keepalive_fn():
                alive = session.keepalive()
                if alive is not False:
                    log.event("見た", "ログイン維持（トップを読み直した）")
                    return True
                log.event("見送り", "★ログインが切れました。手でログインし直してください")
                session.close_vote()
                return ensure_logged_in(session)

            runner = Runner(cfg, store, args.mode, log, plan_fn, bet_fn=bet_fn,
                            cleanup_fn=cleanup_fn, keepalive_fn=keepalive_fn)
            return runner.loop(once=args.once)
    except browser.BrowserUnavailable as e:
        print(e)
        return 2
    except KeyboardInterrupt:
        log.event("終了", "Ctrl+C")         # 記録は押す直前に書いてあるので、ここで壊れるものは無い
        return 0


if __name__ == "__main__":
    sys.exit(main())
