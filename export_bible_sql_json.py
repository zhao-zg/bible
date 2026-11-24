#!/usr/bin/env python3
"""
从圣经数据库（SQLite）导出 JSON 数据，支持多语言版本：
- bible-text.json   经文（带 {注解序号} / [串珠字母] 标记，仅 CG）
- bible-notes.json  注解（仅 CG）
- bible-xrefs.json  串珠/交叉引用（仅 CG）
- bible-books.json  书卷名映射（简称和全名）
- bible/01.json ~ bible/66.json  按书卷分片（含经文+注解+串珠，仅 CG）
- bible/zh-rcv/{NN}.json   恢复本版本分片
- bible/zh-cuv/{NN}.json   和合本版本分片
- bible/en-darby/{NN}.json  Darby 版本分片
- bible/en-kjv/{NN}.json    KJV 版本分片
- bible/en-rcv/{NN}.json   英文恢复本版本分片
- bible/ko-rcv/{NN}.json   韩文恢复本版本分片
- bible/zh-hant-rcv/{NN}.json  繁体恢复本版本分片
- bible/zh-hant-cuv/{NN}.json  繁体和合本版本分片
- bible-versions.json       版本元数据
- reading-plans.json        读经计划整合
- bible-topics.json         书卷主题（仅 CG）
- bible-intro.json          书卷简介（仅 CG）
- bible-outlines.json       书卷大纲（仅 CG）

用法：
    python export_bible_sql_json.py
    python export_bible_sql_json.py --sqlite-db path/to/zh_rcv.db --out-dir output/data
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


HERE = Path(__file__).resolve().parent
DEFAULT_SQLITE_DB = HERE / "resource" / "zh_rcv.db"
DEFAULT_OUT_DIR = HERE / "output" / "data"
RESOURCE_DIR = HERE / "resource"
I18N_JSON_PATH = HERE / "src" / "static" / "data" / "book-names-i18n.json"

BIBLE_VERSIONS = [
    {"db": "zh_rcv.db", "table": "content", "lang": "zh-rcv", "label": "恢复本(简)",
     "has_notes": True, "has_xrefs": True,
     "col_map": {"book": "book_index", "chap": "chapter", "sec": "section", "text": "content"}},
    {"db": "zh_cuv.db", "table": "wlunv", "lang": "zh-cuv", "label": "和合本(简)",
     "has_notes": False, "has_xrefs": False,
     "col_map": {"book": "engs", "chap": "chap", "sec": "sec", "text": "txt"}},
    {"db": "en_darby.db", "table": "darby", "lang": "en-darby", "label": "英文达秘译本",
     "has_notes": False, "has_xrefs": False,
     "col_map": {"book": "engs", "chap": "chap", "sec": "sec", "text": "txt"}},
    {"db": "en_kjv.db", "table": "nstrkjv", "lang": "en-kjv", "label": "钦定英文译本",
     "has_notes": False, "has_xrefs": False,
     "col_map": {"book": "engs", "chap": "chap", "sec": "sec", "text": "txt"}},
    {"db": "en_rcv.db", "table": "rcv_verse_eng", "lang": "en-rcv", "label": "恢复本(英)",
     "has_notes": False, "has_xrefs": False,
     "col_map": {"book": "engs", "chap": "chap", "sec": "sec", "text": "txt"}},
    {"db": "ko_rcv.db", "table": "korean_rcv", "lang": "ko-rcv", "label": "恢复本(韩)",
     "has_notes": False, "has_xrefs": False,
     "col_map": {"book": "engs", "chap": "chap", "sec": "sec", "text": "txt"}},
    {"db": "zh_hant_rcv.db", "table": "rcv_verse_big5", "lang": "zh-hant-rcv", "label": "恢复本(繁)",
     "has_notes": False, "has_xrefs": False,
     "col_map": {"book": "engs", "chap": "chap", "sec": "sec", "text": "txt"}},
    {"db": "zh_hant_cuv.db", "table": "cuv_big5", "lang": "zh-hant-cuv", "label": "和合本(繁)",
     "has_notes": False, "has_xrefs": False,
     "col_map": {"book": "engs", "chap": "chap", "sec": "sec", "text": "txt"}},
    {"db": "strongs.db", "table": "unv", "lang": "he-el", "label": "词典",
     "has_notes": False, "has_xrefs": False,
     "col_map": {"book": "engs", "chap": "chap", "sec": "sec", "text": "txt"},
     "source": "parsing", "style": "sn_orig", "keep_chinese": True},
    {"db": "strongs.db", "table": "unv", "lang": "he-orig", "label": "原文",
     "has_notes": False, "has_xrefs": False,
     "col_map": {"book": "engs", "chap": "chap", "sec": "sec", "text": "txt"},
     "source": "parsing", "style": "pure_orig"},
]

READING_PLAN_FILES = [
    # (plan_id, plan_name, filename, lang)
    ("ot-chapters", "旧约", "ot-chapters.json", "zh-CN"),
    ("nt-chapters", "新约", "nt-chapters.json", "zh-CN"),
    ("nt-sections", "新约·段读", "nt-sections.json", "zh-CN"),
    ("ot-sections", "旧约·段读", "ot-sections.json", "zh-CN"),
]


# ──────────────────────────── engs → book_index 映射 ────────────────

def build_engs_to_index(resource_dir: Path) -> Dict[str, int]:
    """从任意非主库版本 DB 的 main 表构建 engs -> book_index (1-66) 映射。
    所有版本 DB 的 main 表结构相同，engs 值一致。"""
    for ver in BIBLE_VERSIONS:
        if ver["lang"] == "zh-rcv":
            continue  # zh_rcv.db 没有 main 表
        db_path = resource_dir / ver["db"]
        if not db_path.exists():
            continue
        conn = sqlite3.connect(str(db_path))
        try:
            rows = conn.execute("SELECT id, engs FROM main ORDER BY id").fetchall()
            if rows:
                return {str(engs): int(idx) for idx, engs in rows}
        finally:
            conn.close()
    return {}


def build_index_to_engs(resource_dir: Path) -> Dict[int, str]:
    """反向映射：book_index (1-66) -> engs。"""
    m = build_engs_to_index(resource_dir)
    return {v: k for k, v in m.items()}


# ──────────────────────────── 数据结构 ────────────────────────────

@dataclass(frozen=True)
class VerseKey:
    book_index: int
    chapter: int
    section: int


# ──────────────────────────── 工具函数 ────────────────────────────

def cn_num_to_int(s: str) -> Optional[int]:
    """将中文数字或阿拉伯数字字符串转为整数。"""
    if s is None:
        return None
    s = s.strip()
    if not s:
        return None
    if s.isdigit():
        return int(s)

    cn = {
        "零": 0, "〇": 0, "○": 0,
        "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
        "六": 6, "七": 7, "八": 8, "九": 9,
    }

    if "百" in s or "十" in s:
        val = 0
        if "百" in s:
            i = s.index("百")
            h = s[:i]
            val += (cn.get(h, 1) if h else 1) * 100
            s = s[i + 1:]
        if "十" in s:
            i = s.index("十")
            t = s[:i]
            val += (cn.get(t, 0) if t else 1) * 10
            s = s[i + 1:]
        for ch in s:
            val += cn.get(ch, 0)
        return val

    digits: List[int] = []
    for ch in s:
        d = cn.get(ch)
        if d is None:
            return None
        digits.append(d)
    if len(digits) == 1:
        return digits[0]
    if len(digits) == 2:
        return digits[0] * 10 + digits[1]
    if len(digits) == 3:
        return digits[0] * 100 + digits[1] * 10 + digits[2]
    return None


def load_book_acronym_map(conn: sqlite3.Connection) -> Dict[int, str]:
    """取 1..66 书卷简称，优先中文简称。"""
    rows = conn.execute(
        """
        SELECT book_index, acronym_name, name, _id
        FROM book_name
        WHERE book_index BETWEEN 1 AND 66
        ORDER BY book_index, _id
        """
    ).fetchall()

    grouped: Dict[int, List[Tuple[str, str]]] = defaultdict(list)
    for book_index, acronym_name, name, _id in rows:
        grouped[int(book_index)].append((str(acronym_name or ""), str(name or "")))

    result: Dict[int, str] = {}
    han_re = re.compile(r"[\u4e00-\u9fff]")

    for book_index in range(1, 67):
        candidates = grouped.get(book_index, [])
        if not candidates:
            result[book_index] = str(book_index)
            continue

        chosen = None
        for acro, _name in candidates:
            if han_re.search(acro):
                chosen = acro
                break
        if not chosen:
            chosen = candidates[0][0]
        result[book_index] = chosen

    return result


def load_book_full_name_map(conn: sqlite3.Connection) -> Dict[int, str]:
    """取 1..66 书卷全名，优先中文全名。"""
    rows = conn.execute(
        """
        SELECT book_index, name, _id
        FROM book_name
        WHERE book_index BETWEEN 1 AND 66
        ORDER BY book_index, _id
        """
    ).fetchall()

    grouped: Dict[int, List[str]] = defaultdict(list)
    for book_index, name, _id in rows:
        grouped[int(book_index)].append(str(name or ""))

    result: Dict[int, str] = {}
    han_re = re.compile(r"[\u4e00-\u9fff]")

    for book_index in range(1, 67):
        candidates = grouped.get(book_index, [])
        if not candidates:
            result[book_index] = str(book_index)
            continue
        chosen = None
        for name in candidates:
            if han_re.search(name):
                chosen = name
                break
        if not chosen:
            chosen = candidates[0]
        result[book_index] = chosen

    return result


def build_book_token_map(book_map: Dict[int, str]) -> Dict[str, str]:
    """构造串珠文本里的书卷识别映射。"""
    token_map: Dict[str, str] = {}
    for _idx, abbr in book_map.items():
        token_map[abbr] = abbr

    aliases = {
        # 注意：不添加 "约一"→"约壹"、"约二"→"约贰"、"约三"→"约叁" 的别名
        # 因为串珠原文中 "约一3" 表示 约翰福音(约) 第一章(一) 第3节，
        # 而非 约翰一书(约壹)；DB原文中 1/2/3 John 始终用 约壹/约贰/约叁
        "约壹": "约壹",
        "约贰": "约贰",
        "约叁": "约叁",
        "王上": "王上", "王下": "王下",
        "撒上": "撒上", "撒下": "撒下",
        "代上": "代上", "代下": "代下",
        "林前": "林前", "林后": "林后",
        "帖前": "帖前", "帖后": "帖后",
        "提前": "提前", "提后": "提后",
        "彼前": "彼前", "彼后": "彼后",
    }
    token_map.update(aliases)
    return token_map


def normalize_xrefs(raw: str, token_map: Dict[str, str]) -> str:
    """将串珠原文尽量归一为 '书1:1,书1:2' 形式。"""
    if not raw:
        return ""

    text = raw.strip()
    text = re.sub(r"^[参见]\s*", "", text)
    text = (
        text.replace("，", ",")
        .replace("；", ",")
        .replace("、", ",")
        .replace("。", "")
        .replace("：", ":")
        .replace("～", "-")
    )

    parts = [p.strip() for p in text.split(",") if p.strip()]
    out: List[str] = []
    cur_book: Optional[str] = None
    cur_chapter: Optional[int] = None

    tokens = sorted(token_map.keys(), key=len, reverse=True)

    for part in parts:
        p = re.sub(r"^[参见]\s*", "", part)
        if not p:
            continue

        book = None
        for tk in tokens:
            if p.startswith(tk):
                book = token_map[tk]
                p = p[len(tk):]
                break

        if book:
            cur_book = book

        m = re.match(
            r"^([一二三四五六七八九十百零〇○\d]+):"
            r"([一二三四五六七八九十百零〇○\d]+"
            r"(?:-[一二三四五六七八九十百零〇○\d]+)?)$",
            p,
        )
        if m:
            ch = cn_num_to_int(m.group(1))
            if ch is None:
                out.append(part)
                continue
            cur_chapter = ch
            vr = m.group(2)
            if "-" in vr:
                a, b = vr.split("-", 1)
                va = cn_num_to_int(a)
                vb = cn_num_to_int(b)
                if va is None or vb is None or not cur_book:
                    out.append(part)
                else:
                    out.append(f"{cur_book}{ch}:{va}-{vb}")
            else:
                vv = cn_num_to_int(vr)
                if vv is None or not cur_book:
                    out.append(part)
                else:
                    out.append(f"{cur_book}{ch}:{vv}")
            continue

        m = re.match(
            r"^([一二三四五六七八九十百零〇○]+)"
            r"(\d+(?:-\d+)?[上中下]?)$",
            p,
        )
        if m and cur_book:
            ch = cn_num_to_int(m.group(1))
            if ch is not None:
                cur_chapter = ch
                vr = m.group(2)
                mod = ""
                if vr and vr[-1] in "上中下":
                    mod = vr[-1]
                    vr = vr[:-1]
                if "-" in vr:
                    a, b = vr.split("-", 1)
                    va = cn_num_to_int(a)
                    vb = cn_num_to_int(b)
                    if va is not None and vb is not None:
                        out.append(f"{cur_book}{ch}:{va}-{vb}")
                        continue
                else:
                    vv = cn_num_to_int(vr)
                    if vv is not None:
                        out.append(f"{cur_book}{ch}:{vv}{mod}")
                        continue

        m = re.match(
            r"^(\d+)"
            r"([一二三四五六七八九十百零〇○]+"
            r"(?:-[一二三四五六七八九十百零〇○]+)?)$",
            p,
        )
        if m and cur_book:
            ch = cn_num_to_int(m.group(1))
            if ch is not None:
                cur_chapter = ch
                vr = m.group(2)
                if "-" in vr:
                    a, b = vr.split("-", 1)
                    va = cn_num_to_int(a)
                    vb = cn_num_to_int(b)
                    if va is not None and vb is not None:
                        out.append(f"{cur_book}{ch}:{va}-{vb}")
                        continue
                else:
                    vv = cn_num_to_int(vr)
                    if vv is not None:
                        out.append(f"{cur_book}{ch}:{vv}")
                        continue

        m = re.match(
            r"^([一二三四五六七八九十百零〇○\d]+"
            r"(?:-[一二三四五六七八九十百零〇○\d]+)?)$",
            p,
        )
        if m and cur_book and cur_chapter is not None:
            vr = m.group(1)
            if "-" in vr:
                a, b = vr.split("-", 1)
                va = cn_num_to_int(a)
                vb = cn_num_to_int(b)
                if va is not None and vb is not None:
                    out.append(f"{cur_book}{cur_chapter}:{va}-{vb}")
                    continue
            else:
                vv = cn_num_to_int(vr)
                if vv is not None:
                    out.append(f"{cur_book}{cur_chapter}:{vv}")
                    continue

        out.append(part)

    return ",".join(out)


def apply_markers(
    verse_text: str,
    note_rows: Iterable[Tuple[int, int]],
    bead_rows: Iterable[Tuple[int, str]],
) -> str:
    """将 {seq} / [letter] 按 location 插入经文中。"""
    if not verse_text:
        return verse_text

    events: Dict[int, List[Tuple[int, str]]] = defaultdict(list)

    for location, seq in note_rows:
        if location is None or seq is None:
            continue
        events[int(location)].append((0, "{" + str(seq) + "}"))

    for location, letter in bead_rows:
        if location is None or letter is None:
            continue
        events[int(location)].append((1, "[" + str(letter) + "]"))

    chars = list(verse_text)
    out: List[str] = []

    for i, ch in enumerate(chars, start=1):
        if i in events:
            for _prio, token in sorted(events[i], key=lambda x: x[0]):
                out.append(token)
        out.append(ch)

    tail_positions = [p for p in events.keys() if p > len(chars)]
    for p in sorted(tail_positions):
        for _prio, token in sorted(events[p], key=lambda x: x[0]):
            out.append(token)

    return "".join(out)


# ──────────────────────── 数据预加载 ─────────────────────────

def _preload_note_refs(
    conn: sqlite3.Connection,
    parser,
) -> Dict[int, List[dict]]:
    """预解析注解内的引经区间（来自 footnote_link 表，权威 APK 导入）。

    返回 { footnote._id: [ {s,e,r,x,q} ] }：
      s/e = 注文内字符区间（0-based，end 排他）
      r   = 逗号分隔的规范化引用串（显示/复制用，如 "弗1:10,弗3:9"）
      x   = 结构化区间 [b1,c1,v1,u1,b2,c2,v2,u2]（前端检索用，见 _build_ref_ranges）
      q   = 区间可信度 0-4（0 文本锚定 … 4 文本缺失回填）
    """
    out: Dict[int, List[dict]] = defaultdict(list)
    try:
        rows = conn.execute(
            """
            SELECT book_index, chapter, note_id, start, end, quality, text
            FROM footnote_link
            ORDER BY note_id, start
            """
        ).fetchall()
    except sqlite3.Error:
        return {}   # 未导入 footnote_link 的数据库：优雅降级

    for b, ch, note_id, start, end, quality, text in rows:
        raw = str(text or "")
        refs = _format_refs(parser, int(b), int(ch), raw)
        if not refs:
            continue
        rngs = _build_ref_ranges(parser, int(b), int(ch), raw)
        item = {
            "s": int(start),
            "e": int(end),
            "r": refs,
            "q": int(quality or 0),
        }
        if rngs:                              # 源区间被截断时可为空，此时前端回退到引用串
            item["x"] = _encode_ranges(rngs)
        out[int(note_id)].append(item)
    return dict(out)


def _format_refs(parser, book: int, chapter: int, text: str) -> str:
    """把区间文本解析成前端可直接使用的引用串（与 data-refs 同款语法）。"""
    if parser is None or not text:
        return ""
    try:
        result = parser.parse(text, book, chapter)
    except Exception:
        return ""
    parts: List[str] = []
    for r in result.refs:
        if not parser.valid(r):
            continue
        acr = parser.books.get(r.book, ("", str(r.book), 1))[1]
        if r.v1 == 0:  # 整章；诗篇篇题（part=标题）只显示标题行
            if r.chapter2:
                token = f"{acr}{r.chapter}-{acr}{r.chapter2}"
            elif r.part == "标题":
                token = f"{acr}{r.chapter}:0T"
            else:
                token = f"{acr}{r.chapter}:0"
        else:
            token = f"{acr}{r.chapter}:{r.v1}"
            if r.chapter2:                      # 跨章节区间：书c:v1-书c2:v2
                token += (f"{r.part or ''}-{acr}{r.chapter2}:{r.v2}")
            elif r.v2 and r.v2 != r.v1:
                token += f"-{r.v2}"
            if not r.chapter2 and r.part in ("上", "中", "下"):
                token += r.part
        if token not in parts:
            parts.append(token)
    return ",".join(parts)


_REF_UNIT = {"上": 1, "下": 2}   # 与 content.flag 一致；中无数据，按整节处理


def _build_ref_ranges(parser, book: int, chapter: int, text: str) -> List[List[int]]:
    """把区间文本解析成结构化区间（与权威 App 的「书/章/节」三元组模型对齐）。

    变长编码（省体积）：
      [b,c]                仅章标题（诗篇篇题，:0 行）
      [b,c,v]              单节（v=0 为整章）
      [b,c,v,u]            单节 + 半节修饰（u=1 上 / 2 下）
      [b,c,v1,b2,c2,v2]    区间（端点 v=0 表示章边界）
      [b1,c1,v1,u1,b2,c2,v2,u2]  带半节修饰的区间
    前端按 book*1e6+chapter*1e3+verse 的整数键做区间过滤，整章/跨章/跨卷
    都由同一段比较覆盖，不依赖引用串的书写形态；普通区间不含 :0 标题行。
    """
    if parser is None or not text:
        return []
    try:
        result = parser.parse(text, book, chapter)
    except Exception:
        return []
    out: List[List[int]] = []
    for r in result.refs:
        if not parser.valid(r):
            continue
        u1 = _REF_UNIT.get(r.part or "", 0)
        if r.v1 == 0 and r.part == "标题" and not r.chapter2:
            rng = [r.book, r.chapter]       # 仅篇题
        elif r.v1 == 0:                     # 整章 / 章范围
            b2 = r.book
            c2 = r.chapter2 or r.chapter
            rng = [r.book, r.chapter, 0] if c2 == r.chapter else \
                  [r.book, r.chapter, 0, b2, c2, 0]
        elif r.chapter2:                    # 跨章节区间
            rng = [r.book, r.chapter, r.v1, u1,
                   r.book, r.chapter2, r.v2 or 0, 0]
            if not rng[3] and not rng[7]:
                rng = [rng[0], rng[1], rng[2], rng[4], rng[5], rng[6]]
        elif r.v2 and r.v2 != r.v1:         # 同章节区间
            rng = [r.book, r.chapter, r.v1, r.book, r.chapter, r.v2]
            if u1:
                rng = [r.book, r.chapter, r.v1, u1, r.book, r.chapter, r.v2, 0]
        else:                               # 单节
            rng = [r.book, r.chapter, r.v1, u1] if u1 else [r.book, r.chapter, r.v1]
        if r.v1 and r.v2 and r.v2 < r.v1 and not r.chapter2:
            continue                        # 源区间被截断（如「腓二5～1」）：与权威 App 的 BETWEEN 结果一致为空
        if rng not in out:
            out.append(rng)
    return out


def _encode_ranges(ranges: List[List[int]]) -> str:
    """把区间数组编码为紧凑字符串："b,c,v;b,c,v1,b2,c2,v2"（缩进输出下体积最小）。"""
    return ";".join(",".join(str(n) for n in rng) for rng in ranges)


def _preload_footnotes(
    conn: sqlite3.Connection,
) -> Tuple[
    Dict[Tuple[int, int, int, int], List[Tuple[int, int]]],
    Dict[VerseKey, Dict[str, str]],
    Dict[VerseKey, Dict[str, int]],
]:
    """预取全部 footnote 数据，返回 (标记映射, 注解内容映射, 注文 _id 映射)。"""
    footnote_by_flag: Dict[Tuple[int, int, int, int], List[Tuple[int, int]]] = defaultdict(list)
    notes_by_base: Dict[VerseKey, Dict[str, str]] = defaultdict(dict)
    noteid_by_base: Dict[VerseKey, Dict[str, int]] = defaultdict(dict)

    rows = conn.execute(
        """
        SELECT _id, book_index, chapter, section, flag, location, seq, note
        FROM footnote
        ORDER BY book_index, chapter, section, flag, seq, location
        """
    ).fetchall()
    for nid, b, ch, sec, flag, loc, seq, note in rows:
        key_flag = (int(b), int(ch), int(sec), int(flag))
        if loc is not None and seq is not None:
            footnote_by_flag[key_flag].append((int(loc), int(seq)))
        if note is not None:
            note_text = str(note).strip()
            if note_text:
                base = VerseKey(int(b), int(ch), int(sec))
                notes_by_base[base][str(seq)] = note_text
                if nid is not None:
                    noteid_by_base[base][str(seq)] = int(nid)

    return footnote_by_flag, notes_by_base, noteid_by_base


def _preload_beads(
    conn: sqlite3.Connection,
    token_map: Dict[str, str],
    do_normalize: bool,
    ref_parser=None,
) -> Tuple[
    Dict[Tuple[int, int, int, int], List[Tuple[int, str]]],
    Dict[VerseKey, Dict[str, str]],
    Dict[VerseKey, Dict[str, Dict[str, object]]],
]:
    """预取全部 bead 数据，返回 (标记映射, 串珠内容映射, 权威引用映射)。

    串珠内容（bead 字段）保持既有归一化行为；
    权威引用映射形如 {base: {seq: {"r": "约1:1,约1:2", "x": "43,1,1;..."}}}，
    由 ref_link_parser 解析原文得到，前端用 x 做区间检索。
    """
    bead_by_flag: Dict[Tuple[int, int, int, int], List[Tuple[int, str]]] = defaultdict(list)
    xrefs_by_base: Dict[VerseKey, Dict[str, str]] = defaultdict(dict)
    bead_refs_by_base: Dict[VerseKey, Dict[str, Dict[str, object]]] = defaultdict(dict)

    rows = conn.execute(
        """
        SELECT book_index, chapter, section, flag, location, seq, bead
        FROM bead
        ORDER BY book_index, chapter, section, flag, seq, location
        """
    ).fetchall()
    for b, ch, sec, flag, loc, seq, bead_text in rows:
        key_flag = (int(b), int(ch), int(sec), int(flag))
        if loc is not None and seq is not None:
            bead_by_flag[key_flag].append((int(loc), str(seq)))
        if bead_text is not None:
            raw = str(bead_text).strip()
            if raw:
                base = VerseKey(int(b), int(ch), int(sec))
                text = normalize_xrefs(raw, token_map) if do_normalize else raw
                xrefs_by_base[base][str(seq)] = text
                refs = _format_refs(ref_parser, int(b), int(ch), raw)
                if refs:
                    rngs = _build_ref_ranges(ref_parser, int(b), int(ch), raw)
                    bead_refs_by_base[base][str(seq)] = {
                        "r": refs,
                        "x": _encode_ranges(rngs) if rngs else "",
                    }

    return bead_by_flag, xrefs_by_base, bead_refs_by_base


def _get_verse_markers(
    b: int, ch: int, sec: int, flag: int,
    footnote_by_flag: Dict,
    bead_by_flag: Dict,
) -> Tuple[List[Tuple[int, int]], List[Tuple[int, str]]]:
    """获取某节经文的所有标记（注解 + 串珠），处理 flag 合并。"""
    note_rows = list(footnote_by_flag.get((b, ch, sec, flag), []))
    if flag != 0:
        note_rows.extend(footnote_by_flag.get((b, ch, sec, 0), []))

    bead_rows = list(bead_by_flag.get((b, ch, sec, flag), []))
    if flag != 0:
        bead_rows.extend(bead_by_flag.get((b, ch, sec, 0), []))

    return note_rows, bead_rows


# ──────────────────────── 导出：全局 JSON ─────────────────────────

def export_global_json(
    conn: sqlite3.Connection,
    out_dir: Path,
    book_map: Dict[int, str],
    token_map: Dict[str, str],
    footnote_by_flag: Dict,
    notes_by_base: Dict,
    bead_by_flag: Dict,
    xrefs_by_base: Dict,
) -> None:
    """导出 bible-text.json, bible-notes.json, bible-xrefs.json。"""

    # ---- bible-text.json ----
    bible_text: Dict[str, str] = {}
    content_rows = conn.execute(
        """
        SELECT book_index, chapter, section, flag, content
        FROM content
        ORDER BY book_index, chapter, section, flag
        """
    ).fetchall()

    for b, ch, sec, flag, content in content_rows:
        b, ch, sec, flag = int(b), int(ch), int(sec), int(flag)
        verse = str(content or "")

        suffix = ""
        if flag == 1:
            suffix = "上"
        elif flag == 2:
            suffix = "下"
        elif flag == 3:
            suffix = "中"

        book_abbr = book_map.get(b, str(b))
        key = f"{book_abbr}{ch}:{sec}{suffix}"

        note_rows, bead_rows = _get_verse_markers(
            b, ch, sec, flag, footnote_by_flag, bead_by_flag,
        )
        bible_text[key] = apply_markers(verse, note_rows, bead_rows)

    # ---- bible-notes.json ----
    bible_notes: Dict[str, List[str]] = {}
    for base, seq_map in notes_by_base.items():
        if not seq_map:
            continue
        book_abbr = book_map.get(base.book_index, str(base.book_index))
        key = f"{book_abbr}{base.chapter}:{base.section}"
        sorted_items = sorted(seq_map.items(), key=lambda kv: int(kv[0]))
        bible_notes[key] = [v for _, v in sorted_items]

    # ---- bible-xrefs.json ----
    bible_xrefs: Dict[str, Dict[str, str]] = {}
    for base, seq_map in xrefs_by_base.items():
        if not seq_map:
            continue
        book_abbr = book_map.get(base.book_index, str(base.book_index))
        key = f"{book_abbr}{base.chapter}:{base.section}"
        sorted_items = sorted(seq_map.items(), key=lambda kv: kv[0])
        bible_xrefs[key] = {k: v for k, v in sorted_items}

    # ---- 写入 ----
    _write_json(out_dir / "bible-text.json", bible_text)
    _write_json(out_dir / "bible-notes.json", bible_notes)
    _write_json(out_dir / "bible-xrefs.json", bible_xrefs)

    print(f"  bible-text.json   : {len(bible_text)} 节")
    print(f"  bible-notes.json  : {len(bible_notes)} 节")
    print(f"  bible-xrefs.json  : {len(bible_xrefs)} 节")


# ──────────────────────── 导出：书卷名映射 ────────────────────────

def export_books_json(
    out_dir: Path,
    book_acronym_map: Dict[int, str],
    book_full_name_map: Dict[int, str],
) -> None:
    """导出 bible-books.json：书卷名映射。"""
    books = []
    for idx in range(1, 67):
        books.append({
            "index": idx,
            "acronym": book_acronym_map.get(idx, str(idx)),
            "name": book_full_name_map.get(idx, str(idx)),
        })

    _write_json(out_dir / "bible-books.json", books)
    print(f"  bible-books.json  : {len(books)} 卷")


# ──────────────────────── 导出：按书卷分片 ────────────────────────

def export_shard_json(
    conn: sqlite3.Connection,
    out_dir: Path,
    book_acronym_map: Dict[int, str],
    book_full_name_map: Dict[int, str],
    footnote_by_flag: Dict,
    notes_by_base: Dict,
    bead_by_flag: Dict,
    xrefs_by_base: Dict,
    noteid_by_base: Optional[Dict] = None,
    refs_by_note_id: Optional[Dict[int, List[dict]]] = None,
    ref_parser=None,
    bead_refs_by_base: Optional[Dict] = None,
) -> None:
    """按 66 卷书分别导出 JSON 文件：bible/01.json ~ bible/66.json。"""
    shard_dir = out_dir / "bible"
    shard_dir.mkdir(parents=True, exist_ok=True)

    # 预加载全部经文
    content_rows = conn.execute(
        """
        SELECT book_index, chapter, section, flag, content
        FROM content
        ORDER BY book_index, chapter, section, flag
        """
    ).fetchall()

    # 按 book_index 分组
    content_by_book: Dict[int, List[Tuple[int, int, int, str]]] = defaultdict(list)
    for b, ch, sec, flag, content in content_rows:
        content_by_book[int(b)].append((int(ch), int(sec), int(flag), str(content or "")))

    for book_idx in range(1, 67):
        book_data = _build_book_shard(
            book_idx,
            book_acronym_map,
            book_full_name_map,
            content_by_book.get(book_idx, []),
            footnote_by_flag,
            notes_by_base,
            bead_by_flag,
            xrefs_by_base,
            noteid_by_base,
            refs_by_note_id,
            ref_parser,
            bead_refs_by_base,
        )
        filename = f"{book_idx:02d}.json"
        _write_json(shard_dir / filename, book_data)

    print(f"  bible/*.json      : 66 个分片文件")


def _build_book_shard(
    book_idx: int,
    book_acronym_map: Dict[int, str],
    book_full_name_map: Dict[int, str],
    verses: List[Tuple[int, int, int, str]],
    footnote_by_flag: Dict,
    notes_by_base: Dict,
    bead_by_flag: Dict,
    xrefs_by_base: Dict,
    noteid_by_base: Optional[Dict] = None,
    refs_by_note_id: Optional[Dict[int, List[dict]]] = None,
    ref_parser=None,
    bead_refs_by_base: Optional[Dict] = None,
) -> dict:
    """构建单卷书的数据对象。"""
    # 按章节组织经文
    chapters_map: Dict[int, List[dict]] = defaultdict(list)

    for ch, sec, flag, content in verses:
        note_rows, bead_rows = _get_verse_markers(
            book_idx, ch, sec, flag, footnote_by_flag, bead_by_flag,
        )
        marked_content = apply_markers(content, note_rows, bead_rows)

        # 获取该节的注解
        base = VerseKey(book_idx, ch, sec)
        footnotes = []
        seq_map = notes_by_base.get(base, {})
        for seq_str in sorted(seq_map.keys(), key=lambda s: int(s)):
            note_text = seq_map[seq_str]
            # 找到对应的 location
            loc = _find_note_location(
                book_idx, ch, sec, flag, int(seq_str), footnote_by_flag,
            )
            note_obj = {
                "seq": int(seq_str),
                "location": loc,
                "note": note_text,
            }
            if refs_by_note_id and noteid_by_base:
                nid = noteid_by_base.get(base, {}).get(str(seq_str))
                refs = refs_by_note_id.get(nid) if nid is not None else None
                if refs:
                    note_obj["refs"] = refs
            footnotes.append(note_obj)

        # 获取该节的串珠
        beads = []
        xref_map = xrefs_by_base.get(base, {})
        for seq_str in sorted(xref_map.keys()):
            bead_text = xref_map[seq_str]
            loc = _find_bead_location(
                book_idx, ch, sec, flag, seq_str, bead_by_flag,
            )
            bead_obj = {
                "seq": seq_str,
                "location": loc,
                "bead": bead_text,
            }
            if bead_refs_by_base:
                xentry = bead_refs_by_base.get(base, {}).get(seq_str)
            elif ref_parser is not None:
                xentry = {"r": _format_refs(ref_parser, book_idx, ch, bead_text),
                          "x": _encode_ranges(_build_ref_ranges(ref_parser, book_idx, ch, bead_text))}
            else:
                xentry = None
            if xentry and xentry.get("r"):
                bead_obj["xrefs"] = xentry["r"]
                if xentry.get("x"):
                    bead_obj["xr"] = xentry["x"]
            beads.append(bead_obj)

        verse_obj = {
            "section": sec,
            "flag": flag,
            "content": marked_content,
        }
        if footnotes:
            verse_obj["footnotes"] = footnotes
        if beads:
            verse_obj["beads"] = beads

        chapters_map[ch].append(verse_obj)

    # 构建 chapters 数组
    chapters = []
    for ch_num in sorted(chapters_map.keys()):
        chapters.append({
            "chapter": ch_num,
            "verses": chapters_map[ch_num],
        })

    return {
        "book_index": book_idx,
        "book_name": book_full_name_map.get(book_idx, str(book_idx)),
        "book_acronym": book_acronym_map.get(book_idx, str(book_idx)),
        "chapters": chapters,
    }


def _find_note_location(
    b: int, ch: int, sec: int, flag: int, seq: int,
    footnote_by_flag: Dict,
) -> Optional[int]:
    """从 footnote_by_flag 中查找指定 seq 的 location。"""
    for f in ([flag, 0] if flag != 0 else [0]):
        entries = footnote_by_flag.get((b, ch, sec, f), [])
        for loc, s in entries:
            if s == seq:
                return loc
    return None


def _find_bead_location(
    b: int, ch: int, sec: int, flag: int, seq: str,
    bead_by_flag: Dict,
) -> Optional[int]:
    """从 bead_by_flag 中查找指定 seq 的 location。"""
    for f in ([flag, 0] if flag != 0 else [0]):
        entries = bead_by_flag.get((b, ch, sec, f), [])
        for loc, s in entries:
            if s == seq:
                return loc
    return None


# ──────────────────────── 导出：读经计划 ──────────────────────────

# ──────────────────────── 导出：多版本经文 ────────────────────────

def _parse_unv_strongs(
    text: str,
    hebrew_orig: dict,
    greek_orig: dict,
    is_ot: bool,
    keep_chinese: bool = False,
) -> str:
    """从 unv 表文本解析 Strong's 标签，插入原文注释。

    keep_chinese=True  (he-el)：保留中文，如 '起初(H7225 רֵאשִׁית) 神(H430 אֹלִהים)...'
    keep_chinese=False (he-orig)：剥离中文，如 '(H7225 רֵאשִׁית) (H430 אֹלִהים)...'

    unv 文本含嵌入式 Strong's 标签：
      <WH07225>  — 希伯来 Strong's H7225
      <WAH09002> — 带前缀 A 的希伯来 Strong's H9002
      <WG2424>   — 希腊 Strong's G2424
      <WTH8804>  — 希伯来形态码 H8804
      <WTG5681>  — 希腊形态码 G5681
      {<WH0853>} — 花括号包裹的补充词
    """
    prefix_char = 'H' if is_ot else 'G'
    dict_lookup = hebrew_orig if is_ot else greek_orig

    tag_re = re.compile(r'\{?<W([A-Z]+?)(\d+)[^>]*>\}?')

    parts: List[str] = []
    last_end = 0
    for m in tag_re.finditer(text):
        # keep_chinese 时保留标签之间的中文文本
        if keep_chinese:
            chinese = text[last_end:m.start()].strip()
            if chinese:
                parts.append(chinese)

        tag_type = m.group(1)
        sn_num = m.group(2)
        # 去除前导零以匹配词典表键（unv 标签含填充如 07225，词典存为 7225）
        sn_clean = sn_num.lstrip('0') or '0'

        # H/AH → 希伯来 Strong's；G → 希腊 Strong's
        is_strongs = tag_type in ('H', 'AH', 'G')
        # TH/TG → 形态码（输出编号，不查词典）
        is_morph = tag_type in ('TH', 'TG')

        if is_strongs:
            orig = dict_lookup.get(sn_clean, '')
            segment = f"({prefix_char}{sn_clean} {orig})" if orig else f"({prefix_char}{sn_clean})"
            parts.append(segment)
        elif is_morph:
            # 形态码用方括号包裹，不查词典原文
            parts.append(f"[{prefix_char}{sn_clean}]")

        last_end = m.end()

    # keep_chinese 时处理尾部残余中文
    if keep_chinese:
        trailing = text[last_end:].strip()
        if trailing:
            parts.append(trailing)

    return ' '.join(parts)


# 标点字符正则（中文标点 + 希伯来/希腊标点 + 通用标点）
_PUNCT_RE = re.compile(
    r'[，。；：、！？「」『』“”‘’（）—…·\u0590-\u05CF\u05F3\u05F4'
    r'\u037E\u0387\u0374\u0375\u1FBD-\u1FC1\u1FCD-\u1FCF'
    r'\u1FDD-\u1FDF\u1FED-\u1FEF\u1FFD\u1FFE'
    r'\u2010-\u2027\u2030-\u205E\u2E00-\u2E4F\u3001-\u3003'
    r'\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB'
    r'\uFE30-\uFE4F\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40'
    r'\uFF5B-\uFF65]'
)
# CJK 统一汉字范围（用于过滤中文词字符）
_CJK_RE = re.compile(r'[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]')


def _parse_unv_pure_orig(
    text: str,
    hebrew_orig: dict,
    greek_orig: dict,
    is_ot: bool,
) -> str:
    """从 unv 表文本提取纯原文文字（含标点，无空格，无中文词）。
    输出格式: 'בּרֵאשִׁית，אֹלִהיםבָּרָא...'
    """
    dict_lookup = hebrew_orig if is_ot else greek_orig

    tag_re = re.compile(r'\{?<W([A-Z]+?)(\d+)[^>]*>\}?')

    parts: List[str] = []
    last_end = 0
    for m in tag_re.finditer(text):
        # 提取标签之间的标点（去除中文词字符和空格）
        between = text[last_end:m.start()]
        for ch in between:
            if _PUNCT_RE.match(ch):
                parts.append(ch)

        tag_type = m.group(1)
        sn_num = m.group(2)
        sn_clean = sn_num.lstrip('0') or '0'

        is_strongs = tag_type in ('H', 'AH', 'G')

        if is_strongs:
            orig = dict_lookup.get(sn_clean, '')
            if orig:
                parts.append(orig)

        last_end = m.end()

    # 尾部残余标点
    trailing = text[last_end:]
    for ch in trailing:
        if _PUNCT_RE.match(ch):
            parts.append(ch)

    return ''.join(parts)


def _load_dict_orig(conn) -> Tuple[dict, dict]:
    """从 hfhl/gfhl 词典表加载原文词典原形映射。
    返回: (hebrew_orig, greek_orig)，各为 {sn_str: orig}
    """
    hebrew_orig: Dict[str, str] = {}
    greek_orig: Dict[str, str] = {}
    cursor = conn.cursor()
    # 希伯来词典（取每个 hsnum 的第一条，保留带元音符号的原形）
    try:
        for hsnum, orig in cursor.execute(
            "SELECT hsnum, orig FROM hfhl WHERE orig IS NOT NULL AND orig != '' ORDER BY hsnum"
        ):
            sn = str(hsnum).strip()
            # orig 可能含多行（多种拼写形式），只取第一行（带元音符号的主形式）
            orig_first = orig.split('\n')[0].strip() if orig else ''
            if sn and orig_first and sn not in hebrew_orig:
                hebrew_orig[sn] = orig_first
    except Exception:
        pass
    # 希腊词典
    try:
        for gsnum, orig in cursor.execute(
            "SELECT gsnum, orig FROM gfhl WHERE orig IS NOT NULL AND orig != '' ORDER BY gsnum"
        ):
            sn = str(gsnum).strip()
            orig_first = orig.split('\n')[0].strip() if orig else ''
            if sn and orig_first and sn not in greek_orig:
                greek_orig[sn] = orig_first
    except Exception:
        pass
    return hebrew_orig, greek_orig


def export_version_text(
    ver: dict,
    out_dir: Path,
    resource_dir: Path,
    engs_to_index: Dict[str, int],
) -> None:
    """为非 CG 版本导出经文到 bible/{lang}/{NN}.json。
    对于 parsing 源（he-orig/he-el），解析 unv 表文本中的 Strong's 标签，
    结合 hfhl/gfhl 词典查找原文原形，生成 'H7225 רֵאשִׁית ...' 格式。
    """
    db_path = resource_dir / ver["db"]
    if not db_path.exists():
        print(f"  ⚠ 数据库不存在：{db_path}，跳过 {ver['lang']}")
        return

    use_parsing = ver.get("source") == "parsing"
    lang_dir = out_dir / "bible" / ver["lang"]
    lang_dir.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    try:
        hebrew_orig = greek_orig = {}
        if use_parsing:
            # 从 hfhl/gfhl 词典加载原文原形，用于 Strong's 标签查找
            hebrew_orig, greek_orig = _load_dict_orig(conn)

        cm = ver["col_map"]
        table = ver["table"]
        sql = f"SELECT {cm['book']}, {cm['chap']}, {cm['sec']}, {cm['text']} FROM {table} ORDER BY {cm['book']}, {cm['chap']}, {cm['sec']}"
        rows = conn.execute(sql).fetchall()

        # 按 book_index 分组
        books_data: Dict[int, List[Tuple[int, int, str]]] = defaultdict(list)
        for book_val, chap, sec, text in rows:
            if ver["col_map"]["book"] == "engs":
                book_idx = engs_to_index.get(str(book_val))
                if book_idx is None:
                    continue
            else:
                book_idx = int(book_val)
            books_data[book_idx].append((int(chap), int(sec), str(text or "")))

        book_range = range(1, 67)
        write_fn = _write_json_compact if use_parsing else _write_json

        for book_idx in book_range:
            verses = books_data.get(book_idx, [])
            chapters_map: Dict[int, List[dict]] = defaultdict(list)
            is_ot = book_idx <= 39
            for chap, sec, text in verses:
                if use_parsing:
                    # 从 unv 表文本解析 Strong's 标签，替换为原文
                    style = ver.get("style", "")
                    if style == "pure_orig":
                        # he-orig: 纯原文文字（含标点，无空格，无中文）
                        parsed = _parse_unv_pure_orig(text, hebrew_orig, greek_orig, is_ot)
                    else:
                        # he-el: 中文 + Strong's 注释
                        keep_chinese = ver.get("keep_chinese", False)
                        parsed = _parse_unv_strongs(text, hebrew_orig, greek_orig, is_ot, keep_chinese)
                    if parsed:
                        text = parsed
                    else:
                        # fallback：剥离 Strong's 标签
                        text = re.sub(r"<W[^>]+>", "", text)
                        text = text.replace("{}", "")
                elif ver.get("strip_strongs"):
                    text = re.sub(r"<W[^>]+>", "", text)
                    text = text.replace("{}", "")
                chapters_map[chap].append({
                    "section": sec,
                    "text": text,
                })
            chapters = []
            for ch_num in sorted(chapters_map.keys()):
                chapters.append({
                    "chapter": ch_num,
                    "verses": chapters_map[ch_num],
                })
            book_obj = {
                "book_index": book_idx,
                "chapters": chapters,
            }
            filename = f"{book_idx:02d}.json"
            write_fn(lang_dir / filename, book_obj)

        if use_parsing:
            print(f"  bible/{ver['lang']}/*.json : 66 个分片文件 ({ver['label']})")
        else:
            print(f"  bible/{ver['lang']}/*.json : 66 个分片文件 ({ver['label']})")
    finally:
        conn.close()


def export_versions_meta(versions: List[dict], out_dir: Path) -> None:
    """导出 bible-versions.json：版本元数据列表（含各版本分片总大小，供语言包管理显示）。"""
    meta = []
    for ver in versions:
        entry = {
            "lang": ver["lang"],
            "label": ver["label"],
            "hasNotes": ver["has_notes"],
            "hasXrefs": ver["has_xrefs"],
        }
        # 统计该版本分片目录总大小（主版本为 bible/ 根，其余为 bible/{lang}/）
        if ver["lang"] == "zh-rcv":
            ver_dir = out_dir / "bible"
        else:
            ver_dir = out_dir / "bible" / ver["lang"]
        if ver_dir.exists():
            total_bytes = sum(p.stat().st_size for p in ver_dir.glob("*.json"))
            entry["size"] = round(total_bytes / (1024 * 1024), 1)
        meta.append(entry)
    _write_json(out_dir / "bible-versions.json", meta)
    print(f"  bible-versions.json: {len(meta)} 个版本")


def export_book_names_i18n(resource_dir: Path) -> None:
    """从各版本 DB 提取书卷名，扩展 book-names-i18n.json。"""
    # 加载现有文件
    i18n_data: Dict[str, dict] = {}
    if I18N_JSON_PATH.exists():
        with open(I18N_JSON_PATH, "r", encoding="utf-8") as f:
            i18n_data = json.load(f)

    # 语言映射：zh-rcv/en-kjv 已有对应(zh-CN/en)，不覆盖
    lang_map = {
        "zh-rcv": None,
        "zh-cuv": "zh-cuv",
        "en-darby": "en-darby",
        "en-kjv": None,
        "en-rcv": "en-rcv",
        "ko-rcv": "ko-rcv",
        "zh-hant-rcv": "zh-hant-rcv",
        "zh-hant-cuv": "zh-hant-cuv",
    }

    for ver in BIBLE_VERSIONS:
        target_lang = lang_map.get(ver["lang"])
        if target_lang is None:
            continue

        db_path = resource_dir / ver["db"]
        if not db_path.exists():
            continue

        conn = sqlite3.connect(str(db_path))
        try:
            rows = conn.execute(
                "SELECT id, engs, engf, chineses, chinesef FROM main ORDER BY id"
            ).fetchall()
            lang_dict: Dict[str, dict] = {}
            for row_id, engs, engf, chineses, chinesef in rows:
                idx = str(int(row_id))
                if ver["lang"].startswith("en"):
                    lang_dict[idx] = {"short": str(engs), "full": str(engf or engs)}
                else:
                    short = str(chineses or engs)
                    full = str(chinesef or engf or engs)
                    lang_dict[idx] = {"short": short, "full": full}
            i18n_data[target_lang] = lang_dict
            print(f"  book-names-i18n [{target_lang}]: {len(lang_dict)} 卷")
        finally:
            conn.close()

    # 更新 src 目录下的原文件
    I18N_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    I18N_JSON_PATH.write_text(
        json.dumps(i18n_data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"  book-names-i18n.json: {len(i18n_data)} 种语言")


# ──────────────────────── 导出：读经计划 ──────────────────────────

def export_reading_plans(out_dir: Path, resource_dir: Path) -> None:
    """读取读经计划 JSON 文件并合并导出。"""
    plans = []
    for plan_id, plan_name, filename, lang in READING_PLAN_FILES:
        filepath = resource_dir / filename
        if not filepath.exists():
            print(f"  ⚠ 读经计划文件不存在：{filepath}")
            continue
        with open(filepath, "r", encoding="utf-8") as f:
            entries = json.load(f)
        plans.append({
            "id": plan_id,
            "name": plan_name,
            "lang": lang,
            "entries": entries,
        })

    data = {"plans": plans}
    _write_json(out_dir / "reading-plans.json", data)
    print(f"  reading-plans.json: {len(plans)} 个计划")


# ──────────────────────── 导出：书卷主题 ──────────────────────────

def export_bible_topics(db_path: Path, out_dir: Path) -> None:
    """导出 topic 表到 bible-topics.json：每卷书的主题。"""
    conn = sqlite3.connect(str(db_path))
    try:
        rows = conn.execute(
            "SELECT book_index, topic FROM topic ORDER BY book_index"
        ).fetchall()
        result: Dict[str, str] = {}
        for book_index, topic_text in rows:
            result[str(int(book_index))] = str(topic_text or "").strip()
        _write_json(out_dir / "bible-topics.json", result)
        print(f"  bible-topics.json : {len(result)} 卷")
    finally:
        conn.close()


# ──────────────────────── 导出：书卷简介 ──────────────────────────

def export_bible_intro(db_path: Path, out_dir: Path) -> None:
    """导出 book_intro 表到 bible-intro.json：每卷书的简介信息。
    type: 1=著者, 2=著时, 3=著地, 4=受者, 5-9=其他简介。"""
    conn = sqlite3.connect(str(db_path))
    try:
        rows = conn.execute(
            "SELECT book_index, type, intro FROM book_intro ORDER BY book_index, type"
        ).fetchall()
        result: Dict[str, Dict[str, str]] = {}
        for book_index, intro_type, intro_text in rows:
            bk = str(int(book_index))
            tp = str(int(intro_type))
            if bk not in result:
                result[bk] = {}
            result[bk][tp] = str(intro_text or "").strip()
        _write_json(out_dir / "bible-intro.json", result)
        print(f"  bible-intro.json  : {len(result)} 卷")
    finally:
        conn.close()


# ──────────────────────── 导出：书卷大纲 ──────────────────────────

def export_bible_outlines(db_path: Path, out_dir: Path) -> None:
    """导出 outline 表到 bible-outlines.json：每卷书每章的大纲。
    结构：{ "book_index": { "chapter": [{ "level": N, "text": "..." }, ...] } }
    每章条目按 section 排序，保留 level 层级。"""
    conn = sqlite3.connect(str(db_path))
    try:
        rows = conn.execute(
            "SELECT book_index, chapter, section, flag, level, outline "
            "FROM outline ORDER BY book_index, chapter, section, flag, level"
        ).fetchall()
        result: Dict[str, Dict[str, List[dict]]] = {}
        for book_index, chapter, section, flag, level, outline_text in rows:
            bk = str(int(book_index))
            ch = str(int(chapter))
            if bk not in result:
                result[bk] = {}
            if ch not in result[bk]:
                result[bk][ch] = []
            item = {
                "level": int(level),
                "text": str(outline_text or "").strip(),
                "section": int(section),
            }
            if int(flag) != 0:
                item["flag"] = int(flag)
            result[bk][ch].append(item)
        _write_json(out_dir / "bible-outlines.json", result)
        total_items = sum(
            len(items) for chapters in result.values() for items in chapters.values()
        )
        print(f"  bible-outlines.json: {len(result)} 卷, {total_items} 条")
    finally:
        conn.close()


# ──────────────────────── 导出：Strong's 词典 ──────────────────────

def export_strongs_dictionaries(resource_dir: Path, out_dir: Path) -> None:
    """从 strongs.db 导出希伯来/希腊文 Strong's 词典，合并为 strongs-dict.json。"""
    db_path = resource_dir / "strongs.db"
    if not db_path.exists():
        print("  ⚠ strongs.db 不存在，跳过词典导出")
        return

    conn = sqlite3.connect(str(db_path))
    try:
        result: Dict[str, dict] = {}

        # 希伯来词典 hfhl
        rows = conn.execute(
            "SELECT hsnum, txt, orig FROM hfhl WHERE txt IS NOT NULL AND txt != ''"
        ).fetchall()
        for hsnum, txt, orig in rows:
            sn = "H" + str(hsnum).strip()
            result[sn] = {"t": str(txt or "").strip(), "o": str(orig or "").strip()}
        he_count = len([k for k in result if k.startswith("H")])

        # 希腊词典 gfhl
        rows = conn.execute(
            "SELECT gsnum, txt, orig FROM gfhl WHERE txt IS NOT NULL AND txt != ''"
        ).fetchall()
        for gsnum, txt, orig in rows:
            sn = "G" + str(gsnum).strip()
            result[sn] = {"t": str(txt or "").strip(), "o": str(orig or "").strip()}
        el_count = len([k for k in result if k.startswith("G")])

        _write_json(out_dir / "strongs-dict.json", result)
        print(f"  strongs-dict.json : {len(result)} 条 (希伯来 {he_count} + 希腊 {el_count})")
    finally:
        conn.close()


# ──────────────────────── 导出：逐词解析数据 ─────────────────────────

def export_parsing_shards(resource_dir: Path, out_dir: Path,
                          engs_to_index: Dict[str, int]) -> None:
    """从 strongs.db 导出逐词解析数据，按书卷分片到 parsing/{NN}.json。"""
    db_path = resource_dir / "strongs.db"
    if not db_path.exists():
        print("  ⚠ strongs.db 不存在，跳过逐词解析导出")
        return

    parsing_dir = out_dir / "parsing"
    parsing_dir.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    try:
        # 收集所有解析数据：lparsing (OT 希伯来) + fhlwhparsing (NT 希腊)
        all_rows: Dict[int, Dict[int, Dict[int, list]]] = defaultdict(
            lambda: defaultdict(lambda: defaultdict(list))
        )

        for table_name in ("lparsing", "fhlwhparsing"):
            try:
                rows = conn.execute(
                    f"SELECT engs, chap, sec, wid, word, sn, pro, wform, orig, exp "
                    f"FROM {table_name} "
                    f"WHERE sn IS NOT NULL AND sn != '' "
                    f"ORDER BY engs, chap, sec, wid"
                ).fetchall()
            except sqlite3.OperationalError:
                continue  # 表不存在则跳过

            for engs, chap, sec, wid, word, sn, pro, wform, orig, exp in rows:
                book_idx = engs_to_index.get(str(engs))
                if book_idx is None:
                    continue
                word_obj: dict = {}
                if word: word_obj["w"] = str(word).strip()
                # 添加 H/G 前缀：OT(1-39)=希伯来=H，NT(40-66)=希腊=G
                sn_str = str(sn).strip()
                prefix = "H" if book_idx <= 39 else "G"
                word_obj["s"] = prefix + sn_str
                if pro: word_obj["p"] = str(pro).strip()
                if wform: word_obj["f"] = str(wform).strip()
                if orig: word_obj["o"] = str(orig).strip()
                if exp: word_obj["e"] = str(exp).strip()
                all_rows[book_idx][int(chap)][int(sec)].append(word_obj)

        # 按书卷分片写出
        count = 0
        for book_idx in range(1, 67):
            book_data = all_rows.get(book_idx)
            if not book_data:
                continue
            chapters: dict = {}
            for ch_num in sorted(book_data.keys()):
                ch_map: dict = {}
                for sec_num in sorted(book_data[ch_num].keys()):
                    ch_map[str(sec_num)] = book_data[ch_num][sec_num]
                chapters[str(ch_num)] = ch_map
            book_obj = {"book_index": book_idx, "chapters": chapters}
            _write_json(parsing_dir / f"{book_idx:02d}.json", book_obj)
            count += 1

        total_words = sum(
            len(words)
            for book in all_rows.values()
            for ch in book.values()
            for words in ch.values()
        )
        print(f"  parsing/*.json    : {count} 个分片文件, {total_words} 个词")
    finally:
        conn.close()


# ──────────────────────── 工具 ────────────────────────────────────

def _write_json(path: Path, data) -> None:
    """写入 JSON 文件（保留中文）。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _write_json_compact(path: Path, data) -> None:
    """写入压缩 JSON 文件（无多余空格/换行，保留中文）。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, separators=(',', ':')),
        encoding="utf-8",
    )


def _file_mb(p: Path) -> float:
    return p.stat().st_size / 1024.0 / 1024.0


# ──────────────────────── 主入口 ──────────────────────────────────

def export_all(db_path: str | Path, output_dir: str | Path, normalize_xref: bool = False) -> None:
    """完整导出流程：全局 JSON + 书卷名 + 分片 + 读经计划 + 多版本。"""
    db_path = Path(db_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if not db_path.exists():
        raise FileNotFoundError(f"数据库不存在：{db_path}")

    resource_dir = db_path.parent

    conn = sqlite3.connect(str(db_path))
    try:
        # 书卷名映射
        book_acronym_map = load_book_acronym_map(conn)
        book_full_name_map = load_book_full_name_map(conn)
        token_map = build_book_token_map(book_acronym_map)

        # 预加载 footnote / bead
        print("预加载数据...")
        footnote_by_flag, notes_by_base, noteid_by_base = _preload_footnotes(conn)

        # 预解析注解内引经区间（需要 footnote_link 表；缺表时自动降级为空）
        ref_parser = None
        refs_by_note_id: Dict[int, List[dict]] = {}
        try:
            from ref_link_parser import RefParser  # 同目录模块
            ref_parser = RefParser.from_project_db(str(db_path))
            refs_by_note_id = _preload_note_refs(conn, ref_parser)
            if refs_by_note_id:
                total_refs = sum(len(v) for v in refs_by_note_id.values())
                print(f"  注解引经区间：{total_refs} 个（{len(refs_by_note_id)} 条注）")
            else:
                print("  注解引经区间：无（footnote_link 为空或不存在）")
        except Exception as exc:  # 解析器或表缺失都不应阻断导出
            print(f"  注解引经区间：跳过（{exc}）")

        bead_by_flag, xrefs_by_base, bead_refs_by_base = _preload_beads(
            conn, token_map, normalize_xref, ref_parser,
        )
        if bead_refs_by_base:
            total = sum(len(v) for v in bead_refs_by_base.values())
            print(f"  串珠权威引用：{total} 条")

        print(f"导出到：{output_dir}")

        # 1. 全局 JSON（已移除：bible-text/notes/xrefs 与分片数据重复）
        # 注解和串珠数据已包含在 bible/{NN}.json 分片文件中

        # 2. 书卷名映射
        print("导出书卷名映射...")
        export_books_json(output_dir, book_acronym_map, book_full_name_map)

        # 3. 按书卷分片（原有路径 bible/{NN}.json）
        print("导出按书卷分片...")
        export_shard_json(
            conn, output_dir,
            book_acronym_map, book_full_name_map,
            footnote_by_flag, notes_by_base,
            bead_by_flag, xrefs_by_base,
            noteid_by_base, refs_by_note_id, ref_parser,
            bead_refs_by_base,
        )

        # 4. 读经计划
        print("导出读经计划...")
        export_reading_plans(output_dir, resource_dir)

        # 5. 多版本经文导出
        print("导出多版本经文...")
        engs_to_index = build_engs_to_index(resource_dir)
        for ver in BIBLE_VERSIONS:
            if ver["lang"] != "zh-rcv":  # CG 已经处理
                export_version_text(ver, output_dir, resource_dir, engs_to_index)

        # 6. 版本元数据
        print("导出版本元数据...")
        export_versions_meta(BIBLE_VERSIONS, output_dir)

        # 7. 书卷名国际化
        print("导出书卷名国际化...")
        export_book_names_i18n(resource_dir)

        # 8. 书卷主题
        print("导出书卷主题...")
        export_bible_topics(db_path, output_dir)

        # 9. 书卷简介
        print("导出书卷简介...")
        export_bible_intro(db_path, output_dir)

        # 10. 书卷大纲
        print("导出书卷大纲...")
        export_bible_outlines(db_path, output_dir)

        # 11. Strong's 词典
        print("导出 Strong's 词典...")
        export_strongs_dictionaries(resource_dir, output_dir)

        # 12. 逐词解析数据
        print("导出逐词解析数据...")
        export_parsing_shards(resource_dir, output_dir, engs_to_index)

        # 13. 文件大小汇总
        print("\n文件大小汇总：")
        for name in ["bible-books.json", "bible-versions.json", "reading-plans.json",
                      "bible-topics.json", "bible-intro.json", "bible-outlines.json",
                      "strongs-dict.json"]:
            p = output_dir / name
            if p.exists():
                print(f"  {name:25s} {_file_mb(p):8.2f} MB")

        shard_dir = output_dir / "bible"
        if shard_dir.exists():
            for sub in sorted(shard_dir.iterdir()):
                if sub.is_dir():
                    files = list(sub.glob("*.json"))
                    total = sum(f.stat().st_size for f in files)
                    print(f"  bible/{sub.name}/ ({len(files)} files)  {total / 1024 / 1024:8.2f} MB")
            top_files = list(shard_dir.glob("*.json"))
            if top_files:
                total = sum(f.stat().st_size for f in top_files)
                print(f"  bible/*.json ({len(top_files)} files)  {total / 1024 / 1024:8.2f} MB")

        parsing_dir = output_dir / "parsing"
        if parsing_dir.exists():
            pfiles = list(parsing_dir.glob("*.json"))
            if pfiles:
                total = sum(f.stat().st_size for f in pfiles)
                print(f"  parsing/*.json ({len(pfiles)} files)  {total / 1024 / 1024:8.2f} MB")

    finally:
        conn.close()


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="从圣经数据库导出 JSON 数据（支持多版本）")
    p.add_argument("--sqlite-db", type=Path, default=DEFAULT_SQLITE_DB,
                   help="SQLite 数据库路径（默认 resource/zh_rcv.db）")
    p.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR,
                   help="输出目录（默认 output/data）")
    p.add_argument("--normalize-xrefs", action="store_true",
                   help="启用串珠文本归一（启发式）")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    print(f"数据源：{args.sqlite_db}")
    export_all(args.sqlite_db, args.out_dir, normalize_xref=args.normalize_xrefs)


if __name__ == "__main__":
    main()
    print("\n[OK] 圣经数据导出完成")
