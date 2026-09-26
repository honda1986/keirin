#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""oddspark_page.py -- オッズパークの画面操作。サイトの作りが変わったら、ここだけ直す

★ログインID・パスワード・暗証番号は扱わない。ログインは開いた Chrome で人が手で入れる。

採取（利用者の playwright codegen、2026-09-21）で分かっている流れ:
  トップ → （手でログイン）→「投票する」→ ★別ウィンドウ（ポップアップ）が開く
  → 場（例「広島」）→ レース（「1R」）→ #mode1 の「通常」→「連複」→ #mode3 の「通常」
  → #row1_{車} #row2_{車} #row3_{車}（三連複は昇順で1段に1車ずつ）
  → #textfield11 に「1」（100円単位）→「セット」→「投票手続へ」→「購入する」→「続けて購入する」

採取コードの「その日たまたま」の書き方は直してある:
  link("投票する").nth(2)      → 競輪の「投票する」を href / 周りの文字で探す（見つからなければ nth(vote_link_index)）
  link("1R 発売中").nth(4)     → 使わない。場の名前で場を選び、R 番号で選ぶ
  get_by_role("textbox")      → 使わない（暗証番号の欄。ログインは人が手でやる）
  link("広島").dblclick()      → 1回押して、R のリンクが出なければもう1回

★まだ採取できていないもの（dry の shots/ を見て直す）:
  締切の表示場所 / 確認画面の合計の表示 / ログイン済みの目印 / 締切後・残高不足の画面 /
  9車立ての #row*_8 #row*_9 / ベットリストの消し方
  → いまは画面の文字（inner_text）から正規表現で読む。読めなければ安全側（買わない）に倒す
"""
import os
import re
import time

from jst import now

SELECTORS = {
    "login_id": 'input[name="SSO_ACCOUNTID"]',      # あれば「ログインしていない」の印に使うだけ。入力はしない
    "vote_link": "投票する",
    "mode1": "#mode1",
    "mode1_link": "通常",
    "kind_link": "連複",
    "mode3": "#mode3",
    "mode3_link": "通常",
    "row": "#row{n}_{car}",
    "amount": "#textfield11",
    "set": "セット",
    "to_confirm": "投票手続へ",
    "buy": "購入する",
    "again": "続けて購入する",
    "clear": ["全て取消", "全取消", "すべて取消", "取消", "削除", "クリア"],
    "back": ["戻る", "修正する", "修正"],
}

WAIT_MS = 15000


class SkipRace(Exception):
    """このレースは買えない（場が無い・締切が近い・9車の欄が無い など）。ベットリストには何も積んでいない"""


class ConfirmMismatch(Exception):
    """確認画面の中身が買い目と合わない。押さずに止めた"""


class LoggedOut(Exception):
    """ログインが切れている。人に入り直してもらう"""


class BetUncertain(Exception):
    """「購入する」を押した後で転んだ。通ったか分からない"""


# ---------------------------------------------------------------- 画面の文字を読む（純関数。テストあり）

# 区切りは - = － ― ー ‐ → ・（前後の空白は可）。空白だけの区切りは数えない（車番のボタン「1 2 3 …」を拾うため）
TRIO = re.compile(r"(?<![\d.:／/])([1-9])\s*[-=－―ー‐→・]\s*([1-9])\s*[-=－―ー‐→・]\s*([1-9])(?![\d.:／/])")


def _norm(text):
    """全角数字・全角記号をそろえる"""
    t = str(text or "")
    t = t.translate(str.maketrans("０１２３４５６７８９：，＝－Ｒ", "0123456789:,=-R"))
    return re.sub(r"[ \t　]+", " ", t)


def tickets_in(text):
    """画面の中の三連複らしい組（昇順にそろえた "a=b=c"）の集合"""
    out = set()
    for m in TRIO.finditer(_norm(text)):
        cs = sorted({int(m.group(1)), int(m.group(2)), int(m.group(3))})
        if len(cs) == 3:
            out.add("=".join(map(str, cs)))
    return out


def check_confirm_text(text, place, rno, ticket, yen):
    """確認画面の文字を照合する。合わないところを並べて返す（空なら合っている）

    ★これが最後の砦。1レース1点ずつ買うので、確認画面の合計は必ず yen 円・1点のはず。
      ベットリストに前の買い残りが混ざっていれば、ここで気づいて止まる。
    """
    t = _norm(text)
    bad = []
    if place not in t:
        bad.append(f"場「{place}」が見当たらない")
    elif not re.search(rf"(?<!\d){rno}\s*R", t):
        bad.append(f"「{rno}R」が見当たらない")
    elif not re.search(rf"{re.escape(place)}[^\n]{{0,30}}?(?<!\d){rno}\s*R|(?<!\d){rno}\s*R[^\n]{{0,30}}?{re.escape(place)}", t):
        bad.append(f"「{place}」と「{rno}R」が同じ行に無い")
    if not re.search(r"(3|三)\s*連\s*複", t):
        bad.append("「3連複」が見当たらない")
    ts = tickets_in(t)
    if ticket not in ts:
        bad.append(f"組 {ticket} が見当たらない（読めた組: {', '.join(sorted(ts)) or 'なし'}）")
    elif len(ts) > 1:
        bad.append(f"組が複数ある（{', '.join(sorted(ts))}）。ベットリストに買い残りがあるかもしれない")
    m = re.search(r"合計[^\n]{0,30}?([\d,]+)\s*円", t)
    if not m:
        bad.append("合計金額が読めない")
    elif int(m.group(1).replace(",", "")) != yen:
        bad.append(f"合計金額が {m.group(1)}円（{yen}円のはず）")
    m = re.search(r"合計[^\n]{0,30}?([\d,]+)\s*(点|件|票)", t) or re.search(r"([\d,]+)\s*点", t)
    if m and int(m.group(1).replace(",", "")) != 1:
        bad.append(f"点数が {m.group(1)}（1点のはず）")
    return bad


def read_close(text, rno):
    """画面の文字から、そのレースの締切 "HH:MM" を読む。読めなければ None

    ★どこに出ているか未採取。「{R}R … 締切 HH:MM」→「締切 HH:MM」→「HH:MM 締切」の順に探す。
      違うレースの時刻を拾う恐れがあるので、使う側は「予定の締切（発走−5分）と早いほう」にする
      （遅い時刻を拾っても買いすぎにはならない）。
    """
    t = _norm(text)
    for pat in (rf"(?<!\d){rno}\s*R[^\n]{{0,40}}?締\s*切[^\d\n]{{0,8}}(\d{{1,2}}):(\d{{2}})",
                r"締\s*切[^\d\n]{0,8}(\d{1,2}):(\d{2})",
                r"(\d{1,2}):(\d{2})\s*締\s*切"):
        m = re.search(pat, t)
        if m:
            h, mi = int(m.group(1)), int(m.group(2))
            if 0 <= h <= 23 and 0 <= mi <= 59:
                return f"{h:02d}:{mi:02d}"
    return None


def looks_done(text):
    """「購入する」のあとの画面が、受け付けた画面に見えるか"""
    t = _norm(text)
    if re.search(r"(受付|受け付け)(ました|完了)|購入(が)?完了|投票(が)?完了|受付番号", t):
        return True
    return False


def looks_refused(text):
    """はっきり断られた画面か（締切・残高不足など）。断られても「押した」ことに変わりはない"""
    t = _norm(text)
    m = re.search(r"(締め?切(られ|りました|後)|発売(は)?終了|残高(が)?不足|購入限度|受付できません|エラー)[^\n]{0,40}", t)
    return m.group(0) if m else ""


# ---------------------------------------------------------------- 画面を触る

def _settle(page, ms=WAIT_MS):
    """通信が落ち着くまで待つ。読み込み中のクリックは吸われる"""
    try:
        page.wait_for_load_state("domcontentloaded", timeout=ms)
        page.wait_for_load_state("networkidle", timeout=5000)
    except Exception:
        pass


def body_text(page):
    try:
        return page.inner_text("body", timeout=5000)
    except Exception:
        return ""


def shot(page, shot_dir, name, html=False):
    """スクショ（と HTML）を残す。★HTML には残高やお名前が入ることがある。人に渡す前に確かめること"""
    if not shot_dir:
        return ""
    try:
        os.makedirs(shot_dir, exist_ok=True)
        base = os.path.join(shot_dir, now().strftime("%Y%m%d_%H%M%S_") + re.sub(r"[^\w\-]", "_", name))
        page.screenshot(path=base + ".png", full_page=True)
        if html:
            with open(base + ".html", "w", encoding="utf-8") as f:
                f.write(page.content())
        return base + ".png"
    except Exception:
        return ""


def open_top(page, url):
    page.goto(url)
    _settle(page)


def check_logged_in(page):
    """True=入っている / False=入っていない / None=分からない

    ★ログイン済みの目印は未採取。ID の欄が見えていれば「入っていない」、
      「ログアウト」の文字があれば「入っている」とみなす。
    """
    try:
        if page.locator(SELECTORS["login_id"]).first.is_visible(timeout=1500):
            return False
    except Exception:
        pass
    try:
        if page.get_by_text("ログアウト").first.is_visible(timeout=1500):
            return True
    except Exception:
        pass
    return None


def _find_vote_link(page, fallback_index):
    """トップの「投票する」の中から競輪のものを探す（採取は nth(2) だったが、開催数で順番が変わる）"""
    links = page.get_by_role("link", name=SELECTORS["vote_link"])
    n = links.count()
    if n == 0:
        raise RuntimeError("トップに「投票する」が見当たりません（ログインが切れた？）")
    scores = page.evaluate("""() => {
      const out = [];
      for (const a of document.querySelectorAll('a')) {
        if (!/投票する/.test(a.innerText || a.textContent || '')) continue;
        const r = a.getBoundingClientRect(); if (!r.width && !r.height) continue;
        const h = ((a.getAttribute('href') || '') + ' ' + (a.getAttribute('onclick') || '')).toLowerCase();
        let s = /keirin/.test(h) ? 2 : 0;
        let el = a.parentElement;
        for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
          const t = el.innerText || '';
          if (/競輪|KEIRIN/i.test(t) && !/競馬|オート|地方競馬/.test(t)) { s += 1; break; }
        }
        out.push(s);
      }
      return out;
    }""")
    best = max(scores) if scores else 0
    if best > 0 and scores.count(best) == 1 and len(scores) == n:
        return links.nth(scores.index(best)), "競輪の「投票する」"
    if fallback_index < n:
        return links.nth(fallback_index), f"{fallback_index + 1}番目の「投票する」（競輪のものか見分けられず、設定の vote_link_index を使った）"
    raise RuntimeError(f"競輪の「投票する」が見分けられません（{n}個）")


class Session:
    """トップ（ログインする窓）と投票の窓（ポップアップ）の組"""

    def __init__(self, context, page, cfg, log=None):
        self.context = context
        self.page = page
        self.cfg = cfg
        self.log = log
        self.vote = None
        self.shot_dir = cfg.path("shot_dir")

    def _say(self, msg):
        if self.log:
            self.log.event("見た", msg)

    # ---- 投票の窓 ----
    def vote_page(self):
        """投票の窓を返す。閉じられていたら開き直す"""
        if self.vote is not None and not self.vote.is_closed():
            return self.vote
        self.vote = None
        _settle(self.page)
        if check_logged_in(self.page) is False:
            raise LoggedOut("ログインが切れています")
        link, how = _find_vote_link(self.page, self.cfg.vote_link_index)
        with self.page.expect_popup(timeout=WAIT_MS) as info:
            link.click()
        self.vote = info.value
        _settle(self.vote)
        self._say(f"投票の窓を開きました（{how}）")
        return self.vote

    def close_vote(self):
        try:
            if self.vote is not None and not self.vote.is_closed():
                self.vote.close()
        except Exception:
            pass
        self.vote = None

    def keepalive(self):
        """買い目が無い間に、トップを読み直してログインを保つ。ログイン状態を返す"""
        try:
            self.page.reload()
            _settle(self.page)
        except Exception:
            pass
        return check_logged_in(self.page)

    # ---- 1レースを開く ----
    @staticmethod
    def _venue_link(vp, place):
        venue = vp.get_by_role("link", name=place, exact=True)
        if venue.count() == 0:
            cand = vp.get_by_role("link", name=place)
            return cand if cand.count() == 1 else None
        return venue

    def open_race(self, place, rno):
        vp = self.vote_page()
        venue = self._venue_link(vp, place)
        if venue is None:
            # 窓の中でログインが切れた・画面が古いだけかもしれない。1回だけ開き直して探す
            if vp.locator(SELECTORS["login_id"]).count():
                self.close_vote()
                raise LoggedOut("投票の窓がログイン画面になっている")
            self.close_vote()
            vp = self.vote_page()
            venue = self._venue_link(vp, place)
        if venue is None:
            raise SkipRace(f"投票の窓に場「{place}」が見当たらない（オッズパークで売っていない？）")
        venue.first.click()
        _settle(vp)
        race = self._race_link(vp, rno)
        if race is None:                     # 採取は dblclick だった。1回で出なければもう1回
            venue.first.click()
            _settle(vp)
            race = self._race_link(vp, rno)
        if race is None:
            raise SkipRace(f"{place}の「{rno}R」が見当たらない（発売していない？）")
        race.click()
        _settle(vp)
        t = body_text(vp)
        if place not in t or not re.search(rf"(?<!\d){rno}\s*R", _norm(t)):
            raise RuntimeError(f"{place}{rno}R を開いたはずが、画面に場名かレース番号が見当たらない")
        return vp, read_close(t, rno)

    @staticmethod
    def _race_link(vp, rno):
        for pat in (rf"^\s*{rno}\s*R\s*$", rf"^\s*{rno}\s*R(\s|$)"):
            loc = vp.get_by_role("link", name=re.compile(pat))
            n = loc.count()
            if n == 1:
                return loc.first
            if n > 1:
                visible = [loc.nth(i) for i in range(n) if loc.nth(i).is_visible()]
                if len(visible) == 1:
                    return visible[0]
        return None

    # ---- 買い目を入れて確認画面へ ----
    def fill_ticket(self, vp, ticket, yen):
        cars = [int(x) for x in ticket.split("=")]
        if len(cars) != 3 or cars != sorted(set(cars)):
            raise ValueError(f"買い目が変です: {ticket}")
        vp.locator(SELECTORS["mode1"]).get_by_role("link", name=SELECTORS["mode1_link"]).first.click()
        kind = vp.get_by_role("link", name=SELECTORS["kind_link"])
        if kind.count() > 1:
            exact = vp.get_by_role("link", name=re.compile(r"^\s*(3|三)?\s*連複\s*$"))
            kind = exact if exact.count() == 1 else kind
        if kind.count() != 1:
            raise RuntimeError(f"「{SELECTORS['kind_link']}」のリンクが {kind.count()}個（1個のはず）")
        kind.first.click()
        _settle(vp)
        vp.locator(SELECTORS["mode3"]).get_by_role("link", name=SELECTORS["mode3_link"]).first.click()
        _settle(vp)
        for n, car in enumerate(cars, 1):          # 押す前に欄が揃っているか見る（9車の #row*_9 は未採取。まだ何も積んでいない）
            if vp.locator(SELECTORS["row"].format(n=n, car=car)).count() == 0:
                raise SkipRace(f"{SELECTORS['row'].format(n=n, car=car)} が画面に無い（{car}番の欄が未採取）")
        for n, car in enumerate(cars, 1):
            vp.locator(SELECTORS["row"].format(n=n, car=car)).get_by_role("link", name=str(car), exact=True).first.click()
        box = vp.locator(SELECTORS["amount"])
        if box.count() != 1:
            raise RuntimeError(f"金額の欄 {SELECTORS['amount']} が {box.count()}個（1個のはず）")
        units = str(yen // 100)                   # 100円単位（採取は「1」）
        box.click()
        box.fill(units)
        if box.input_value().strip() != units:
            raise RuntimeError(f"金額の欄に {units} が入らない（{box.input_value()!r}）")
        vp.get_by_role("link", name=SELECTORS["set"], exact=True).first.click()
        _settle(vp)
        vp.get_by_role("link", name=SELECTORS["to_confirm"]).first.click()
        _settle(vp)
        return body_text(vp)

    def _click_any(self, vp, names):
        for name in names:
            for role in ("link", "button"):
                loc = vp.get_by_role(role, name=name, exact=True)
                try:
                    if loc.count() and loc.first.is_visible():
                        loc.first.click()
                        _settle(vp)
                        return name
                except Exception:
                    continue
        return ""

    def clear_slip(self):
        """確認画面・ベットリストに積んだ買い目を消す。True=消した / False=消せなかった

        ★消し方は未採取。「戻る」系で入力画面に戻り、「取消」系を押してみる。
          消せたかは、画面に組が残っていないかで見る。
        """
        vp = self.vote
        if vp is None or vp.is_closed():
            return True                       # 窓ごと無い → 積んだものも見えない。次は開き直す
        self._click_any(vp, SELECTORS["back"])
        if self._click_any(vp, SELECTORS["clear"]):
            self._click_any(vp, ["OK", "はい"])
        left = tickets_in(body_text(vp))
        if not left:
            return True
        # 消せない → 窓を閉じる。次は開き直す（ベットリストがサーバ側に残るかは未確認）
        self.close_vote()
        return False

    # ---- 購入 ----
    def press_buy(self, vp):
        """「購入する」を押して、受け付けたかを返す。ここから先の例外はすべて BetUncertain"""
        try:
            vp.get_by_role("link", name=SELECTORS["buy"], exact=True).first.click()
        except Exception as e:
            raise BetUncertain(f"「購入する」を押す途中で失敗: {type(e).__name__}: {e}")
        try:
            _settle(vp)
            time.sleep(1)
            t = body_text(vp)
            again = vp.get_by_role("link", name=SELECTORS["again"])
            done = looks_done(t) or (again.count() > 0 and again.first.is_visible())
            png = shot(vp, self.shot_dir, "after_buy", html=True)
        except Exception as e:
            raise BetUncertain(f"押した後の画面が読めない: {type(e).__name__}: {e}")
        if not done:
            why = looks_refused(t)
            raise BetUncertain(("断られたようです: " + why) if why else "受け付けた画面か確かめられない" + (f"（{png}）" if png else ""))
        try:
            if again.count() and again.first.is_visible():
                again.first.click()
                _settle(vp)
        except Exception:
            pass                                  # 受け付けは済んでいる。次の周で窓を見直す
        return png


def bet(session, b, live, guard, before_press):
    """1レースぶん。dry は確認画面で止める

    guard(site_close)   : 締切を見て、買えなければ SkipRace を投げる（押す直前にもう一度呼ぶ）
    before_press()      : live で押す直前に呼ぶ。bet_done.json に書く。書けなければ例外（押さない）
    返すのは 記録に残す説明
    """
    shot_dir = session.shot_dir
    vp, site_close = session.open_race(b.place, b.rno)
    guard(site_close)
    text = session.fill_ticket(vp, b.ticket, b.yen)
    png = shot(vp, shot_dir, f"{b.key}_confirm", html=not live)
    bad = check_confirm_text(text, b.place, b.rno, b.ticket, b.yen)
    if bad:
        raise ConfirmMismatch("確認画面が買い目と合わない: " + " / ".join(bad) + (f"（{png}）" if png else ""))
    close_note = f"サイトの締切 {site_close}" if site_close else "サイトの締切は読めず"
    if not live:
        return f"確認画面まで（押していません）。{close_note}。{png}"
    guard(site_close)                     # 選んでから押すまでに時間が経っている
    before_press()
    png2 = session.press_buy(vp)
    return f"購入済み。{close_note}。{png2}"
