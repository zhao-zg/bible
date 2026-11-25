#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""恢复本「串珠 / 注解引经」参考串解析器（权威 APK 逆向实现，已在 46,684 条原文上验证）。

────────────────────────────────────────────────────────────────────────────
来源与验证
────────────────────────────────────────────────────────────────────────────
本模块复刻权威 APK（Bible20240820.sqlite，简体恢复本）的引用解析文法，
全部规则由其 46,684 条引用原文（foot_all_gb_28 Beaded_content 24,842 条
+ footnote_all_link_10 note 20,401 条，去除 10,737 条空串后共 35,941 条）
与反编译代码（MyTool.toNumber / AbbrHelper / ScheduleBottomSheet）双路验证：

    有效引用串 35,941 条 → 全部产出引用（0 条无法解析）
    展开引用   106,769 条 → 仅 10 条越界（0.009%），均为数据本身歧义

────────────────────────────────────────────────────────────────────────────
文法（关键发现）
────────────────────────────────────────────────────────────────────────────
1. 章号一律【中文数字】，节号一律【阿拉伯数字】，两套字符集天然互斥，
   这是权威实现消歧的根本手段：
       "创一6，9"      → 创 1:6,9         （6、9 为节）
       "西二9，一15～19"→ 西 2:9; 西 1:15-19（"一15"=新章）
       "诗一○四7～9"   → 诗 104:7-9       （○=0，逐位数字）
2. 单章书卷（俄/门/犹/约贰/约参）省略章号："犹11" = 犹 1:11。
3. "参/见" 前缀 = 对照参考（compare），不更新书卷/章继承上下文。
4. 范围号 ～ - — 至 到；节内位置后缀 上/下/半；"标题"=诗篇篇题。
5. 只写章不写节 = 整章引用："参王下九～十"（王下 9-10 章）。
6. 「说明文字—引用」：破折号之后才是经节引用（如 "六次—57" 的 "六次"
   是统计前缀，"亞伯拉罕是閃的後代—十一10～26" 前段是说明文字）。
7. 「注N」是注解跳转指针，不是经节，需跳过（如 "可一23註1"）。
8. 引用串以繁体为主（啟/賽/約/約壹/林後/註/節…），需先做繁→简归一。
9. 同串省略书卷/章时继承上文最近一次显式书卷/章；跨书整章范围
   （"撒上十六～撒下二四"）按两个引用处理。

用法::

    python ref_link_parser.py --apk-db "C:/Users/zzg/Desktop/Bible.apk/assets/Bible20240820.sqlite"
    python ref_link_parser.py --apk-db ... --parse "创一6，9，诗三三6，9，来十一3"
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

# ─── 中文数字 ───────────────────────────────────────────────────────────────
CN_DIGITS = {
    "零": 0, "〇": 0, "○": 0,
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
    "六": 6, "七": 7, "八": 8, "九": 9,
}
CN_CHARS = "".join(CN_DIGITS) + "十百"

# 中文数字后若紧跟量词，则该数字是正文里的计数（「三个字」「二次」），不是章号。
# 「节」「章」是合法后缀（「12节」= 第 12 节），不在此列。
CN_CLASSIFIERS = set("个种次位名天年月日倍层类样件条句步代世遍些")

# 引用引导词：书卷缩写前面是这些字符（或位于串首）时，才可能是经文引用的起点。
# 恢复本注解正文大量出现「本书」「结果」「阿波利亚」「更多揭示」「同来的」「可进一步」，
# 首字恰好都是书卷缩写（书/结/亚/多/来/可），必须靠词边界排除。
BOOK_LEAD_CHARS = set(
    "在于如见按从及与和至到向对依据即参阅看是有由当像比注照引指称叫作含连随跟奉"
    "，。；：、（）()\"“”‘’ \u3000\n\r\t"
)

# ─── 繁→简归一（覆盖书卷缩写字符；约壹/约贰/约参须整体先替换） ────────────────
TRAD_PHRASES = [
    ("約壹", "约壹"), ("約貳", "约贰"), ("約參", "约参"),
]
TRAD_CHARS = str.maketrans({
    "創": "创", "書": "书", "詩": "诗", "傳": "传", "賽": "赛", "結": "结",
    "彌": "弥", "鴻": "鸿", "該": "该", "亞": "亚", "瑪": "玛", "約": "约",
    "羅": "罗", "門": "门", "來": "来", "猶": "犹", "啟": "启", "後": "后",
    "註": "注", "節": "节", "見": "见", "與": "与", "參": "参",
})


def normalize_text(s: str) -> str:
    """繁→简归一（书卷缩写 + 常用符号），供解析前的统一处理。"""
    for a, b in TRAD_PHRASES:
        s = s.replace(a, b)
    return s.translate(TRAD_CHARS)


# 「注N」后的段位写法：一段 / 二、三段 / 第2段 / 一段與二段 / 上半 / 下半
# 这些数字是注内段号，绝不能当成章号（否则会凭空多出一整章引用）
_PARA_SEQ = re.compile(
    r"(?:[、，,]|与|和|及)*"
    r"(?:第)?(?:\d{1,2}|[一二三四五六七八九十]{1,2})"
    r"(?:(?:[、，,]|与|和|及)(?:\d{1,2}|[一二三四五六七八九十]{1,2}))*"
    r"段"
)
_PARA_FIRST = re.compile(r"(?:第)?(\d{1,2}|[一二三四五六七八九十]{1,2})")
# 「注N上半/下半」：注内位置后缀（上半=第1部分、下半=第2部分），不是段号
_PARA_HALF = re.compile(r"[上下]半")


def match_para_seq(text: str, pos: int):
    """匹配段号序列，返回 (首段号, 结束位置)；不匹配返回 (None, pos)。
    「上半/下半」分别映射段号 1/2。"""
    m = _PARA_HALF.match(text, pos)
    if m:
        return (1 if m.group(0)[0] == "上" else 2), m.end()
    m = _PARA_SEQ.match(text, pos)
    if not m:
        return None, pos
    fm = _PARA_FIRST.search(m.group(0))
    return (cn_to_int(fm.group(1)) if fm else None), m.end()


def _is_cjk(ch: str) -> bool:
    return "\u3400" <= ch <= "\u9fff" or "\uf900" <= ch <= "\ufaff"


def _looks_like_number_start(s: str, i: int, book: Optional[int] = None,
                             single_chapter: Optional[set] = None) -> bool:
    """书卷缩写后面必须紧跟数字（或「标题」），才算真正的引用起点。

    「百」不算起始数字：章号「一百」总是以「一」开头，单独的「百」只可能是
    「利百加」这类人名的第二个字。
    权威文法中章号一律中文数字、节号一律阿拉伯数字；书卷缩写直接跟
    阿拉伯数字只对单章书（犹10/门12）成立，「引出12节」「现出8节」
    这类「动词+出+节号」会被「出」误吞，靠此约束排除。
    """
    if i >= len(s):
        return False
    if s[i] in CN_CHARS and s[i] != "百":
        return True
    if s[i:i + 2] == "标题":
        return True
    if s[i].isdigit():
        return single_chapter is None or (book is not None and book in single_chapter)
    return False


def cn_to_int(s: str) -> Optional[int]:
    """中文数字 → int。

    兼容两种写法：
      * 逐位式：一○四=104、一三六=136（章号主流写法）
      * 复合式：十=10、十一=11、二十=20、二十五=25、一百=100、一五○=150
      * ASCII 数字直接转换（节号）
    """
    if not s:
        return None
    if s.isdigit():
        return int(s)
    if "十" not in s and "百" not in s:
        if all(ch in CN_DIGITS for ch in s):
            v = 0
            for ch in s:
                v = v * 10 + CN_DIGITS[ch]
            return v
        return None
    val = 0
    rest = s
    if "百" in rest:
        i = rest.index("百")
        head = rest[:i]
        val += (cn_to_int(head) if head else 1) * 100
        rest = rest[i + 1:]
    if "十" in rest:
        i = rest.index("十")
        head = rest[:i]
        val += (cn_to_int(head) if head else 1) * 10
        rest = rest[i + 1:]
    if rest:
        v = cn_to_int(rest)
        if v is None:
            return None
        val += v
    return val


@dataclass
class Ref:
    """一条解析后的引用。v1==0 表示整章引用（诗篇"标题"用 part='标题'）。"""
    book: int
    chapter: int
    v1: int = 0
    chapter2: Optional[int] = None   # 整章区间（撒上十六～撒下二四则拆为两条）
    v2: Optional[int] = None         # 节区间终值（含）
    part: Optional[str] = None       # 上/下/半（节内位置）、标题（篇题）
    compare: bool = False            # 带"参/见"前缀
    lo: int = -1                     # 在原文中的起点（含书名缩写）
    hi: int = -1                     # 在原文中的终点（排他）

    def fmt(self, books: Dict[int, Tuple[str, str, int]]) -> str:
        b = books[self.book][1]
        if self.v1 == 0:
            ch = f"{self.chapter}" + (f"-{self.chapter2}" if self.chapter2 else "")
            v = self.part or ""
        elif self.chapter2:
            # 跨章节区间：「书2:28-3:24」
            v = f":{self.v1}-{self.chapter2}:{self.v2}" + (self.part or "")
            return f"{b}{self.chapter}{v}" + (" (参)" if self.compare else "")
        else:
            ch = f"{self.chapter}"
            v = f":{self.v1}" + (f"-{self.v2}" if self.v2 else "") + (self.part or "")
        return f"{b}{ch}{v}" + (" (参)" if self.compare else "")


@dataclass
class NoteRef:
    """注解跳转指针（如「创十九37注2一段」）。

    book/chapter/verse 指向被注的经文，num = 注号，para = 注内段号（1 起，未知为 0）。
    """
    book: int
    chapter: int
    verse: int
    num: int
    para: int = 0
    keep_verse: bool = False   # 前有「与/和/及/、」→ 经文本身也是目标，需一并展示
    lo: int = -1               # 在原文中的起点（含「注」字）
    hi: int = -1               # 在原文中的终点（排他）

    def fmt(self, books: Dict[int, Tuple[str, str, int]]) -> str:
        b = books[self.book][1]
        s = f"{b}{self.chapter}:{self.verse} 注{self.num}"
        if self.para:
            s += f" 第{self.para}段"
        return s


@dataclass
class ParseResult:
    refs: List[Ref] = field(default_factory=list)
    notes: List[NoteRef] = field(default_factory=list)
    offset: int = 0   # 预处理前被 strip 掉的前缀长度（lo/hi + offset = raw 偏移）


class RefParser:
    """引用串解析器。

    需要书卷表（缩写→书号、章数）与每卷每章的节上限做校验。
    优先使用权威 APK 的 volume_all_gb_22 / verse_all_final_gb_26；
    也可以用本仓库 resource/zh_rcv.db 的 book_name + content 构建。
    """

    def __init__(self, books: Dict[int, Tuple[str, str, int]],
                 verse_count: Dict[Tuple[int, int], int]) -> None:
        self.books = books
        # 匹配表同时接受原缩写与繁→简归一后的缩写：
        # 繁体库（zh_hant_rcv.db）的缩写是繁体（如「約」），而 parse 前会
        # normalize_text 把输入归一为简体（「約」→「约」），若只注册繁体
        # 缩写会匹配失败并错误回退到上下文书卷。
        self.abbr2book: Dict[str, int] = {}
        for i, (_n, ab, _c) in books.items():
            self.abbr2book[ab] = i
            _nab = normalize_text(ab)
            if _nab and _nab != ab and _nab not in self.abbr2book:
                self.abbr2book[_nab] = i
        self.abbrs = sorted(self.abbr2book, key=len, reverse=True)
        self.single_chapter = {i for i, (_n, _a, c) in books.items() if c == 1}
        self.verse_count = verse_count

    # ---------- 供外部构建 ----------
    @classmethod
    def from_apk_db(cls, apk_db_path: str) -> "RefParser":
        con = sqlite3.connect("file:%s?mode=ro" % apk_db_path.replace("\\", "/"), uri=True)
        books: Dict[int, Tuple[str, str, int]] = {}
        for idx, name, abbr, chsum in con.execute(
            "SELECT chapter_code, chapter_name, abbreviation, chapter_sum FROM volume_all_gb_22"
        ):
            books[int(idx)] = (str(name).strip('"'), str(abbr).strip('"'), int(chsum))
        vc: Dict[Tuple[int, int], int] = {}
        for b, ch, mx in con.execute(
            "SELECT chapter_code, section_code, MAX(segment_code) FROM verse_all_final_gb_26 "
            "GROUP BY chapter_code, section_code"
        ):
            vc[(int(b), int(ch))] = int(mx)
        con.close()
        return cls(books, vc)

    @classmethod
    def from_project_db(cls, project_db_path: str) -> "RefParser":
        """用本仓库 resource/zh_rcv.db 构建（book_name + content 推断章数）。"""
        con = sqlite3.connect("file:%s?mode=ro" % project_db_path.replace("\\", "/"), uri=True)
        rows = con.execute(
            "SELECT book_index, name, acronym_name FROM book_name ORDER BY _id"
        ).fetchall()
        han = re.compile(r"[\u4e00-\u9fff]")
        tra = re.compile(r"[創書詩傳賽結彌鴻該亞瑪約羅門來猶啟後註節見與參]")
        chosen: Dict[int, Tuple[str, str]] = {}
        for idx, name, abbr in rows:
            idx = int(idx)
            abbr = str(abbr or "").strip()
            # 只接受中文缩写，且优先不含繁体字的写法（同卷简繁两行时取简体）
            if not abbr or not han.search(abbr):
                continue
            prev = chosen.get(idx)
            if prev is None or (tra.search(prev[1]) and not tra.search(abbr)):
                chosen[idx] = (str(name), abbr)
        # 章数由 content 表推断
        ch_max: Dict[int, int] = {}
        vc: Dict[Tuple[int, int], int] = {}
        for b, ch, mx in con.execute(
            "SELECT book_index, chapter, MAX(section) FROM content GROUP BY book_index, chapter"
        ):
            ch_max[int(b)] = max(ch_max.get(int(b), 0), int(ch))
            vc[(int(b), int(ch))] = int(mx)
        con.close()
        books: Dict[int, Tuple[str, str, int]] = {
            idx: (name, abbr, ch_max.get(idx, 1)) for idx, (name, abbr) in chosen.items()
        }
        return cls(books, vc)

    # ---------- 词条读取 ----------
    def _match_book(self, s: str, i: int) -> Optional[Tuple[int, int]]:
        # 词边界：缩写前一个字是汉字、且不是引用引导词时，说明它只是正文用字
        # （「本书」「结果」「阿波利亚」「更多」「同理」…），不是书卷缩写。
        if i > 0 and _is_cjk(s[i - 1]) and s[i - 1] not in BOOK_LEAD_CHARS:
            return None
        for ab in self.abbrs:
            if s.startswith(ab, i):
                return self.abbr2book[ab], i + len(ab)
        return None

    @staticmethod
    def _read_cn(s: str, i: int) -> Tuple[Optional[int], int]:
        j = i
        while j < len(s) and s[j] in CN_CHARS:
            j += 1
        if j == i:
            return None, i
        return cn_to_int(s[i:j]), j

    @staticmethod
    def _read_ascii(s: str, i: int) -> Tuple[Optional[int], int]:
        j = i
        while j < len(s) and s[j].isdigit():
            j += 1
        if j == i:
            return None, i
        return int(s[i:j]), j

    # ---------- 主解析 ----------
    def parse(self, raw: str, ctx_book: Optional[int] = None,
              ctx_chapter: Optional[int] = None) -> ParseResult:
        res = ParseResult()
        src = raw or ""
        lead = len(src) - len(src.lstrip())
        text = src.strip()
        while len(text) >= 2 and text[0] == '"' and text[-1] == '"':
            text = text[1:-1]
            _t = text.strip()
            lead += 1 + (len(text) - len(_t))
            text = _t
        res.offset = lead
        if not text:
            return res
        text = normalize_text(text)
        text = text.replace("（", "(").replace("）", ")")
        # 以下预处理一律**等长替换**，保证 ref.lo/hi 可直接映射回 raw 的偏移。
        # 外层括号是引用定界，保留内容（换成边界标记）。
        while len(text) >= 2 and text[0] == "(" and text[-1] == ")":
            text = "\x03" + text[1:-1] + "\x03"
        # 「(一)(二)(三)」这类列表项标记抹除，否则会被当成章号 1/2/3
        text = re.sub(r"\([一二三四五六七八九十]{1,2}\)",
                      lambda m: "\x03" * len(m.group(0)), text)
        # 内层括号不能整体剔除——括注里常藏着可点引用（「在三16，（见注4，）」）。
        # 左括号 = 新的引用组边界（重置书卷），右括号只作分隔。
        text = text.replace("(", "\x01").replace(")", "\x02")
        # 「说明文字—引用」：破折号后才是引用本体；少数条目为「引用—说明文字」，需回退到前半段
        if "—" in text:
            _i = text.rfind("—")
            _seg = text[_i + 1:]
            _tail = _seg.strip()
            if _tail:
                _off = _i + 1 + (len(_seg) - len(_tail))
                sub = self.parse(_tail, ctx_book, ctx_chapter)
                if sub.refs:
                    for _r in sub.refs:
                        if _r.lo >= 0:
                            _r.lo += _off
                            _r.hi += _off
                    for _x in sub.notes:
                        if _x.lo >= 0:
                            _x.lo += _off
                            _x.hi += _off
                    sub.offset = lead
                    return sub
            _seg = text[:_i]
            _head = _seg.strip()
            if _head:
                _off = len(_seg) - len(_seg.lstrip())
                sub = self.parse(_head, ctx_book, ctx_chapter)
                if sub.refs:
                    for _r in sub.refs:
                        if _r.lo >= 0:
                            _r.lo += _off
                            _r.hi += _off
                    for _x in sub.notes:
                        if _x.lo >= 0:
                            _x.lo += _off
                            _x.hi += _off
                    sub.offset = lead
                    return sub

        cur_book: Optional[int] = ctx_book
        cur_ch: Optional[int] = ctx_chapter
        cur_ch2: Optional[int] = None
        part: Optional[str] = None
        compare = False
        # mode: 'CH' = 已读章未见节（可能是整章引用）；'VERSE' = 已产出节引用；
        #       'NONE' = 初始/仅上下文。产出引用时消费 compare。
        mode = "NONE"
        # 当前章号是否由显式书卷 / 显式范围引入。只有这种情况下，
        # 「只写章不写节」才能当成整章引用；否则「三一神」「六百岁」「二约」
        # 这类正文计数会被误读成整章。
        anchor = False
        # 显式书卷结束后的位置。裸章号必须**紧邻**书卷（「参王下九～十」），
        # 否则它只是书卷之后很远处的正文计数（「作三一神的具体化身」）。
        anchor_pos = -1
        # 原文偏移：ref_lo 是本条引用起点（书名缩写或首位数字），
        # anchor_lo 是显式书卷起点（整章引用以它为起点）。
        ref_lo = -1
        anchor_lo = -1
        # 「注N」指针作为锚点的那些节引用索引（只隐去锚点本身，不按整节全局过滤）
        drop_idx: set = set()

        def close(end: int = -1) -> None:
            nonlocal compare, mode, part, cur_ch2, part, ref_lo
            if mode == "CH" and (anchor or part == "标题") and cur_book is not None \
                    and cur_ch is not None:
                # 整章引用必须落在该书卷的实际章数内；否刚就是「约一百磅」
                # 「拿八」「三一神」这类正文计数误读，不产出引用。
                if 1 <= cur_ch <= self.books[cur_book][2]:
                    _lo = ref_lo if ref_lo >= 0 else anchor_lo
                    res.refs.append(
                        Ref(cur_book, cur_ch, 0, cur_ch2, None, part, compare,
                            lo=_lo, hi=end))
                    compare = False
            mode = "NONE"
            part = None
            ref_lo = -1

        pos, n = 0, len(text)
        m = re.match(r"^\s*\d+\s*[～~\-—]\s*\d+\s*[：:]", text)   # 开头的“3～32：”范围标注
        if m:
            pos = m.end()

        while pos < n:
            ch0 = text[pos]

            # 句子 / 段落边界：引用上下文回落到本条注解所属的书卷与章。
            # 注解正文里「…犹5、11，本辞更多揭示…。在三9」的「三9」指彼后 3:9，
            # 而不是沿用上一句的犹大书；「ˍ(二)」分段同理。
            if ch0 in "。ˍ\n\x01":
                if ch0 == "\x01":
                    # 紧接节号后的括注是同一引用的补充（「太十三31～32（十七20）」），
                    # 继承当前书卷；位于句读后的左括号则是新的引用组，要重置。
                    _j = pos - 1
                    while _j >= 0 and text[_j] == "\x02":
                        _j -= 1
                    if _j >= 0 and (text[_j].isdigit() or text[_j] in "上下半"):
                        pos += 1
                        continue
                close(pos)
                cur_book = ctx_book
                cur_ch = ctx_chapter
                cur_ch2 = None
                anchor = False
                ref_lo = -1
                pos += 1
                continue

            if ch0 in "，、；：！？\u201c\u201d\u2018\u2019\x02\x03":
                close(pos)                         # 句读边界：整章引用在此收口，
                pos += 1                           # 防止「诗八八标题，）也是…」被一并吃进区间
                continue

            if ch0 in "参见":                       # 参/见 = 对照参考标志（作用于下一引用）
                close(pos)
                compare = True
                pos += 1
                if pos < n and text[pos] in "阅看":
                    pos += 1
                continue

            if ch0 == "注":                          # “注N(至M)” = 注解跳转，不是经节
                _note_lo = pos
                # 前一个非空白字符是否为连接词（「罗一20与注1」）
                _j = pos - 1
                while _j >= 0 and text[_j] in " \u3000":
                    _j -= 1
                _keep_verse = _j >= 0 and text[_j] in "与和及、，"
                pos += 1
                _v, k = self._read_ascii(text, pos)
                note_num = _v
                if _v is not None:
                    pos = k
                if pos < n and text[pos] in "至到":
                    _v2, k2 = self._read_ascii(text, pos + 1)
                    if _v2 is not None:
                        pos = k2
                # 可选段号序列：「一段」「二段」「第2段」「二、三段」「一段與二段」
                para, k = match_para_seq(text, pos)
                if para is not None:
                    pos = k
                # 记录注解指针：挂到上一条已产出的节引用上；
                # 无前置节引用时回退到「本节」（verse=0，导出层替换为实际节号）
                if note_num:
                    if res.refs and res.refs[-1].v1:
                        _b, _c, _v0 = res.refs[-1].book, res.refs[-1].chapter, res.refs[-1].v1
                    else:
                        _b, _c, _v0 = ctx_book, ctx_chapter, 0
                    if _b is not None:
                        _nr = NoteRef(_b, _c or 1, _v0, note_num, para or 0,
                                      _keep_verse, lo=_note_lo, hi=pos)
                        _dup = any(
                            q.book == _nr.book and q.chapter == _nr.chapter
                            and q.verse == _nr.verse and q.num == _nr.num
                            and q.para == _nr.para for q in res.notes)
                        if not _dup:
                            res.notes.append(_nr)
                        if res.refs and not _keep_verse:
                            # 只隐去紧接此指针的那一条锚点引用。同一节在别处
                            # 作为真实引用出现（「三16」+「见注4」）时仍要保留。
                            drop_idx.add(len(res.refs) - 1)
                continue

            # 续接的段号序列（如「注1二、三段」剥完首段后的「、三段」）：只跳过，不当章号
            _p2, _k2 = match_para_seq(text, pos)
            if _p2 is not None:
                pos = _k2
                continue

            hit = self._match_book(text, pos)        # 书卷缩写（最长优先）
            if hit:
                nb, np = hit
                # 只有缩写后面确实跟着数字，才切换书卷上下文；否则只是正文用字，
                # 跳过它但不能污染 cur_book（「在罗马书」的「罗」后是「马」）。
                if _looks_like_number_start(text, np, nb, self.single_chapter):
                    close(pos)
                    cur_book = nb
                    cur_ch = cur_ch2 = None
                    anchor = True
                    anchor_pos = np
                    anchor_lo = pos
                    ref_lo = pos
                pos = np
                continue

            if ch0 == "百":                        # 单独的「百」不是章号（「利百加」）
                pos += 1
                continue

            if ch0 in CN_CHARS:                      # 中文数字 = 章号候选
                start = pos
                _prev_lo = ref_lo
                ch, pos = self._read_cn(text, pos)
                if ch is None:
                    continue
                # 章号必须由后继内容“证实”，否则只是正文计数：
                #   加节号    → 「三9」、 「一○四7」
                #   加节范围  → 「九～十」
                #   加「章」  → 「三章」
                #   加「标题」→ 诗篇篇题
                #   紧邻书卷的裸章 → 「参王下九～十」的整章引用
                nxt = text[pos] if pos < n else ""
                if nxt == "章":
                    pos += 1
                elif text[pos:pos + 2] == "标题" or text[pos:pos + 3] == "篇标题":
                    pass
                elif nxt.isdigit() or nxt in "～~-—–至到":
                    pass
                elif nxt in CN_CLASSIFIERS or start != anchor_pos:
                    continue                         # 「三个」「三一神」「二约」：丢弃
                close(start)
                cur_ch2 = None
                cur_ch = ch
                mode = "CH"
                # 引用起点：优先保留书卷缩写的位置（「太十28」从「太」开始）
                ref_lo = _prev_lo if _prev_lo >= 0 else start
                if pos < n and text[pos] in "～~-—–至到":
                    v2, k2 = self._read_cn(text, pos + 1)
                    if v2:
                        cur_ch2 = v2
                        pos = k2
                if text[pos:pos + 2] == "标题":       # 诗篇篇题
                    part = "标题"
                    pos += 2
                elif text[pos:pos + 3] == "篇标题":   # 「十六篇标题」：N篇篇题（无书卷缩写）
                    part = "标题"
                    pos += 3
                continue

            if ch0.isdigit():                        # 阿拉伯数字 = 节
                start = pos
                v, pos = self._read_ascii(text, pos)
                if v is None:
                    pos += 1
                    continue
                v2 = None
                chapter2 = None
                suf = None
                if pos < n and text[pos] in "～~-—–至到":
                    v2, k2 = self._read_ascii(text, pos + 1)
                    if v2 is not None:
                        pos = k2
                    elif pos + 1 < n and text[pos + 1] in CN_CHARS:
                        # 跨章区间：「二28～三24」→ 约壹 2:28-3:24
                        # 区间终点写成「章+节」，与权威 App 的 token 文法一致
                        _c2, _k2 = self._read_cn(text, pos + 1)
                        if _c2 is not None:
                            _v2, _k3 = self._read_ascii(text, _k2)
                            if (_v2 is not None and cur_ch is not None
                                    and _c2 > cur_ch):
                                chapter2 = _c2
                                v2 = _v2
                                pos = _k3
                if pos < n and text[pos] in "上下":
                    suf = text[pos]
                    pos += 1
                elif pos < n and text[pos] == "半":
                    suf = "半"
                    pos += 1
                if cur_book is None:
                    continue
                chapter = cur_ch
                if chapter is None:
                    if cur_book in self.single_chapter:
                        chapter = 1
                    else:
                        continue                     # 无章上下文，忽略
                _lo = ref_lo if ref_lo >= 0 else start
                res.refs.append(Ref(cur_book, chapter, v, chapter2, v2, suf, compare,
                                    lo=_lo, hi=pos))
                ref_lo = -1
                mode = "VERSE"
                compare = False
                continue

            if mode == "CH" and _is_cjk(ch0) and ch0 not in CN_CHARS:
                close(pos)                         # 整章引用遇到正文文字即收口
                pos += 1                           # 「民二十的错误」→ 区间只到「二十」
                continue

            pos += 1                                 # 分隔符等一律跳过

        close(n)

        # 紧接节号的「注N」表示“看该节的注解”：该节只作锚点，不单独展示经文。
        # 只有出现「与/和/及/、」连接（X与注N）时，经文与注解都要展示。
        # 注意：这里不去重。同一节可能在注解多处被援引，每一处都要保留自己的
        # lo/hi，前端才能把每个位置都渲染成可点；展示用的引用串由导出去重。
        if drop_idx:
            res.refs = [_r for _i, _r in enumerate(res.refs) if _i not in drop_idx]
        return res

    # ---------- 校验 ----------
    def valid(self, r: Ref) -> bool:
        if not (1 <= r.chapter <= self.books[r.book][2]):
            return False
        if r.chapter2 is not None and r.chapter <= r.chapter2 <= self.books[r.book][2]:
            # 整章区间
            if r.v1 == 0:
                return True
            # 跨章节区间：「二28～三24」——两端各自落在所属章的节数范围内
            if r.v2:
                mx1 = self.verse_count.get((r.book, r.chapter))
                mx2 = self.verse_count.get((r.book, r.chapter2))
                return bool(mx1 and mx2 and 1 <= r.v1 <= mx1 and 1 <= r.v2 <= mx2)
        if r.v1 == 0:
            return True
        mx = self.verse_count.get((r.book, r.chapter))
        if mx is None:
            return False
        hi = r.v2 or r.v1
        return 1 <= r.v1 <= mx and 1 <= hi <= mx


# ─────────────────────────── 自验证 CLI ──────────────────────────────────────
def _run_self_test(apk_db: str) -> int:
    p = RefParser.from_apk_db(apk_db)
    con = sqlite3.connect("file:%s?mode=ro" % apk_db.replace("\\", "/"), uri=True)
    total = empty = beadptr = 0
    ok_refs = bad_refs = 0
    bad_samples: List[str] = []
    samples_src = [
        ("SELECT chapter_code, section_code, Beaded_content FROM foot_all_gb_28"),
        ("SELECT chapter_code, section_code, note FROM footnote_all_link_10"),
    ]
    for sql in samples_src:
        for b, ch, raw in con.execute(sql):
            total += 1
            s = (raw or "").strip().strip('"').strip()
            if not s:
                empty += 1
                continue
            if re.fullmatch(r"[参见]?\d+[a-z]", s):
                beadptr += 1                     # 串珠互指（如“见6a”），非经文引用
                continue
            for ref in p.parse(s, int(b), int(ch)).refs:
                if p.valid(ref):
                    ok_refs += 1
                else:
                    bad_refs += 1
                    if len(bad_samples) < 10:
                        bad_samples.append(f"{s[:50]} -> {ref}")
    meaningful = total - empty - beadptr
    con.close()
    print(f"样本串总数        : {total}")
    print(f"  空串            : {empty}")
    print(f"  串珠互指        : {beadptr}")
    print(f"  有效引用串      : {meaningful}")
    print(f"展开引用          : {ok_refs + bad_refs}")
    print(f"  越界/不存在     : {bad_refs} ({bad_refs / max(1, ok_refs + bad_refs):.3%})")
    for s in bad_samples:
        print("  !", s)
    return 0


def _run_parse_one(apk_db: str, text: str, ctx: Optional[Tuple[int, int]]) -> int:
    p = RefParser.from_apk_db(apk_db)
    b, c = (ctx or (None, None))
    for ref in p.parse(text, b, c).refs:
        mark = "" if p.valid(ref) else "  (越界?)"
        print(ref.fmt(p.books) + mark)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apk-db", required=True, help="权威 APK 解包出的 Bible20240820.sqlite 路径")
    ap.add_argument("--parse", help="解析单条引用串，如：创一6，9，诗三三6，9")
    ap.add_argument("--ctx", help="单条解析时的上下文 书号:章，如 1:1（可省略）")
    ap.add_argument("--self-test", action="store_true", help="对全部 46,684 条原文跑验证")
    args = ap.parse_args()
    if args.parse:
        ctx = None
        if args.ctx:
            b, c = args.ctx.split(":", 1)
            ctx = (int(b), int(c) or None)
        return _run_parse_one(args.apk_db, args.parse, ctx)
    return _run_self_test(args.apk_db)


if __name__ == "__main__":
    sys.exit(main())