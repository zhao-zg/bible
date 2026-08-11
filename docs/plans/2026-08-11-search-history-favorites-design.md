---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '5417df36-fd28-4d5a-83ad-5506c0bdfc59'
  PropagateID: '5417df36-fd28-4d5a-83ad-5506c0bdfc59'
  ReservedCode1: '1852d93e-081d-4c46-8d28-bb78450297ab'
  ReservedCode2: '1852d93e-081d-4c46-8d28-bb78450297ab'
---

# 搜索历史 & 收藏经文 — 功能设计

日期: 2026-08-11

## 一、功能概览

| 功能 | 说明 |
|------|------|
| 搜索历史 | 统一记录经文搜索和注解搜索关键词，最多20条，列表+滑动删除 |
| 收藏经文 | 两级收藏（章级+经节级），长按经文弹出操作菜单，含收藏/复制/分享/多选 |

---

## 二、搜索历史

### 2.1 数据模型

localStorage 键: `bible_search_history`

```json
[
  { "query": "恩典", "time": 1723315200000 },
  { "query": "弗4:23", "time": 1723315100000 }
]
```

- 最多 20 条，去重（同 query 不重复添加，但更新 time 到最前）
- 按时间倒序排列

### 2.2 UI 交互

**位置**: 搜索 Modal 内，`#cx-search-results` 区域上方

**状态**:
1. **搜索框为空 + Modal 打开** → 显示搜索历史列表（替代空白状态）
2. **搜索框有输入** → 显示搜索结果（隐藏历史）

**列表项**:
- 左侧: 搜索关键词
- 右侧: 相对时间（复用 `_relativeTime` 逻辑）
- 交互: 点击 → 填入搜索框 + 执行搜索
- 删除: 向左滑动显示删除按钮（与 iOS 风格一致）

**底部**: "清空搜索历史" 按钮（仅在有历史时显示）

### 2.3 修改文件

| 文件 | 修改内容 |
|------|----------|
| `search.js` | 新增 `_getSearchHistory`/`_saveSearchHistory`/`_addSearchHistory`/`_removeSearchHistory`/`_clearSearchHistory`；`open()` 时若输入为空则渲染历史；`_doSearch` 成功后调用 `_addSearchHistory`；新增 `_renderSearchHistory` 渲染列表 |
| `search.js` (CSS) | 新增历史列表样式（`.cx-search-history-item` + 滑动删除） |
| `i18n.js` | 新增 `search_history`/`clear_search_history`/`search_history_empty` |

---

## 三、收藏经文

### 3.1 数据模型（扩展）

localStorage 键: `bible_favorites`（已有，扩展数据结构）

```json
[
  {
    "bookIndex": 56,
    "bookName": "罗马书",
    "chapter": 8,
    "section": 0,       // 0 = 整章收藏; >0 = 经节级收藏
    "sectionFlag": 0,   // 半节标记 (0=无, 1=上, 2=下)
    "verseText": "",     // 经节级收藏时的经文摘要（前50字）
    "time": 1723315200000
  }
]
```

- `section: 0` → 章级别收藏（向后兼容旧数据）
- `section > 0` → 经节级收藏
- 去重: `bookIndex + chapter + section + sectionFlag` 组合唯一

### 3.2 长按经文弹出菜单

**触发**: 长按 `.bible-verse` 元素（>= 500ms）

**菜单项**:
1. ⭐ 收藏经节 / 取消收藏经节
2. 📖 收藏整章 / 取消收藏整章
3. 📋 复制经文
4. 🔗 分享经文
5. ☑️ 开启多选

**实现**:
- 使用 `CX.openDialog` 复用现有浮层组件
- 菜单项用 `.verse-action-menu` 样式
- 已收藏的项目显示"取消收藏"，未收藏的显示"收藏"

### 3.3 多选模式

**进入**: 长按经文 → 菜单点"开启多选"，或长按直接进入多选

**多选状态**:
- 顶部显示选择计数 + "取消"按钮
- 经节左侧显示圆形复选框
- 点击经节切换选中状态

**底部操作栏**（固定底部）:
- 收藏（批量收藏选中经节）
- 复制（复制选中经文）
- 分享（分享选中经文）
- 全选/取消全选

**退出**: 点"取消"按钮或 Android 返回键

### 3.4 收藏 Tab 增强

**侧栏收藏 Tab** 当前已能渲染章级列表，需增强:

1. **区分显示**: 章级收藏显示"书名 N章"，经节级显示"书名 N:M"
2. **经节级额外显示**: 经文摘要（1行，溢出省略）
3. **删除功能**: 每项向左滑动显示删除按钮
4. **点击跳转**: 章级 → 跳转该章；经节级 → 跳转该章并滚动到该节

### 3.5 收藏入口增加 — 阅读页顶部工具栏

当前阅读页有底部工具栏（朗读/字体等），在**章节栏**区域增加一个星号按钮:
- 已收藏: 实心星 ⭐
- 未收藏: 空心星 ☆
- 点击: 收藏/取消收藏当前章节

### 3.6 修改文件

| 文件 | 修改内容 |
|------|----------|
| `bible-renderer.js` | 扩展 `_addFavorite`/`_removeFavorite`/`_isFavorite` 支持 section 参数；新增 `_renderVerseActionMenu` 长按菜单；新增多选模式逻辑；章节栏增加星号按钮；`_renderFavoritesTab` 增强支持经节级显示和滑动删除 |
| `bible-renderer.js` (CSS) | 长按菜单样式、多选模式样式、星号按钮样式、底部操作栏样式 |
| `i18n.js` | 新增: `fav_verse`/`fav_chapter`/`unfav_verse`/`unfav_chapter`/`copy_verse`/`share_verse`/`multi_select`/`select_all`/`deselect_all`/`cancel_select`/`selected_count`/`fav_added`/`fav_removed`/`search_history`/`clear_search_history`/`search_history_empty`/`delete` |
| `search.js` | 搜索历史 CRUD + 渲染 + 交互 |

---

## 四、实现方案 — 3 个 Task

### Task 1: 搜索历史记录
- 新增搜索历史 CRUD 函数
- 修改 `_doSearch` 在搜索成功后记录历史
- 修改 `open()` 在输入为空时渲染历史列表
- 新增历史列表 UI + 滑动删除 + 清空
- 新增 i18n 翻译

### Task 2: 收藏经文 — 数据层 + 长按菜单 + 章节栏星号
- 扩展收藏数据模型（支持 section/sectionFlag/verseText）
- 新增长按菜单（收藏经节/收藏整章/复制/分享/多选）
- 章节栏增加星号按钮
- 收藏 Tab 增强（经节级显示 + 滑动删除 + 点击跳转定位）
- 新增 i18n 翻译

### Task 3: 多选模式
- 长按进入多选 / 菜单中"开启多选"进入
- 多选状态 UI（复选框 + 选中高亮 + 计数）
- 底部操作栏（收藏/复制/分享/全选）
- 退出多选模式

---

## 五、风险与约束

1. **滑动删除**: 移动端需用 touch 事件实现，避免与 scroll 冲突
2. **长按 vs 点击**: 长按 500ms 触发菜单，短按仍为正常滚动；需用 timer + touchmove 取消
3. **数据兼容**: 旧 `bible_favorites` 无 section 字段，读取时默认 `section: 0`
4. **分享**: 使用 Web Share API（`navigator.share`），不支持时降级为复制
5. **复制多节**: 选中多节经文复制时，格式为"书名 N章\n1 经文1\n2 经文2"