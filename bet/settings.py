#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""settings.py -- config.json をメニューで書き換える

金額や上限を変えるのに、JSON を手で開かなくて済むようにするだけのもの。
書く前に config.py の検査を通し、通らない値は保存しない。
覚書（"_" で始まるキー）はそのまま残す。

2026-11-26（keirin の hikitsugi §4-73）: 項目が増えて使いづらくなったので、
  最初に「いまの設定のまとめ」→ 種類ごと（🔥9車・🔥7車・Ⓓ・Ⓐ・お金と上限・通知・くわしい設定）に分けた。
  「買う／買わない」と「金額」は1つの項目にまとめた（🔥7車・モデルD・Ⓐ）。「おすすめの設定に戻す」もある。
"""
import json
import os
import secrets
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config as config_mod    # noqa: E402
import notify                  # noqa: E402

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")

YEN, LIMIT_YEN, LIMIT_POINTS, YESNO, MINUTES = "yen", "limit_yen", "limit_pt", "yn", "min"
ONOFF = "onoff"
YENOPT = "yenopt"      # 種類ごとの1点の金額: null = 1点あたりの金額と同じ / 0 = 買わない
MODE = "mode"
PAY = "pay"
TERMS = "terms"
TOPIC = "topic"
SENDTEST = "sendtest"
MULT = "mult"          # 何倍(1〜3)
# 「買うか」と「金額」を1つにした項目(2026-11-26〜): 0 = 買わない / 金額 = その金額で買う / - = 1点あたりの金額(ふだん)で買う
H7BUY = "h7buy"        # 🔥7車: hot7_mode(off なら買わない。買うときは band)+ hot7_yen
DBUY = "dbuy"          # モデルD: buy_model_d + model_d_yen
ABUY = "abuy"          # Ⓐ: buy_ai_fav + ai_fav_yen
BUYKEY = {H7BUY: "hot7_mode", DBUY: "buy_model_d", ABUY: "buy_ai_fav"}   # 金額のほかに一緒に変える設定

TERMS_NOTE = """
  これは「オッズパークの利用規約を自分で読んで、
  自動操作について問題ないと判断した」という、あなた自身の記録です。
  規約は改定されます。長く使うなら、ときどき読み直してください。

  false のままでも dry（購入を押す直前まで）は全部動きます。"""

# 種類ごとの項目(2026-11-26〜)。(見出し, [(名前, 設定のキー, 種類), ...])
GROUPS = [
    ("🔥9車", [
        ("先頭のB率1位のレース（5年 139%）の金額", "hot9_b1_yen", YENOPT),
        ("それ以外のレース（116%）の金額", "hot9_rest_yen", YENOPT),
        ("本命ラインの番手か3番手が地元なら金額を何倍に", "hot9_local_mult", MULT),
        ("出走表の◎が本命ラインの番手なら見送る", "hot9_skip_hon_bante", ONOFF),
        ("本命ラインが切れやすいときだけ（離れる確率17%以上）", "hot9_line_break", ONOFF),
        ("2人だけ来る組がよく買われていたら見送る", "hot9_share2", ONOFF),
    ]),
    ("🔥7車", [
        ("🔥7車を買う・金額", "hot7_yen", H7BUY),
        ("本命ラインの番手か3番手が地元のときだけ買う", "hot7_local_only", ONOFF),
        ("本命ラインの先頭が地元なら見送る", "hot7_skip_local_head", ONOFF),
        ("2人だけ来る組が少ないときだけ買う", "hot7_share2", ONOFF),
    ]),
    ("Ⓓ・Ⓐ", [
        ("Ⓓ モデルD（期待値1.10以上・23倍以下）を買う・金額", "model_d_yen", DBUY),
        ("Ⓐ AI外しの1番人気（S級・4倍以上）を買う・金額", "ai_fav_yen", ABUY),
        ("同じ組を2つ以上の買い方が選んだら金額を足す（しない = 1回だけ）", "stack_same_ticket", ONOFF),
    ]),
    ("お金・上限", [
        ("1点あたりの金額（ふだん）", "bet_yen", YEN),
        ("1日の上限（円）", "max_yen_per_day", LIMIT_YEN),
        ("1日の上限（点数）", "max_races_per_day", LIMIT_POINTS),
        ("支払い方法", "payment_method", PAY),
    ]),
    ("通知", [
        ("通知先（ntfy のトピック名）", "ntfy_topic", TOPIC),
        ("dry でも通知する", "ntfy_in_dry", ONOFF),
        ("通知を試しに1通送る", None, SENDTEST),
    ]),
    ("くわしい設定", [
        ("live を使う（規約を読んだ記録）", "i_have_read_the_terms", TERMS),
        ("🔥9車立ての買い方（帯 5〜15倍）", "hot9_mode", MODE),
        ("🔥7車立ての買い方（帯 締切前10〜15倍・地元の番手は5〜15倍）", "hot7_mode", MODE),
        ("締切まで何分になったら買うか決めるか（そのときのいちばん新しい倍率で）", "decide_at_minutes", MINUTES),
        ("締切まで何分を切ったら買わないか", "close_min_minutes", MINUTES),
        ("ログイン維持の間隔", "keepalive_minutes", MINUTES),
    ]),
]
ITEMS = [it for _, items in GROUPS for it in items]       # 全部の項目(ほかのファイル・テストから使う)
KEYS = [k for _, k, _ in ITEMS if k] + list(BUYKEY.values())   # このメニューで変えられる設定のキー
# おすすめの設定(買い方の条件だけ。金額・上限・支払い・通知・規約・🔥7車を買うかは変えない)
RECOMMEND = {"hot9_mode": "band", "hot9_line_break": True, "hot9_share2": True, "hot9_local_mult": 2, "hot9_skip_hon_bante": True,
             "hot7_share2": True, "hot7_local_only": True, "hot7_skip_local_head": True, "stack_same_ticket": True,
             "decide_at_minutes": 2.0, "close_min_minutes": 1.0, "keepalive_minutes": 10}

MODE_ORDER = ["both", "ev", "band", "either", "all", "off"]
MODE_NOTE = """
  🔥（本命ライン3人の3連複1点）を、締切前の倍率で何を見て買うか。
  期待値はアプリと同じ ev.js。帯は 9車立て 5〜15倍・7車立て 10〜15倍（締切前の倍率。確定ではおよそ9〜15倍。2026-11-23〜。本命ラインの番手か3番手が地元なら5〜15倍・2026-11-26〜）。
  5年の成績: 9車立ては「帯の中だけ」がいちばん安定（帯の中は5年ともプラス）。
  7車立ては「帯の中・2人だけ来る組が少ない」で確定オッズなら105%（締切前の倍率では約103%の見込み）。もうけは小さい。"""

YENOPT_NOTE = """
  🔥9車は「本命ラインの先頭のB率（最終バックを先頭で通った回数の割合）がレースでいちばん」かどうかで分けて
  金額を決められます。2022〜2026年: B率1位 回収139%（年に約100レース）/ それ以外 116%（約140レース）。
  1日の上限（円）に引っかからないよう、金額を上げたら上限も見直してください。"""

TOPIC_NOTE = """
  スマホに ntfy アプリを入れて、ここに入れたのと同じ名前のトピックを購読してください。
  購入した・購入に失敗した・買えずに見送った・止まった ときに通知が来ます。
  ★トピック名を知っている人は誰でも通知を読めます。下の「おすすめ」のような
    推測されにくい名前にしてください（半角の英数字・_・- だけ）。"""


def load_raw():
    with open(PATH, encoding="utf-8") as f:
        return json.load(f)


def save_raw(d):
    dirname = os.path.dirname(PATH)
    fd, tmp = tempfile.mkstemp(dir=dirname, prefix=".config-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp, PATH)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def show(d, key, kind):
    if kind == SENDTEST:
        return ""
    if kind in (H7BUY, DBUY, ABUY):
        bk = BUYKEY[kind]
        if kind == H7BUY:
            try:
                on = config_mod.from_dict(d).hot7_mode != "off"
            except config_mod.ConfigError:
                on = d.get(bk) not in (None, "off")
        else:
            on = bool(d.get(bk, config_mod.DEFAULTS.get(bk)))
        v = d.get(key, config_mod.DEFAULTS.get(key))
        if not on or v == 0:
            return "買わない"
        return f"買う・{(v if v is not None else d.get('bet_yen', config_mod.DEFAULTS['bet_yen'])):,} 円" + ("（1点あたりの金額と同じ）" if v is None else "")
    if kind == MODE:
        try:
            c = config_mod.from_dict(d)
            return config_mod.HOT_MODE_LABEL[getattr(c, key)]
        except config_mod.ConfigError:
            return str(d.get(key))
    v = d.get(key, config_mod.DEFAULTS.get(key))
    if key == "use_ev_7car" and key not in d:
        v = d.get("use_ev", True)              # 古い設定（まとめて1つ）を引き継ぐ
    if kind == TERMS:
        return "使える" if v else "使えない（dry まで）"
    if kind == YESNO:
        return "はい" if v else "いいえ"
    if kind == ONOFF:
        return "する" if v else "しない"
    if kind == PAY:
        return "OPコイン" if v == "opcoin" else "投票資金"
    if kind == TOPIC:
        return v or "通知しない"
    if kind == MULT:
        return "今まで通り（1倍）" if v == 1 else f"{v}倍"
    if kind == YENOPT:
        if v is None:
            return f"買う・1点あたりの金額と同じ（{d.get('bet_yen', config_mod.DEFAULTS['bet_yen']):,} 円）"
        return "買わない" if v == 0 else f"買う・{v:,} 円"
    if v is None:
        return "無制限"
    if kind == YEN or kind == LIMIT_YEN:
        return f"{v:,} 円"
    if kind == LIMIT_POINTS:
        return f"{v} レース"
    return f"{v} 分"


def ask(label, kind, now, d=None):
    print(f"\n  {label}（いま {now}）")
    if kind in (H7BUY, DBUY, ABUY):
        print("  金額を入れてください（100円単位）。0 = 買わない / - = 1点あたりの金額（ふだん）で買う")
        if kind == H7BUY:
            print("  （🔥7車は「帯の中・2人だけ来る組が少ない・地元の番手のとき」だけ買います。条件はこの画面のほかの項目で）")
        s = input("  新しい値（何も入れずに Enter で変えない）: ").strip()
        if not s:
            return None, "変えませんでした"
        bk = BUYKEY[kind]
        if s == "0":
            return {bk: "off" if kind == H7BUY else False}, ""
        if s == "-":
            amt = None
        else:
            try:
                amt = int(s)
            except ValueError:
                return None, f"数字として読めません: {s}"
            if amt <= 0:
                return None, "100円単位の金額を入れてください（買わないなら 0）"
        on = True
        if kind == H7BUY:          # 買い方が「買わない」なら、おすすめの「帯の中だけ」にする(ほかの買い方を選んでいればそのまま)
            cur = "off"
            try:
                cur = config_mod.from_dict(d or {}).hot7_mode
            except config_mod.ConfigError:
                pass
            on = cur if cur != "off" else "band"
        return {BUYKEY[kind]: on, {H7BUY: "hot7_yen", DBUY: "model_d_yen", ABUY: "ai_fav_yen"}[kind]: amt}, ""
    if kind == TERMS:
        print(TERMS_NOTE)
        print("  1=読んだので live を使えるようにする / 2=使えないままにする")
        s = input("  どうしますか（何も入れずに Enter で変えない）: ").strip()
        if s == "2":
            return False, ""
        if s != "1":
            return None, "変えませんでした"
        print("\n  確かに利用規約を自分で読んで、問題ないと判断しましたか。")
        print("  そうであれば yes と入れてください（それ以外なら変えません）。")
        if input("  > ").strip().lower() != "yes":
            return None, "変えませんでした"
        return True, ""
    if kind == TOPIC:
        print(TOPIC_NOTE)
        idea = "keirin-" + secrets.token_hex(6)      # 毎回作り直す乱数(どこにも書かない)
        print(f"  おすすめ（今作った乱数）: {idea}")
        s = input("  トピック名（+ でおすすめを使う / 何も入れずに Enter で変えない / - だけで通知をやめる）: ").strip()
        if not s:
            return None, "変えませんでした"
        if s == "+":
            s = idea
        return ("" if s == "-" else s), ""
    if kind == MODE:
        print(MODE_NOTE)
        for i, m in enumerate(MODE_ORDER, 1):
            print(f"  {i}={config_mod.HOT_MODE_LABEL[m]}")
        s = input("  番号（何も入れずに Enter で変えない）: ").strip()
        if not s:
            return None, "変えませんでした"
        if not s.isdigit() or not (1 <= int(s) <= len(MODE_ORDER)):
            return None, f"1〜{len(MODE_ORDER)} を入れてください"
        return MODE_ORDER[int(s) - 1], ""
    if kind == YESNO:
        print("  1=買う / 2=買わない")
    elif kind == ONOFF:
        print("  1=する / 2=しない")
    elif kind == PAY:
        print("  1=OPコイン / 2=投票資金")
    elif kind in (LIMIT_YEN, LIMIT_POINTS):
        print("  数字を入れてください。0 なら無制限")
    elif kind == YEN:
        print("  数字を入れてください（100円単位）")
    elif kind == MULT:
        print("  1 = 今まで通り / 2 = 2倍 / 3 = 3倍（地元の番手・3番手の🔥9車。5年 175%・アプリの記録 223%）")
    elif kind == YENOPT:
        print(YENOPT_NOTE)
        print("  金額を入れてください（100円単位）。0 = 買わない / - = 1点あたりの金額（ふだん）と同じ")
    else:
        print("  分を入れてください")
    s = input("  新しい値（何も入れずに Enter で変えない）: ").strip()
    if not s:
        return None, "変えませんでした"
    if kind == YENOPT and s == "-":
        return "__NULL__", ""
    if kind == PAY:
        if s not in ("1", "2"):
            return None, "1 か 2 を入れてください"
        return ("opcoin" if s == "1" else "cash"), ""
    if kind in (YESNO, ONOFF):
        if s not in ("1", "2"):
            return None, "1 か 2 を入れてください"
        return s == "1", ""
    if kind == MULT:
        if s not in ("1", "2", "3"):
            return None, "1・2・3 のどれかを入れてください"
        return int(s), ""
    try:
        n = float(s) if kind == MINUTES else int(s)
    except ValueError:
        return None, f"数字として読めません: {s}"
    if n < 0:
        return None, "0 以上にしてください"
    if kind in (LIMIT_YEN, LIMIT_POINTS) and n == 0:
        return "__NULL__", ""                  # 0 は「無制限」の意味にする
    if kind == MINUTES and n == int(n):
        n = int(n)
    return n, ""


def load():
    return config_mod.migrate(load_raw())     # 見本のままの古い値は今の既定で見せる(保存すると書き換わる)


def summary(d):
    """いまの設定のまとめ(数行)"""
    try:
        c = config_mod.from_dict(d)
    except config_mod.ConfigError as e:
        return [f"  ★設定が読めません: {e}"]
    yen = lambda v: "買わない" if v == 0 else f"{(v if v is not None else c.bet_yen):,}円"
    L = []
    if c.hot9_mode == "off":
        L.append("  🔥9車  買わない")
    else:
        opt = [f"地元の番手×{c.hot9_local_mult}" if c.hot9_local_mult > 1 else "", "◎が番手は見送り" if c.hot9_skip_hon_bante else ""]
        opt = [x for x in opt if x]
        L.append(f"  🔥9車  B率1位 {yen(c.hot9_b1_yen)}・それ以外 {yen(c.hot9_rest_yen)}" + (f"（{'・'.join(opt)}）" if opt else ""))
    L.append("  🔥7車  " + ("買わない" if c.hot7_mode == "off" or c.hot7_yen == 0 else yen(c.hot7_yen) + ("（地元の番手のときだけ）" if c.hot7_local_only else "")))
    L.append(f"  Ⓓ {yen(c.model_d_yen) if c.buy_model_d else '買わない'} ／ Ⓐ {yen(c.ai_fav_yen) if c.buy_ai_fav else '買わない'}"
             f" ／ 同じ組は{'金額を足す' if c.stack_same_ticket else '1回だけ'}")
    lim_y = "無制限" if c.max_yen_per_day is None else f"{c.max_yen_per_day:,}円"
    lim_n = "無制限" if c.max_races_per_day is None else f"{c.max_races_per_day}レース"
    L.append(f"  上限  1日 {lim_y}・{lim_n} ／ 支払い {'OPコイン' if c.payment_method == 'opcoin' else '投票資金'}")
    L.append("  通知  " + (c.ntfy_topic + ("（dry でも送る）" if c.ntfy_in_dry else "") if c.ntfy_topic else "通知しない"))
    L.append("  本番  " + ("live を使える" if c.i_have_read_the_terms else "まだ dry まで（6) くわしい設定 の「live を使う」で）"))
    return L


def rec_note(d, key, kind):
    """おすすめと違えば「（おすすめ: …）」"""
    if key not in RECOMMEND:
        return ""
    now, rec = show(d, key, kind), show(dict(d, **{key: RECOMMEND[key]}), key, kind)
    return "" if now == rec else f"　★おすすめ: {rec}"


def edit(d, label, key, kind):
    """1項目を変える → 画面に出す文"""
    if kind == SENDTEST:
        try:
            ok, msg = notify.test(config_mod.from_dict(d))
        except config_mod.ConfigError as e:
            ok, msg = False, f"設定が読めません: {e}"
        return msg
    value, why = ask(label, kind, show(d, key, kind), d)
    if value is None:
        return why
    upd = value if isinstance(value, dict) else {key: None if value == "__NULL__" else value}
    cand = dict(d)
    cand.update(upd)
    cand["_config_v"] = config_mod.CONFIG_V
    try:
        config_mod.from_dict(cand)          # 通らない値は保存しない
    except config_mod.ConfigError as e:
        return f"★その値は使えません: {e}"
    save_raw(cand)
    return f"{label} を {show(cand, key, kind)} にしました"


def group_menu(gi):
    title, items = GROUPS[gi]
    while True:
        d = load()
        print(f"\n   {title}")
        print("   " + "-" * 46)
        for i, (label, key, kind) in enumerate(items, 1):
            v = show(d, key, kind)
            print(f"    {i}) {label}" + (f"\n         いま: {v}{rec_note(d, key, kind)}" if v else ""))
        print("    0) 戻る")
        print("   " + "-" * 46)
        n = input("   変える番号を入れて Enter: ").strip()
        if n == "0" or not n:
            return
        if not n.isdigit() or not (1 <= int(n) <= len(items)):
            continue
        print("  " + edit(d, *items[int(n) - 1]))


def reset_recommended():
    d = load()
    diff = []
    for _, items in GROUPS:
        for label, key, kind in items:
            if key in RECOMMEND and rec_note(d, key, kind):
                diff.append((label, show(d, key, kind), show(dict(d, **{key: RECOMMEND[key]}), key, kind)))
    if not diff:
        print("\n  いまの設定は、おすすめの買い方の条件と同じです。")
        return
    print("\n  おすすめの設定（買い方の条件）に戻すと、次が変わります。")
    print("  （金額・上限・支払い・通知・規約・🔥7車を買うかは変えません）")
    for label, now, rec in diff:
        print(f"    ・{label}: {now} → {rec}")
    if input("  戻すなら y を入れて Enter: ").strip().lower() != "y":
        print("  変えませんでした")
        return
    cand = dict(d)
    cand.update(RECOMMEND)
    cand["_config_v"] = config_mod.CONFIG_V
    try:
        config_mod.from_dict(cand)
    except config_mod.ConfigError as e:
        print(f"  ★戻せませんでした: {e}")
        return
    save_raw(cand)
    print("  おすすめの設定に戻しました")


def main():
    _, note = config_mod.ensure(PATH)      # 無ければ見本から作る
    if note:
        print(note)
    if not os.path.exists(PATH):
        print(f"設定ファイルがありません: {PATH}")
        return 2
    while True:
        try:
            d = load()
        except json.JSONDecodeError as e:
            print(f"config.json が壊れています: {e}")
            return 2
        print("\n   いまの設定")
        print("   " + "-" * 46)
        for line in summary(d):
            print(line)
        print("   " + "-" * 46)
        for i, (title, items) in enumerate(GROUPS, 1):
            mark = "　★おすすめと違う設定あり" if any(rec_note(d, k, kind) for _, k, kind in items) else ""
            print(f"    {i}) {title}{mark}")
        print(f"    {len(GROUPS) + 1}) おすすめの設定に戻す（買い方の条件だけ）")
        print("    0) 終わる")
        print("   " + "-" * 46)
        try:
            n = input("   番号を入れて Enter: ").strip()
            if n == "0" or not n:
                return 0
            if n == str(len(GROUPS) + 1):
                reset_recommended()
            elif n.isdigit() and 1 <= int(n) <= len(GROUPS):
                group_menu(int(n) - 1)
        except (EOFError, KeyboardInterrupt):
            print()
            return 0


if __name__ == "__main__":
    sys.exit(main())
