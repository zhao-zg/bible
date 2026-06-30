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
- bible/zh-ncv/{NN}.json   新译本版本分片
- bible-versions.json       版本元数据
- reading-plans.json        读经计划整合
- bible-topics.json         书卷主题（仅 CG）
- bible-intro.json          书卷简介（仅 CG）
- bible-outlines.json       书卷大纲（仅 CG）

用法：
    python export_bible_sql_json.py
    python export_bible_sql_json.py --sqlite-db path/to/CG.db --out-dir output/data
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
DEFAULT_SQLITE_DB = HERE / "resource" / "CG.db"
DEFAULT_OUT_DIR = HERE / "output" / "data"
RESOURCE_DIR = HERE / "resource"
I18N_JSON_PATH = HERE / "src" / "static" / "data" / "book-names-i18n.json"

BIBLE_VERSIONS = [
    {"db": "CG.db", "table": "content", "lang": "zh-rcv", "label": "恢复本",
     "has_notes": True, "has_xrefs": True,
     "col_map": {"book": "book_index", "chap": "chapter", "sec": "section", "text": "content"}},
    {"db": "2o.db", "table": "wlunv", "lang": "zh-cuv", "label": "和合本",
     "has_notes": False, "has_xrefs": False,
     "col_map": {"book": "engs", "chap": "chap", "sec": "sec", "text": "txt"}},
    {"db": "Zf.db", "table": "darby", "lang": "en-darby", "label": "Darby",
     "has_notes": False, "has_xrefs": False,
     "col_map": {"book": "engs", "chap": "chap", "sec": "sec", "text": "txt"}},
    {"db": "xy.db", "table": "nstrkjv", "lang": "en-kjv", "label": "KJV",
     "has_notes": False, "has_xrefs": False,
     "col_map": {"book": "engs", "chap": "chap", "sec": "sec", "text": "txt"}},
    {"db": "n5.db", "table": "nstrunv", "lang": "zh-ncv", "label": "新译本",
     "has_notes": False, "has_xrefs": False,
     "col_map": {"book": "engs", "chap": "chap", "sec": "sec", "text": "txt"}},
    {"db": "s_.db", "table": "unv", "lang": "he-el", "label": "词典",
     "has_notes": False, "has_xrefs": False,
     "col_map": {"book": "engs", "chap": "chap", "sec": "sec", "text": "txt"},
     "strip_strongs": False},
    {"db": "s_.db", "table": "unv", "lang": "he-orig", "label": "原文",
     "has_notes": False, "has_xrefs": False,
     "col_map": {"book": "engs", "chap": "chap", "sec": "sec", "text": "txt"},
     "strip_strongs": True},
]

READING_PLAN_FILES = [
    # (plan_id, plan_name, filename, lang)
    ("2k", "读经计划 A", "2k.json", "zh-CN"),
    ("LU", "读经计划 B", "LU.json", "zh-CN"),
    ("kO", "读经计划 C", "kO.json", "zh-CN"),
    ("zy", "读经计划 D", "zy.json", "zh-CN"),
]


# ──────────────────────────── engs → book_index 映射 ────────────────

def build_engs_to_index(resource_dir: Path) -> Dict[str, int]:
    """从任意非 CG 版本 DB 的 main 表构建 engs -> book_index (1-66) 映射。
    所有版本 DB 的 main 表结构相同，engs 值一致。"""
    for ver in BIBLE_VERSIONS:
        if ver["lang"] == "zh-rcv":
            continue  # CG.db 没有 main 表
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

def _preload_footnotes(
    conn: sqlite3.Connection,
) -> Tuple[
    Dict[Tuple[int, int, int, int], List[Tuple[int, int]]],
    Dict[VerseKey, Dict[str, str]],
]:
    """预取全部 footnote 数据，返回 (标记映射, 注解内容映射)。"""
    footnote_by_flag: Dict[Tuple[int, int, int, int], List[Tuple[int, int]]] = defaultdict(list)
    notes_by_base: Dict[VerseKey, Dict[str, str]] = defaultdict(dict)

    rows = conn.execute(
        """
        SELECT book_index, chapter, section, flag, location, seq, note
        FROM footnote
        ORDER BY book_index, chapter, section, flag, seq, location
        """
    ).fetchall()
    for b, ch, sec, flag, loc, seq, note in rows:
        key_flag = (int(b), int(ch), int(sec), int(flag))
        if loc is not None and seq is not None:
            footnote_by_flag[key_flag].append((int(loc), int(seq)))
        if note is not None:
            note_text = str(note).strip()
            if note_text:
                base = VerseKey(int(b), int(ch), int(sec))
                notes_by_base[base][str(seq)] = note_text

    return footnote_by_flag, notes_by_base


def _preload_beads(
    conn: sqlite3.Connection,
    token_map: Dict[str, str],
    do_normalize: bool,
) -> Tuple[
    Dict[Tuple[int, int, int, int], List[Tuple[int, str]]],
    Dict[VerseKey, Dict[str, str]],
]:
    """预取全部 bead 数据，返回 (标记映射, 串珠内容映射)。"""
    bead_by_flag: Dict[Tuple[int, int, int, int], List[Tuple[int, str]]] = defaultdict(list)
    xrefs_by_base: Dict[VerseKey, Dict[str, str]] = defaultdict(dict)

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
            text = str(bead_text).strip()
            if text:
                base = VerseKey(int(b), int(ch), int(sec))
                if do_normalize:
                    text = normalize_xrefs(text, token_map)
                xrefs_by_base[base][str(seq)] = text

    return bead_by_flag, xrefs_by_base


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
            footnotes.append({
                "seq": int(seq_str),
                "location": loc,
                "note": note_text,
            })

        # 获取该节的串珠
        beads = []
        xref_map = xrefs_by_base.get(base, {})
        for seq_str in sorted(xref_map.keys()):
            bead_text = xref_map[seq_str]
            loc = _find_bead_location(
                book_idx, ch, sec, flag, seq_str, bead_by_flag,
            )
            beads.append({
                "seq": seq_str,
                "location": loc,
                "bead": bead_text,
            })

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

def export_version_text(
    ver: dict,
    out_dir: Path,
    resource_dir: Path,
    engs_to_index: Dict[str, int],
) -> None:
    """为非 CG 版本导出经文到 bible/{lang}/{NN}.json。"""
    db_path = resource_dir / ver["db"]
    if not db_path.exists():
        print(f"  ⚠ 数据库不存在：{db_path}，跳过 {ver['lang']}")
        return

    lang_dir = out_dir / "bible" / ver["lang"]
    lang_dir.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    try:
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

        for book_idx in range(1, 67):
            verses = books_data.get(book_idx, [])
            chapters_map: Dict[int, List[dict]] = defaultdict(list)
            for chap, sec, text in verses:
                if ver.get("strip_strongs"):
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
            _write_json(lang_dir / f"{book_idx:02d}.json", book_obj)

        print(f"  bible/{ver['lang']}/*.json : 66 个分片文件 ({ver['label']})")
    finally:
        conn.close()


def export_versions_meta(versions: List[dict], out_dir: Path) -> None:
    """导出 bible-versions.json：版本元数据列表。"""
    meta = []
    for ver in versions:
        meta.append({
            "lang": ver["lang"],
            "label": ver["label"],
            "hasNotes": ver["has_notes"],
            "hasXrefs": ver["has_xrefs"],
        })
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
        "zh-ncv": "zh-ncv",
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
    """从 s_.db 导出希伯来/希腊文 Strong's 词典，合并为 strongs-dict.json。"""
    db_path = resource_dir / "s_.db"
    if not db_path.exists():
        print("  ⚠ s_.db 不存在，跳过词典导出")
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
    """从 s_.db 导出逐词解析数据，按书卷分片到 parsing/{NN}.json。"""
    db_path = resource_dir / "s_.db"
    if not db_path.exists():
        print("  ⚠ s_.db 不存在，跳过逐词解析导出")
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
        footnote_by_flag, notes_by_base = _preload_footnotes(conn)
        bead_by_flag, xrefs_by_base = _preload_beads(conn, token_map, normalize_xref)

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
                   help="SQLite 数据库路径（默认 resource/CG.db）")
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
    import os
    db_path = os.path.join(os.path.dirname(__file__), "resource", "CG.db")
    output_dir = os.path.join(os.path.dirname(__file__), "output", "data")
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(os.path.join(output_dir, "bible"), exist_ok=True)
    export_all(db_path, output_dir)
    print("\n[OK] 圣经数据导出完成")
