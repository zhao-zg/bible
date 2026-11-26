# -*- coding: utf-8 -*-
"""正版区间驱动的引经解析回归测试。

期望值取自正版 APK 字节码（Quote.start）对同一区间文本的实际结果
（见 docs/2026-11-23-apk-annotation-bead-reverse-engineering.md §19）。

    python -m unittest discover -s tests -p "test_*.py"
"""
import os
import sqlite3
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import export_bible_sql_json as E          # noqa: E402
from ref_link_parser import RefParser      # noqa: E402


class _Base(unittest.TestCase):
    DB = "zh_rcv.db"

    @classmethod
    def setUpClass(cls):
        path = os.path.join(ROOT, "resource", cls.DB)
        cls.conn = sqlite3.connect(path)
        cls.parser = RefParser.from_project_db(path)
        cls.ctx = E.build_region_context(cls.conn)

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def resolve(self, book, chapter, verse, text):
        """→ [(可点文字, x, n)]"""
        return [
            (text[it["s"]:it["e"]], it.get("x", ""), it.get("n", ""))
            for it in E.resolve_region(self.parser, book, chapter, verse, text, self.ctx)
        ]


class RegionGrammarTest(_Base):
    def test_explicit_book_is_never_shadowed_by_note_book(self):
        # 太1:11 注3：曾被错挂成 太22:28-30
        self.assertEqual(self.resolve(40, 1, 11, "耶二二28～30"),
                         [("耶二二28～30", "24,22,28,24,22,30", "")])

    def test_context_is_inherited_inside_a_region_only(self):
        self.assertEqual(self.resolve(1, 1, 1, "弗一10，三9，提前一4下"),
                         [("弗一10", "49,1,10", ""), ("三9", "49,3,9", ""), ("提前一4下", "54,1,4,2", "")])
        # 裸节号沿用区间内的运行章号，而不是注解所在章
        self.assertEqual(self.resolve(42, 13, 6, "十一29～32和42～52节"),
                         [("十一29～32", "42,11,29,42,11,32", ""), ("42～52节", "42,11,42,42,11,52", "")])

    def test_verse_with_notes(self):
        # 「X与注」= 经文 + X 范围内全部注解，并成一个可点区域
        self.assertEqual(self.resolve(1, 1, 2, "赛十四12～15与注"),
                         [("赛十四12～15与注", "23,14,12,23,14,15",
                           "23,14,12,1,0;23,14,13,1,0;23,14,13,2,0;23,14,15,1,0")])
        # 「X注」= 只看注解
        self.assertEqual(self.resolve(1, 3, 15, "见启十二1注"),
                         [("启十二1注", "", "66,12,1,1,0;66,12,1,2,0")])
        # 带注号：紧跟节号只出注解；「与」连接则经文、注解各自可点
        self.assertEqual(self.resolve(5, 23, 3, "创十九37注2一段"),
                         [("创十九37注2一段", "", "1,19,37,2,1")])
        self.assertEqual(self.resolve(45, 1, 20, "罗一20与注1，注2"),
                         [("罗一20", "45,1,20", ""), ("注1", "", "45,1,20,1,0"), ("注2", "", "45,1,20,2,0")])
        # 无锚点的「注N」指向注解所在节
        self.assertEqual(self.resolve(48, 5, 25, "注2"), [("注2", "", "48,5,25,2,0")])
        # 括注里的「见注N」：经文保留
        self.assertEqual(self.resolve(44, 8, 20, "来十39，（见注2，）太七13（见注3）"),
                         [("来十39", "58,10,39", ""), ("注2", "", "58,10,39,2,0"),
                          ("太七13", "40,7,13", ""), ("注3", "", "40,7,13,3,0")])
        self.assertEqual(self.resolve(3, 7, 29, "出二九26注1至28注1"),
                         [("出二九26注1至28注1", "", "2,29,26,1,0;2,29,26,2,0;2,29,27,1,0;2,29,28,1,0")])

    def test_range_with_unnumbered_note_follows_official_verse_only_behavior(self):
        for book, chapter, verse, text, expected in [
            (1, 49, 17, "见王上十二26～31注", "11,12,26,11,12,31"),
            (11, 11, 43, "王上三4～十一43上注", "11,3,4,0,11,11,43,1"),
        ]:
            with self.subTest(text=text):
                got = self.resolve(book, chapter, verse, text)
                self.assertEqual([x for _t, x, _n in got], [expected])
                self.assertTrue(all(not n for _t, _x, n in got))

    def test_note_point_number_is_not_a_chapter(self):
        self.assertEqual(self.resolve(60, 1, 17, "彼后二1注5第二点"),
                         [("彼后二1注5第二点", "", "61,2,1,5,0")])

    def test_half_verse_modifiers_on_range_ends(self):
        self.assertEqual(self.resolve(3, 13, 2, "2下～28"), [("2下～28", "3,13,2,2,3,13,28,0", "")])
        self.assertEqual(self.resolve(50, 1, 19, "腓一19～21上"),
                         [("腓一19～21上", "50,1,19,0,50,1,21,1", "")])
        self.assertEqual(self.resolve(40, 24, 3, "本章4节～二五46"),
                         [("4节～二五46", "40,24,4,40,25,46", "")])

    def test_bare_chapters_are_whole_chapter_refs(self):
        got = self.resolve(1, 12, 1, "二七41，二八1～三五10，三七，三九～四九，罗八28～29")
        self.assertEqual([x for _t, x, _n in got],
                         ["1,27,41", "1,28,1,1,35,10", "1,37,0", "1,39,0,1,49,0", "45,8,28,45,8,29"])
        self.assertEqual(self.resolve(19, 42, 0, "诗四三～四九、八四"),
                         [("诗四三～四九", "19,43,0,19,49,0", ""), ("八四", "19,84,0", "")])
        self.assertEqual(self.resolve(58, 11, 32, "撒上十六～撒下二四"),
                         [("撒上十六～撒下二四", "9,16,0,10,24,0", "")])

    def test_first_and_last_verse_of_each_psalm(self):
        got = self.resolve(66, 19, 1, "诗一○四35，一四六～一五○每篇之首尾")
        self.assertEqual(got[1][1], "19,146,1;19,146,10;19,147,1;19,147,20;19,148,1;19,148,14;"
                                    "19,149,1;19,149,9;19,150,1;19,150,6")

    def test_region_split_by_parenthesis_keeps_official_chapter(self):
        # 约壹1:6 注5「…三4（二次）、7、8、9、10、22，五2…」：后一区间仍属第三章
        got = self.resolve(62, 1, 6, "7、8、9、10、22，五2，罗一32")
        self.assertEqual([x for _t, x, _n in got],
                         ["62,3,7", "62,3,8", "62,3,9", "62,3,10", "62,3,22", "62,5,2", "45,1,32"])


class BeadTest(_Base):
    def test_leading_range_label_lists_the_local_passage(self):
        self.assertEqual(self.resolve(1, 5, 3, "3～32：代上一1～4，路三36～38"),
                         [("3～32", "1,5,3,1,5,32", ""), ("代上一1～4", "13,1,1,13,1,4", ""),
                          ("路三36～38", "42,3,36,42,3,38", "")])

    def test_bead_pointer_follows_the_referenced_bead(self):
        # 罗5:8 串a「见6a」→ 罗5:6 串a 的内容（林前十五3）
        self.assertEqual(self.resolve(45, 5, 8, "见6a"), [("见6a", "46,15,3", "")])


class ExportedSpansTest(_Base):
    def test_clickable_spans_are_exactly_the_official_regions(self):
        regions = {}
        for nid, s, e in self.conn.execute("SELECT note_id, start, end FROM footnote_link"):
            regions.setdefault(nid, []).append((s, e))
        self.assertEqual(sum(len(v) for v in regions.values()), 20395)
        spans = E._preload_note_refs(self.conn, self.parser, self.ctx)
        self.assertEqual(set(spans), set(regions))          # 没有区间的注解不可点
        for nid, items in spans.items():
            self.assertEqual([(it["s"], it["e"]) for it in items], sorted(regions[nid]),
                             "注 %d 必须逐区间生成一个完整的可点 span" % nid)
            covered = set()
            for it in items:
                hit = [g for g in regions[nid] if g[0] <= it["s"] and it["e"] <= g[1]]
                self.assertTrue(hit, "注 %d 的 span %r 落在正版区间之外" % (nid, it))
                self.assertTrue(it.get("x") or it.get("n"), "注 %d 有点开为空的 span %r" % (nid, it))
                covered.add(hit[0])
            self.assertEqual(covered, set(regions[nid]), "注 %d 有未覆盖的正版区间" % nid)

    def test_one_click_retains_all_targets_in_the_official_region(self):
        spans = E._preload_note_refs(self.conn, self.parser, self.ctx)
        nid, start, end = self.conn.execute(
            "SELECT note_id, start, end FROM footnote_link WHERE text = ? "
            "AND book_index = 1 AND chapter = 1 AND section = 1",
            ("弗一10，三9，提前一4下",),
        ).fetchone()
        item = next(it for it in spans[nid] if it["s"] == start and it["e"] == end)
        self.assertEqual(item["r"], "弗1:10,弗3:9,提前1:4下")
        self.assertEqual(item["x"], "49,1,10;49,3,9;54,1,4,2")


class TraditionalTest(_Base):
    DB = "zh_hant_rcv.db"

    def test_traditional_grammar_words(self):
        self.assertEqual(self.resolve(9, 21, 13, "詩三四標題"), [("詩三四標題", "19,34", "")])
        self.assertEqual(self.resolve(60, 1, 17, "彼後二1註5第二點"),
                         [("彼後二1註5第二點", "", "61,2,1,5,0")])
        self.assertEqual(self.resolve(1, 1, 2, "賽十四12～15與註")[0][1:],
                         ("23,14,12,23,14,15", "23,14,12,1,0;23,14,13,1,0;23,14,13,2,0;23,14,15,1,0"))


if __name__ == "__main__":
    unittest.main()
