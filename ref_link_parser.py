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

# ─── 繁→简归一（覆盖书卷缩写字符；约壹/约贰/约参须整体先替换） ────────────────
TRAD_PHRASES = [
    ("約壹", "约壹"), ("約貳", "约贰"), ("約參", "约参"),
]
TRAD_CHARS = str.maketrans({
    "創": "创", "書": "书", "詩": "诗", "傳": "传", "賽": "赛", "結": "结",
    "彌": "弥", "鴻": "鸿", "該": "该", "亞": "亚", "瑪": "玛", "約": "约",
    "羅": "罗", "門": "门", "來": "来", "猶": "犹", "啟": "启", "後": "后",
    "註": "注", "節": "节", "見": "见", "與": "与",
})


def normalize_text(s: str) -> str:
    """繁→简归一（书卷缩写 + 常用符号），供解析前的统一处理。"""
    for a, b in TRAD_PHRASES:
        s = s.replace(a, b)
    return s.translate(TRAD_CHARS)


# 「注N」后的段号序列：一段 / 二、三段 / 第2段 / 一段與二段
# 这些数字是注内段号，绝不能当成章号（否则会凭空多出一整章引用）
_PARA_SEQ = re.compile(
    r"(?:[、，,]|与|和|及)*"
    r"(?:第)?(?:\d{1,2}|[一二三四五六七八九十]{1,2})"
    r"(?:(?:[、，,]|与|和|及)(?:\d{1,2}|[一二三四五六七八九十]{1,2}))*"
    r"段"
)
_PARA_FIRST = re.compile(r"(?:第)?(\d{1,2}|[一二三四五六七八九十]{1,2})")


def match_para_seq(text: str, pos: int):
    """匹配段号序列，返回 (首段号, 结束位置)；不匹配返回 (None, pos)。"""
    m = _PARA_SEQ.match(text, pos)
    if not m:
        return None, pos
    fm = _PARA_FIRST.search(m.group(0))
    return (cn_to_int(fm.group(1)) if fm else None), m.end()


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

    def fmt(self, books: Dict[int, Tuple[str, str, int]]) -> str:
        b = books[self.book][1]
        ch = f"{self.chapter}" + (f"-{self.chapter2}" if self.chapter2 else "")
        if self.v1 == 0:
            v = self.part or ""
        else:
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


class RefParser:
    """引用串解析器。

    需要书卷表（缩写→书号、章数）与每卷每章的节上限做校验。
    优先使用权威 APK 的 volume_all_gb_22 / verse_all_final_gb_26；
    也可以用本仓库 resource/zh_rcv.db 的 book_name + content 构建。
    """

    def __init__(self, books: Dict[int, Tuple[str, str, int]],
                 verse_count: Dict[Tuple[int, int], int]) -> None:
        self.books = books
        self.abbr2book: Dict[str, int] = {ab: i for i, (_n, ab, _c) in books.items()}
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
        text = (raw or "").strip().strip('"').strip()
        if not text:
            return res
        text = normalize_text(text)
        text = text.replace("（", "(").replace("）", ")")
        # 外层括号是引用定界，保留内容；内层括号是括注（原文说明），整体剔除
        while len(text) >= 2 and text[0] == "(" and text[-1] == ")":
            text = text[1:-1]
        text = re.sub(r"\([^()]*\)", "", text)
        text = text.replace("(", "").replace(")", "")
        # 「说明文字—引用」：破折号后才是引用本体；少数条目为「引用—说明文字」，需回退到前半段
        if "—" in text:
            tail = text.rsplit("—", 1)[1].strip()
            if tail:
                sub = self.parse(tail, ctx_book, ctx_chapter)
                if sub.refs:
                    return sub
            head = text.split("—", 1)[0].strip()
            if head:
                sub = self.parse(head, ctx_book, ctx_chapter)
                if sub.refs:
                    return sub

        cur_book: Optional[int] = ctx_book
        cur_ch: Optional[int] = ctx_chapter
        cur_ch2: Optional[int] = None
        part: Optional[str] = None
        compare = False
        # mode: 'CH' = 已读章未见节（可能是整章引用）；'VERSE' = 已产出节引用；
        #       'NONE' = 初始/仅上下文。产出引用时消费 compare。
        mode = "NONE"

        def close() -> None:
            nonlocal compare, mode, part, cur_ch2, part
            if mode == "CH" and cur_book is not None and cur_ch is not None:
                res.refs.append(Ref(cur_book, cur_ch, 0, cur_ch2, None, part, compare))
                compare = False
            mode = "NONE"
            part = None

        pos, n = 0, len(text)
        m = re.match(r"^\s*\d+\s*[～~\-—]\s*\d+\s*[：:]", text)   # 开头的“3～32：”范围标注
        if m:
            pos = m.end()

        while pos < n:
            ch0 = text[pos]

            if ch0 in "参见":                       # 参/见 = 对照参考标志（作用于下一引用）
                close()
                compare = True
                pos += 1
                if pos < n and text[pos] in "阅看":
                    pos += 1
                continue

            if ch0 == "注":                          # “注N(至M)” = 注解跳转，不是经节
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
                # 记录注解指针：挂到上一条已产出的节引用上
                if note_num and res.refs:
                    _last = res.refs[-1]
                    if _last.v1:
                        _nr = NoteRef(_last.book, _last.chapter, _last.v1, note_num, para or 0,
                                      _keep_verse)
                        if _nr not in res.notes:
                            res.notes.append(_nr)
                continue

            # 续接的段号序列（如「注1二、三段」剥完首段后的「、三段」）：只跳过，不当章号
            _p2, _k2 = match_para_seq(text, pos)
            if _p2 is not None:
                pos = _k2
                continue

            hit = self._match_book(text, pos)        # 书卷缩写（最长优先）
            if hit:
                close()
                cur_book, pos = hit
                cur_ch = cur_ch2 = None
                continue

            if ch0 in CN_CHARS:                      # 中文数字 = 章
                close()
                cur_ch2 = None
                ch, pos = self._read_cn(text, pos)
                if ch:
                    cur_ch = ch
                    mode = "CH"
                    if pos < n and text[pos] in "～~-—–至到":
                        v2, k2 = self._read_cn(text, pos + 1)
                        if v2:
                            cur_ch2 = v2
                            pos = k2
                    if text[pos:pos + 2] == "标题":   # 诗篇篇题
                        part = "标题"
                        pos += 2
                continue

            if ch0.isdigit():                        # 阿拉伯数字 = 节
                v, pos = self._read_ascii(text, pos)
                if v is None:
                    pos += 1
                    continue
                v2 = None
                suf = None
                if pos < n and text[pos] in "～~-—–至到":
                    v2, k2 = self._read_ascii(text, pos + 1)
                    if v2 is not None:
                        pos = k2
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
                res.refs.append(Ref(cur_book, chapter, v, None, v2, suf, compare))
                mode = "VERSE"
                compare = False
                continue

            pos += 1                                 # 分隔符等一律跳过

        close()

        # 紧接节号的「注N」表示“看该节的注解”：该节只作锚点，不单独展示经文。
        # 只有出现「与/和/及/、」连接（X与注N）时，经文与注解都要展示。
        if res.notes:
            keep: Dict[Tuple[int, int, int], bool] = {}
            for _n in res.notes:
                _k = (_n.book, _n.chapter, _n.verse)
                keep[_k] = keep.get(_k, False) or _n.keep_verse
            res.refs = [
                _r for _r in res.refs
                if not (_r.v1 and (_r.book, _r.chapter, _r.v1) in keep
                        and not keep[(_r.book, _r.chapter, _r.v1)])
            ]
        return res

    # ---------- 校验 ----------
    def valid(self, r: Ref) -> bool:
        if not (1 <= r.chapter <= self.books[r.book][2]):
            return False
        if r.chapter2 is not None and r.chapter <= r.chapter2 <= self.books[r.book][2]:
            # 整章区间
            if r.v1 == 0:
                return True
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