#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""oddspark_page.py -- オッズパークの画面操作。サイトの作りが変わったら、ここだけ直す

★ログインID・パスワード・暗証番号は扱わない。ログインは開いた Chrome で人が手で入れる。

使う画面は「レースまとめ投票」（2026-09-26 に利用者が記録モードで採った実物の操作から作った）:

  トップ「投票する」(a.btn_vote, href=/keirin/auth/VoteKeirinTop.do…) → ★別ウィンドウが開く
  → いったん「Loading」→ 場を選ぶ画面（場の名前は画像で、文字が無い）
  → 「レースまとめ投票」(a#todayMultiRace) → まとめ投票の画面:
      セット金額      input#textfield11（100円単位。「1」で100円）
      車番            table#shaArea の td[name=keirin1|2|3] > a（1着・2着・3着の列。押すと a.on）
                      三連複フォーメーションで 1列に1車ずつ → 1通り（買い目一覧では昇順 "3-4-7"）
      レース          table#raceArea の input[type=checkbox][value="YYYYMMDD_場コード_R"]
                      （締め切ったレースはチェック欄が無い。場コードは ul#course の li[value]）
      賭式            input#sanrenpuku（name=betTypeSelect。ほかは外す）
      支払い方法      input#paymentMethodBuyLimit（投票資金）/ input#paymentMethodOpCoin（OPコイン）
      セット          a#multiSet → div#buylist の tr[id^=kaime]、td#sumBetCount「組数：1通り」td#sumPay「合計金額：100円」
      全買い目削除    li#all > a
      投票手続へ      a#gotobuy
  → 投票申込確認（VoteConfirm.do / VoteConfirmOpcoin.do）:
      div#section2 の表 [開催日, 開催場, R, 賭式, 投票方式, 買い目, 金額]、組数「1通り」、合計金額 td#voteInfoTotalAmount
      投票を申込 a#buy（★買い目一覧の table#buy と id がかぶる。必ず a#buy）/ 戻る ul#confirmS a
  → 投票申込完了: 「投票申込を受け付けました。」、表の最後の列「受付」が ○、続けて購入する a#buythru

★締切の時刻はこの画面に出ない。レースのチェック欄があれば「発売中」とみなす（ON_SALE）。
  時刻は発走−5分（betplan.js）を使う。
"""
import os
import re
import time

from jst import now

SEL = {
    "login_id": 'input[name="SSO_ACCOUNTID"]',   # あれば「ログインしていない」の印に使うだけ。入力はしない
    "password": 'input[type="password"]',        # 投票の窓の「本人確認」。★入力はしない（人が手で入れる）
    "vote_link": "投票する",
    "multi_race": "#todayMultiRace",
    "course": "#course",
    "course_li": "#course li",
    "matome_tab": '#course li[value="00"] a',
    "race_area": "#raceArea",
    "race_box": '#raceArea input[type="checkbox"][value="{date}_{jcd}_{rno}"]',
    "race_checked": "#raceArea input[type=checkbox]:checked",
    "sha_cell": '#shaArea td[name="keirin{col}"] a',
    "sha_on": "#shaArea a.on",
    "sha_reset": "#reset",
    "bet_types": '#betTypeArea input[name="betTypeSelect"]',
    "sanrenpuku": "#sanrenpuku",
    "amount": "#textfield11",
    "pay_cash": "#paymentMethodBuyLimit",
    "pay_opcoin": "#paymentMethodOpCoin",
    "set": "#multiSet",
    "slip_rows": "#buylist tr[id^=kaime]",
    "slip_all_delete": "#all a",
    "sum_count": "#sumBetCount",
    "sum_pay": "#sumPay",
    "to_confirm": "#gotobuy",
    "confirm_rows": "#section2 table tr",
    "buy": "a#buy",
    "back": "#confirmS a",
    "again": "#buythru",
}

ON_SALE = "発売中"
AUTH_WAIT = 300           # 本人確認（パスワードの入れ直し）を人が済ませるのを待つ秒数          # 締切の時刻は出ないが、チェック欄があって発売中と確かめた、の印
WAIT_MS = 15000
READY_MS = 30000


class SkipRace(Exception):
    """このレースは買えない（売っていない・締め切った・車立てが違う など）。買い目一覧には何も積んでいない"""


class ConfirmMismatch(Exception):
    """買い目一覧・確認画面の中身が買い目と合わない。押さずに止めた"""


class LoggedOut(Exception):
    """ログインが切れている。人に入り直してもらう"""


class BetUncertain(Exception):
    """「投票を申込」を押した後で転んだ。通ったか分からない"""


# ---------------------------------------------------------------- 読んだ文字の照合（純関数。テストあり）

def _norm(text):
    """全角をそろえ、空白を消す（「岐 阜」→「岐阜」）"""
    t = str(text or "").translate(str.maketrans("０１２３４５６７８９：，＝－", "0123456789:,=-"))
    return re.sub(r"[\s　]+", "", t)


def _ticket_of(text):
    """"3-4-7" や "3連複フ3-4-7" から昇順の "3=4=7"。読めなければ None"""
    m = re.search(r"(?<!\d)([1-9])[-=]([1-9])[-=]([1-9])(?!\d)", _norm(text))
    if not m:
        return None
    cs = sorted({int(x) for x in m.groups()})
    return "=".join(map(str, cs)) if len(cs) == 3 else None


def _yen_of(text):
    m = re.search(r"([\d,]+)円", _norm(text))
    return int(m.group(1).replace(",", "")) if m else None


def check_slip(rows, sum_count, sum_pay, place, rno, ticket, units, yen):
    """セットした後の買い目一覧を照合する。rows = 各行のセルの文字のリスト"""
    bad = []
    if len(rows) != 1:
        bad.append(f"買い目一覧が {len(rows)}行（1行のはず）")
    else:
        cells = [_norm(c) for c in rows[0]]
        joined = "|".join(cells)
        if not any(c.endswith(place) or c == place for c in cells):
            bad.append(f"場「{place}」が見当たらない（{joined}）")
        if str(rno) not in cells:
            bad.append(f"R「{rno}」が見当たらない（{joined}）")
        if "3連複" not in joined:
            bad.append(f"「3連複」が見当たらない（{joined}）")
        tk = next((t for t in map(_ticket_of, cells) if t), None)
        if tk != ticket:
            bad.append(f"買い目が {tk}（{ticket} のはず）")
    if not re.search(r"(?<!\d)1通り", _norm(sum_count)):
        bad.append(f"組数が「{sum_count}」（1通りのはず）")
    if _yen_of(sum_pay) != yen:
        bad.append(f"合計金額が「{sum_pay}」（{yen}円のはず）")
    return bad


def check_confirm(rows, page_text, place, rno, ticket, yen):
    """投票申込確認の表を照合する。rows = [開催日, 開催場, R, 賭式, 投票方式, 買い目, 金額] の行（見出しは除く）

    ★これが最後の砦。1レース1点ずつ買うので、表は必ず1行・合計は yen 円・1通りのはず。
    """
    bad = []
    if len(rows) != 1:
        bad.append(f"確認画面の表が {len(rows)}行（1行のはず）")
    else:
        c = [_norm(x) for x in rows[0]] + [""] * 7
        if c[1] != place:
            bad.append(f"開催場が「{c[1]}」（{place} のはず）")
        if c[2] != str(rno):
            bad.append(f"R が「{c[2]}」（{rno} のはず）")
        if c[3] != "3連複":
            bad.append(f"賭式が「{c[3]}」（3連複のはず）")
        if _ticket_of(c[5]) != ticket:
            bad.append(f"買い目が「{c[5]}」（{ticket.replace('=', '-')} のはず）")
        if _yen_of(c[6]) != yen:
            bad.append(f"金額が「{c[6]}」（{yen}円のはず）")
    t = _norm(page_text)
    m = re.search(r"合計金額[^\d]{0,10}([\d,]+)円", t)
    if not m:
        bad.append("合計金額が読めない")
    elif int(m.group(1).replace(",", "")) != yen:
        bad.append(f"合計金額が {m.group(1)}円（{yen}円のはず）")
    m = re.search(r"組数[^\d]{0,10}([\d,]+)通り", t)
    if m and m.group(1) != "1":
        bad.append(f"組数が {m.group(1)}通り（1通りのはず）")
    return bad


def check_done(rows, page_text, place, rno, ticket):
    """投票申込完了の画面。受け付けたら ""、そうでなければ理由"""
    t = _norm(page_text)
    if not re.search(r"受け?付けました", t):
        return "「受け付けました」が無い"
    for r in rows:
        c = [_norm(x) for x in r]
        if len(c) >= 8 and c[1] == place and c[2] == str(rno) and _ticket_of(c[5]) == ticket:
            return "" if c[7] == "○" else f"受付が「{c[7]}」"
    return "完了画面の表にこのレースが無い"


def is_delete_only(message):
    """買い目を消すだけの確認か（OK を押しても買う方向には進まない）"""
    t = _norm(message)
    return "削除" in t and not re.search(r"購入|申込|投票する|投票します|支払", t)


def looks_refused(text):
    """はっきり断られた画面か（締切・残高不足など）"""
    t = _norm(text)
    m = re.search(r"(締め?切(られ|りました|後)|発売(は)?終了|残高(が)?不足|入金が必要|チャージが必要|購入限度|上限額に達|受付できません|エラー)[^\n]{0,30}", t)
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


# 画面の HTML を、入力欄の中身を消してから取り出す（ID・暗証番号・隠し欄のトークンを残さない）
SAFE_HTML_JS = """() => {
  const c = document.documentElement.cloneNode(true);
  const keep = ['button', 'submit', 'reset', 'radio', 'checkbox', 'image'];
  c.querySelectorAll('input').forEach((e) => { if (!keep.includes((e.getAttribute('type') || 'text').toLowerCase())) e.removeAttribute('value'); });
  c.querySelectorAll('textarea').forEach((e) => { e.textContent = ''; });
  c.querySelectorAll('script').forEach((e) => { e.textContent = '/* 省略 */'; });
  return '<!doctype html>\\n' + c.outerHTML;
}"""


def safe_html(page_or_frame):
    try:
        return page_or_frame.evaluate(SAFE_HTML_JS)
    except Exception as e:
        return f"<!-- 取れず: {e} -->"


def shot(page, shot_dir, name, html=False):
    """スクショ（と HTML）を残す。★残高やお名前が写ることがある。人に渡す前に確かめること"""
    if not shot_dir:
        return ""
    try:
        os.makedirs(shot_dir, exist_ok=True)
        base = os.path.join(shot_dir, now().strftime("%Y%m%d_%H%M%S_") + re.sub(r"[^\w\-]", "_", name))
        page.screenshot(path=base + ".png", full_page=True)
        if html:
            with open(base + ".html", "w", encoding="utf-8") as f:
                f.write(safe_html(page))
        return base + ".png"
    except Exception:
        return ""


def _rows(page, selector):
    """表の行ごとのセルの文字。見出し（th だけの行）は除く"""
    return page.eval_on_selector_all(selector, """rs => rs
        .map(r => [...r.querySelectorAll('td')].map(td => td.innerText))
        .filter(cs => cs.length > 0)""")


def open_top(page, url):
    page.goto(url)
    _settle(page)


def check_logged_in(page):
    """True=入っている / False=入っていない / None=分からない

    ID の欄が見えていれば「入っていない」、「ログアウト」の文字があれば「入っている」とみなす。
    """
    try:
        if page.locator(SEL["login_id"]).first.is_visible(timeout=1500):
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
    """トップの「投票する」の中から競輪のもの（href に /keirin/ ）を探す"""
    links = page.get_by_role("link", name=SEL["vote_link"])
    n = links.count()
    if n == 0:
        raise LoggedOut("トップに「投票する」が見当たりません（ログインが切れた？）")
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
        self.pay = getattr(cfg, "payment_method", "opcoin")
        self.dialogs = []          # サイトが出した小窓（alert / confirm）の文面
        self.accept_next = False   # 次の小窓を OK にするか（全買い目削除のときだけ）

    def _say(self, msg):
        if self.log:
            self.log.event("見た", msg)

    def _on_dialog(self, d):
        """サイトの小窓。文面を残す。買い目を消すだけの確認は OK、ほかはキャンセル（買う方向には押さない）

        例（実物 2026-09-26）:「レースまとめ投票へ遷移すると、現在の買い目は削除されます。よろしいですか？」→ OK
        """
        ok = self.accept_next or is_delete_only(d.message)
        self.accept_next = False
        self.dialogs.append(d.message)
        self._say(f"サイトの小窓「{d.message[:80]}」→ {'OK' if ok else 'キャンセル'}")
        try:
            d.accept() if ok else d.dismiss()
        except Exception:
            pass

    def _dialogs_since(self, n):
        new = self.dialogs[n:]
        return f"（サイトの小窓: {' / '.join(m[:60] for m in new)}）" if new else ""

    def _wait_auth(self, vp):
        """投票の窓の「本人確認」（パスワードの入れ直し）。★このプログラムは入れない。人が済ませるのを待つ"""
        msg = "★投票の窓で「本人確認」（パスワード）を聞かれています。Chrome の画面で手で入れて「確認」を押してください（このプログラムは入れません）"
        if self.log:
            self.log.event("待っています", msg)
        else:
            print(msg, flush=True)
        end = time.time() + AUTH_WAIT
        while time.time() < end:
            vp.wait_for_timeout(2000)
            if vp.is_closed():
                raise LoggedOut("本人確認の途中で投票の窓が閉じられた")
            if not self._visible(vp, "password"):
                self._say("本人確認が済みました")
                _settle(vp)
                return
        raise LoggedOut(f"本人確認が{AUTH_WAIT // 60}分待っても済まない")

    # ---- 投票の窓 ----
    def vote_page(self):
        """まとめ投票の画面になった投票の窓を返す。閉じられていたら開き直す"""
        if self.vote is None or self.vote.is_closed():
            self.vote = None
            _settle(self.page)
            if check_logged_in(self.page) is False:
                raise LoggedOut("ログインが切れています")
            link, how = _find_vote_link(self.page, self.cfg.vote_link_index)
            with self.page.expect_popup(timeout=WAIT_MS) as info:
                link.click()
            self.vote = info.value
            self.vote.on("dialog", self._on_dialog)
            self._say(f"投票の窓を開きました（{how}）")
        self._to_matome(self.vote)
        return self.vote

    def _to_matome(self, vp):
        """「レースまとめ投票」の画面にする。開いた直後は「Loading」を挟むので、部品が見えるまで待つ

        ★wait_for_selector に「A, B, C」とまとめて渡すと、ページの中で最初に当たった要素（隠れた要素のこともある）
          だけを待ってしまう。見えているかを1つずつ自分で見る
        """
        clicks = 0
        end = time.time() + READY_MS / 1000 * 2
        while time.time() < end:
            if vp.is_closed():
                raise RuntimeError("投票の窓が閉じられた")
            if vp.locator(SEL["login_id"]).count() and self._visible(vp, "login_id"):
                self.close_vote()
                raise LoggedOut("投票の窓がログイン画面になっている")
            if self._visible(vp, "password"):
                self._wait_auth(vp)
                end = time.time() + READY_MS / 1000
                continue
            if self._visible(vp, "race_area") and self._visible(vp, "amount"):
                _settle(vp)
                return
            for key in ("multi_race", "matome_tab"):
                if clicks < 3 and self._visible(vp, key):
                    vp.locator(SEL[key]).first.click()
                    clicks += 1
                    _settle(vp)
                    break
            vp.wait_for_timeout(500)
        png = shot(vp, self.shot_dir, "matome_missing", html=True)
        raise RuntimeError("「レースまとめ投票」の画面を開けない" + (f"（{png}）" if png else ""))

    @staticmethod
    def _visible(vp, key):
        loc = vp.locator(SEL[key])
        try:
            return loc.count() > 0 and loc.first.is_visible()
        except Exception:
            return False

    def close_vote(self):
        try:
            if self.vote is not None and not self.vote.is_closed():
                self.vote.close()
        except Exception:
            pass
        self.vote = None

    def keepalive(self):
        """買うものが無い間に、トップを読み直してログインを保つ。ログイン状態を返す"""
        try:
            self.page.reload()
            _settle(self.page)
        except Exception:
            pass
        return check_logged_in(self.page)

    # ---- 1レース ----
    def _reload_matome(self, vp):
        """締め切ったレースを消すため、まとめ投票のタブを押し直す（タブが無ければそのまま）"""
        tab = vp.locator(SEL["matome_tab"])
        if tab.count() and tab.first.is_visible():
            tab.first.click()
            _settle(vp)
            self._to_matome(vp)

    def course_code(self, vp, place):
        """ul#course の li から場コード。無ければ None / 発売が無ければ ""（inactive）"""
        items = vp.eval_on_selector_all(SEL["course_li"], "ls => ls.map(l => [l.getAttribute('value') || '', l.innerText])")
        for value, name in items:
            if _norm(name) == place:
                return value
        return None

    def open_race(self, b):
        vp = self.vote_page()
        self._reload_matome(vp)
        jcd = self.course_code(vp, b.place)
        if jcd is None:
            raise SkipRace(f"オッズパークの場の一覧に「{b.place}」が無い（今日は売っていない？）")
        if not jcd:
            raise SkipRace(f"{b.place}は発売が終わっている")
        box = vp.locator(SEL["race_box"].format(date=b.date, jcd=jcd, rno=b.rno))
        if box.count() != 1:
            raise SkipRace(f"{b.place}{b.rno}R のチェック欄が無い（締め切った・発売していない）")
        cars = box.evaluate("""el => {
          const td = el.closest('td'), tr = td.parentElement, next = tr.nextElementSibling;
          const i = [...tr.children].indexOf(td) - 1;        // 次の行は場の欄（rowspan）が無いぶん1つずれる
          const c = next && next.children[i];
          const m = c && c.innerText.match(/(\\d+)/);
          return m ? parseInt(m[1], 10) : null;
        }""")
        if cars is not None and b.cars and cars != b.cars:
            raise SkipRace(f"{b.place}{b.rno}R はオッズパークでは{cars}車立て（予想は{b.cars}車）。別のレースの恐れがあるので見送り")
        return vp, jcd

    def clear_slip(self):
        """買い目一覧を空にする。True=空になった / False=残っている"""
        vp = self.vote
        if vp is None or vp.is_closed():
            return True
        try:
            back = vp.locator(SEL["back"])
            if vp.locator(SEL["buy"]).count() and back.count():     # 確認画面にいる → 戻る
                back.first.click()
                _settle(vp)
                vp.wait_for_timeout(1000)
            # ★戻ると「場を選ぶ画面」に出る（実物 2026-09-26）。買い目一覧と「全買い目削除」はそこにもあるので、
            #   まとめ投票へ移る前に消す（残したまま移ると「買い目は削除されます」の小窓が出る）
            for _ in range(2):
                if vp.locator(SEL["slip_rows"]).count() == 0:
                    break
                self.accept_next = True                              # 「削除しますか？」が出たら OK（削除なので安全）
                try:
                    vp.locator(SEL["slip_all_delete"]).first.click()
                    _settle(vp)
                    vp.wait_for_timeout(700)
                finally:
                    self.accept_next = False                         # ★小窓が出なくても、次の小窓（申込など）に持ち越さない
            self._to_matome(vp)
            return vp.locator(SEL["slip_rows"]).count() == 0
        except Exception:
            return False

    def _reset_inputs(self, vp):
        """前の選択を消す（車番・レース・賭式）"""
        if vp.locator(SEL["sha_on"]).count():
            vp.locator(SEL["sha_reset"]).first.click()
            vp.wait_for_timeout(300)
            for a in vp.locator(SEL["sha_on"]).all():             # リセットで消えなければ1つずつ
                a.click()
        for cb in vp.locator(SEL["race_checked"]).all():
            cb.uncheck()
        for cb in vp.locator(SEL["bet_types"]).all():
            want = cb.get_attribute("id") == SEL["sanrenpuku"].lstrip("#")
            if cb.is_checked() != want:
                cb.set_checked(want)
        if vp.locator(SEL["sha_on"]).count() or vp.locator(SEL["race_checked"]).count():
            raise RuntimeError("前の選択が消えない")

    def fill_ticket(self, vp, b, jcd):
        """買い目を入れてセットし、買い目一覧を照合してから確認画面へ。確認画面の (表, 文字) を返す"""
        cars = [int(x) for x in b.ticket.split("=")]
        if len(cars) != 3 or cars != sorted(set(cars)) or cars[-1] > (b.cars or 9):
            raise ValueError(f"買い目が変です: {b.ticket}")
        units = str(b.yen // 100)
        if not self.clear_slip():
            raise RuntimeError("買い目一覧に前の残りがあって消せない")
        self._reset_inputs(vp)
        box = vp.locator(SEL["amount"])
        # ★fill() だと一度に入るだけで、キーを押した合図が出ない。サイトがそれで金額を拾うことがある
        #   （2026-09-26 の dry で、画面には「1」が入っているのにセットしても買い目一覧が空だった）。人と同じく1文字ずつ打つ
        box.click()
        box.press("Control+a")
        box.press("Delete")
        box.press_sequentially(units, delay=80)
        box.press("Tab")
        if box.input_value().strip() != units:
            raise RuntimeError(f"セット金額の欄に {units} が入らない（{box.input_value()!r}）")
        for col, car in enumerate(cars, 1):
            cell = vp.locator(SEL["sha_cell"].format(col=col)).filter(has_text=re.compile(rf"^\s*{car}\s*$"))
            if cell.count() != 1:
                raise RuntimeError(f"{col}列目の車番 {car} が {cell.count()}個（1個のはず）")
            cell.first.click()
            if "on" not in (cell.first.get_attribute("class") or "").split():
                raise RuntimeError(f"{col}列目の車番 {car} が選ばれない")
        if vp.locator(SEL["sha_on"]).count() != 3:
            raise RuntimeError(f"選ばれた車番が {vp.locator(SEL['sha_on']).count()}個（3個のはず）")
        race = vp.locator(SEL["race_box"].format(date=b.date, jcd=jcd, rno=b.rno))
        race.check()
        if vp.locator(SEL["race_checked"]).count() != 1 or not race.is_checked():
            raise RuntimeError("レースのチェックが1つにならない")
        pay = vp.locator(SEL["pay_opcoin"] if self.pay == "opcoin" else SEL["pay_cash"])
        pay.check()
        if not pay.is_checked():
            raise RuntimeError("支払い方法を選べない")
        n0 = len(self.dialogs)
        vp.locator(SEL["set"]).click()
        _settle(vp)
        for _ in range(10):                                   # 買い目一覧に出るまで最大5秒
            if vp.locator(SEL["slip_rows"]).count():
                break
            vp.wait_for_timeout(500)
        vp.wait_for_timeout(300)
        rows = _rows(vp, SEL["slip_rows"])
        sc = vp.locator(SEL["sum_count"]).inner_text() if vp.locator(SEL["sum_count"]).count() else ""
        sp = vp.locator(SEL["sum_pay"]).inner_text() if vp.locator(SEL["sum_pay"]).count() else ""
        bad = check_slip(rows, sc, sp, b.place, b.rno, b.ticket, units, b.yen)
        if bad:
            png = shot(vp, self.shot_dir, f"{b.key}_slip", html=True)
            raise ConfirmMismatch("買い目一覧が合わない: " + " / ".join(bad) + self._dialogs_since(n0) + (f"（{png}）" if png else ""))
        n0 = len(self.dialogs)
        vp.locator(SEL["to_confirm"]).click()
        try:
            vp.wait_for_selector(SEL["buy"], timeout=READY_MS)
        except Exception:
            why = looks_refused(body_text(vp))
            png = shot(vp, self.shot_dir, f"{b.key}_no_confirm", html=True)
            raise RuntimeError("確認画面にならない" + (f"（{why}）" if why else "") + self._dialogs_since(n0) + (f"（{png}）" if png else ""))
        _settle(vp)
        return _rows(vp, SEL["confirm_rows"]), body_text(vp)

    # ---- 申込 ----
    def press_buy(self, vp, b):
        """「投票を申込」を押して、受け付けたかを確かめる。ここから先の例外はすべて BetUncertain"""
        try:
            vp.locator(SEL["buy"]).click()
        except Exception as e:
            raise BetUncertain(f"「投票を申込」を押す途中で失敗: {type(e).__name__}: {e}")
        try:
            try:
                vp.wait_for_selector(SEL["again"], timeout=READY_MS)
            except Exception:
                pass
            _settle(vp)
            t = body_text(vp)
            why = check_done(_rows(vp, SEL["confirm_rows"]), t, b.place, b.rno, b.ticket)
            png = shot(vp, self.shot_dir, f"{b.key}_done", html=True)
        except Exception as e:
            raise BetUncertain(f"押した後の画面が読めない: {type(e).__name__}: {e}")
        if why:
            refused = looks_refused(t)
            raise BetUncertain(why + (f"（{refused}）" if refused else "") + (f"（{png}）" if png else ""))
        try:
            vp.locator(SEL["again"]).first.click()           # 続けて購入する
            _settle(vp)
        except Exception:
            pass                                           # 受け付けは済んでいる。次は窓を見直す
        return png


def bet(session, b, live, guard, before_press):
    """1レースぶん。dry は確認画面で止める

    guard(site_close)   : 締切を見て、買えなければ SkipRace を投げる（押す直前にもう一度呼ぶ）
    before_press()      : live で押す直前に呼ぶ。bet_done.json に書く。書けなければ例外（押さない）
    返すのは 記録に残す説明
    """
    vp, jcd = session.open_race(b)
    guard(ON_SALE)
    rows, text = session.fill_ticket(vp, b, jcd)
    png = shot(vp, session.shot_dir, f"{b.key}_confirm", html=not live)
    bad = check_confirm(rows, text, b.place, b.rno, b.ticket, b.yen)
    if bad:
        raise ConfirmMismatch("確認画面が買い目と合わない: " + " / ".join(bad) + (f"（{png}）" if png else ""))
    pay = "OPコイン" if session.pay == "opcoin" else "投票資金"
    if not live:
        return f"確認画面まで（押していません・{pay}）。{png}"
    guard(ON_SALE)                        # 選んでから押すまでに時間が経っている
    before_press()
    png2 = session.press_buy(vp, b)
    return f"購入済み（{pay}）。{png2}"
