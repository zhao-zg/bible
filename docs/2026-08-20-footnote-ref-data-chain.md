---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '5025bb77-c8e4-4edd-b386-12129b9f33a0'
  PropagateID: '5025bb77-c8e4-4edd-b386-12129b9f33a0'
  ReservedCode1: '8570119c-cf28-4136-b6c5-e2cffebfc60d'
  ReservedCode2: '8570119c-cf28-4136-b6c5-e2cffebfc60d'
---

# 注解经文引用数据链梳理

日期: 2026-08-20

## 一、结论先行

恢复本注解中的经文引用（如 `（1，18等，）`）**在源数据库和导出 JSON 中均无结构化引用映射记录**。数据库只存注解纯文本原文，所有"文本 → 具体经节"的指向完全由 `ref-detector.js` 在运行时根据上下文**现场推断**生成。

---

## 二、数据链全貌

```
resource/CG.db (SQLite 源数据库)
    │
    │  export_bible_sql_json.py（导出脚本）
    │
    ▼
output/data/bible/{N}.json (导出 JSON，运行时直接加载)
    │
    │  scripture-popup.js renderNoteText()（注解弹窗渲染）
    │  传入当前经文上下文（如 "诗119:1"）+ { lockBook: true }
    │
    ▼
ref-detector.js wrapRefs()（引用检测与包裹）
    │
    │  expandCnRefs()（展开中文引用 → ref 数组）
    │
    ▼
<span class="scripture-ref" data-refs="诗119:1,诗119:18">（1，18等，）</span>
```

### 各层职责

| 层级 | 文件/位置 | 职责 | 是否含引用映射 |
|------|-----------|------|----------------|
| 源数据库 | `resource/CG.db` `footnote` 表 | 存储注解纯文本 | 否 |
| 导出 JSON | `output/data/bible/{N}.json` `footnotes[].note` | 运行时加载的注解文本 | 否（与源一致） |
| 渲染入口 | `src/static/js/scripture-popup.js` `renderNoteText()` | 传入上下文 + 调用 wrapRefs | 否 |
| 引用解析 | `src/static/js/ref-detector.js` `wrapRefs()` → `expandCnRefs()` | 文本 → `data-refs` 映射 | **是（运行时生成）** |

---

## 三、源数据库结构（CG.db）

`resource/CG.db` 为恢复本注解源数据库（SQLite），关键表：

| 表名 | 列 | 行数 | 说明 |
|------|-----|------|------|
| `footnote` | `_id, book_index, chapter, section, flag, location, seq, note` | 16,657 | 注解正文，`note` 为纯文本 |
| `bead` | `_id, book_index, chapter, section, flag, location, seq, bead` | 26,283 | 串珠引用 |
| `content` | `_id, book_index, chapter, section, flag, content` | 31,295 | 经文正文 |
| `book_intro` | `_id, book_index, type, intro` | 259 | 卷首语 |
| `outline` | `_id, language, book_index, chapter, section, flag, level, outline` | 3,137 | 纲要 |
| `topic` | `_id, book_index, topic` | 66 | 主题 |

### 关键验证

- 全库搜索 `119:1` 或 `data-ref`：**命中 0 条**
- `footnote.note` 字段只存纯文本（如 `（1，18等，）`），不含任何结构化引用映射

### 诗119:1 注2 原始记录

```
footnote 表：book_index=19, chapter=119, section=1, seq=2, location=11
note = 本篇用"律法"一辞二十五次，（1，18等，）也用了"律法"好些不同的同义辞，包括"法度（直译，见证，单数，）"（一次—88，）"法度（直译，见证，复数，）"（二十二次—2，14等，）"话（单数，）"（三十六次—9，11等，）"话，言语（复数，）"（六次—57，103，130，139，147，161，参出三四28，直译，）"诫命（单数，）"（一次—96，）"诫命（复数，）"（二十一次—6，10等，）"律例，"（二十二次—5，8等，）"典章，"（十七次—7，13等，）"判语"（三次—75，120，137）和"训辞。"（二十一次—4，15等。）从"律法"到"训辞"这一切辞，总结于"道路（单数）"（四次—14，27，32，33）或"道路（复数，）"（三次—3，15，37，）表征基督对于神的子民乃是神的道路。（约十四6。）一一九篇有一百七十六节，描述基督是律法、诫命、典章、律例、训辞和判语的实际。
```

---

## 四、导出 JSON 结构

`output/data/bible/19.json`（诗篇）由 `export_bible_sql_json.py` 从 CG.db 导出：

```json
{
  "book_index": 19,
  "book_name": "诗篇",
  "book_acronym": "诗",
  "chapters": [
    { "chapter": 1, "verses": [...] },
    ...
    {
      "chapter": 119,
      "verses": [
        {
          "section": 1,
          "flag": 0,
          "content": "{1}行径完全，[a]遵行耶和华{2}律法的，这样的人是有福的。",
          "footnotes": [
            { "seq": 1, "location": 1, "note": "一一九篇是按字母次序写成的诗..." },
            { "seq": 2, "location": 11, "note": "本篇用"律法"一辞二十五次，（1，18等，）..." }
          ],
          "beads": [...]
        }
      ]
    }
  ]
}
```

- `footnotes[].note` 与源数据库 `footnote.note` **完全一致**（纯文本）
- 无任何 `refs` / `data-refs` / 引用映射字段

---

## 五、运行时解析流程

### 5.1 入口：scripture-popup.js

```javascript
// renderNoteText() 大致流程（L738-750 附近）
var html = CXRef.wrapRefs(noteText, ctxScripture, { lockBook: true });
```

- `ctxScripture`：当前经文上下文（如 `"诗119:1"`），由渲染层根据书卷+章节+节号拼出
- `lockBook: true`：保护裸书名和 fn-ref 不污染外层上下文

### 5.2 核心：ref-detector.js

#### wrapRefs(text, ctxStr, opts) 主函数

1. 解析上下文 `ctxStr` → `book`（书卷缩写）+ `ch`（章号）
2. 扫描文本中的**括号引用** `（…）` 和**行内引用**（如 `创三15`）
3. 每个括号/行内引用 → 调用 `expandCnRefs()` 展开

#### expandCnRefs(refText, defBook, defCh) 核心展开

将简写引用文本展开为 `["书卷章:节", ...]` 数组：

| 输入 | 上下文 | 输出 |
|------|--------|------|
| `1，18等` | 诗119 | `["诗119:1", "诗119:18"]` |
| `六次—57，103，…，参出三四28` | 诗119 | `["诗119:57", ..., "出34:28"]` |
| `创三15` | 弗3 | `["创3:15"]`（显式书卷，无需上下文） |

#### 上下文继承机制

| 变量 | 作用域 | 含义 |
|------|--------|------|
| `book` / `ch` | wrapRefs + expandCnRefs | 当前解析上下文书卷/章号 |
| `lastBook` | expandCnRefs 内 | 最近一次**显式**出现的书卷（供省略书卷的相对引用继承） |
| `_hadRefPrefix` | expandCnRefs 内 | 标记 part 是否带「参/见」前缀（独立补充参考，不更新上下文） |
| `_lockBook` | wrapRefs | 阻止裸书名和 fn-ref 污染外层上下文 |

### 5.3 输出

```html
<span class="scripture-ref" data-refs="诗119:1,诗119:18">（1，18等，）</span>
```

用户点击该 span 时，前端读取 `data-refs` 跳转对应经文。

---

## 六、为什么解析逻辑的上下文处理至关重要

由于源数据**没有任何引用映射可供校验**，`（1，18等，）` 中的 `1` 和 `18` 具体指向哪卷哪章哪节，**100% 依赖运行时上下文推断**。

### 典型故障模式

| 场景 | 上下文 | 正确结果 | 错误结果（上下文被污染时） |
|------|--------|----------|--------------------------|
| `（1，18等，）` | 诗119 | 诗119:1, 诗119:18 | — |
| `（一次—96，）` | 诗119 | 诗119:96 | 出34:96（被 `参出三四28` 污染） |
| `十二3`（弗3:6注3中） | 创3:15 已显式 | 创12:3 | 弗12:3（继承外层"弗"） |

### 已修复的关键 Bug（2026-08-20）

1. **书卷继承错误**：`参出三四28`（带参前缀的独立补充参考）不应更新上下文，否则后续括号错误继承"出34"
2. **"等"字截断**：`18等` 尾部"等"字导致解析失败 → 尾部"等"剥离
3. **"次—N"统计式破折号**：`六次—57` 中"六次"是统计前缀，破折号后才是节号 → 提取破折号后内容
4. **`_hadRefPrefix` 保护**：带参/见前缀的引用不更新 `book`/`ch`/`lastBook`，防止跨括号污染

---

## 七、相关文件清单

| 文件 | 路径 | 说明 |
|------|------|------|
| 源数据库 | `resource/CG.db` | 恢复本注解 SQLite 源库 |
| 导出脚本 | `export_bible_sql_json.py` | CG.db → JSON |
| 导出 JSON | `output/data/bible/{N}.json` | 运行时加载的注解数据 |
| 引用解析 | `src/static/js/ref-detector.js` | 核心解析逻辑（4 份副本需 MD5 一致） |
| 弹窗渲染 | `src/static/js/scripture-popup.js` | 调用 wrapRefs 的入口 |

### ref-detector.js 四份副本

| 副本 | 路径 | Git 跟踪 |
|------|------|----------|
| 源码 | `src/static/js/ref-detector.js` | 是 |
| Web 产物 | `output/js/ref-detector.js` | 否（.gitignore） |
| Android assets | `android/app/src/main/assets/js/ref-detector.js` | 否 |
| Android public | `android/app/src/main/assets/public/js/ref-detector.js` | 否 |

> 修改 ref-detector.js 后需手动同步四份副本并验证 MD5 一致。
> `main.py` 构建时若未安装 rjsmin 则直接复制（不压缩），output 与 src 内容一致。