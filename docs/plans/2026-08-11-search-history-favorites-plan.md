---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: 'efda2be2-f336-482b-b8fa-b806764f8ded'
  PropagateID: 'efda2be2-f336-482b-b8fa-b806764f8ded'
  ReservedCode1: '50dcc746-5ba1-4c9c-8889-29b22374b3ad'
  ReservedCode2: '50dcc746-5ba1-4c9c-8889-29b22374b3ad'
---

# 搜索历史 & 收藏经文 — 实施计划

日期: 2026-08-11

## Task 1: 搜索历史记录（约 30 分钟）

### 步骤 1.1: i18n 翻译键
**文件**: `src/static/js/i18n.js`

新增翻译键（zh-CN + en）:
- `search_history`: "搜索历史" / "Search History"
- `clear_search_history`: "清空搜索历史" / "Clear Search History"
- `search_history_empty`: "暂无搜索记录" / "No search history"

### 步骤 1.2: 搜索历史 CRUD
**文件**: `src/static/js/search.js`

在 `CXSearch` 对象内新增:
- `_getSearchHistory()`: 从 localStorage 读取 `bible_search_history`，返回数组
- `_saveSearchHistory(list)`: 保存到 localStorage
- `_addSearchHistory(query)`: 添加搜索词（去重，更新 time，上限 20）
- `_removeSearchHistory(query)`: 删除指定搜索词
- `_clearSearchHistory()`: 清空所有搜索历史

### 步骤 1.3: 搜索时记录历史
**文件**: `src/static/js/search.js`

修改 `_doSearch()`: 搜索有结果后调用 `_addSearchHistory(query)`

### 步骤 1.4: 历史列表 UI
**文件**: `src/static/js/search.js`

- 新增 `_renderSearchHistory()`: 渲染历史列表 HTML
  - 每项: 左侧时钟图标 + 关键词，右侧相对时间 + 删除按钮
  - 底部: "清空搜索历史" 按钮
- 新增 CSS 样式:
  - `.cx-search-history-item`: 列表项样式
  - `.cx-search-history-delete`: 删除按钮（红色）
  - `.cx-search-history-clear`: 清空按钮
  - 滑动删除: touch 事件 + translateX 动画

### 步骤 1.5: 集成到搜索 Modal
**文件**: `src/static/js/search.js`

- 修改 `open()`: 若 `_input.value` 为空，渲染搜索历史
- 监听 `_input` 的 `input` 事件: 值为空时显示历史，有值时显示结果
- 历史项点击: 填入搜索框并执行搜索

### 验证
- 打开搜索 → 显示历史列表（首次为空）
- 搜索关键词 → 搜索结果出现 → 关闭搜索 → 重新打开 → 输入为空时显示历史
- 点击历史项 → 执行搜索
- 滑动删除单条 → 刷新后消失
- 清空按钮 → 全部清除
- 超过 20 条 → 最旧的被淘汰

---

## Task 2: 收藏经文 — 数据层 + 长按菜单 + 章节栏星号（约 45 分钟）

### 步骤 2.1: i18n 翻译键
**文件**: `src/static/js/i18n.js`

新增翻译键:
- `fav_verse`: "收藏经节" / "Favorite Verse"
- `unfav_verse`: "取消收藏" / "Unfavorite"
- `copy_verse`: "复制经文" / "Copy Verse"
- `share_verse`: "分享经文" / "Share Verse"
- `multi_select`: "多选" / "Select Multiple"
- `cancel_select`: "取消" / "Cancel"
- `selected_count`: "已选 {n} 节" / "{n} selected"
- `fav_added`: "已收藏" / "Added to Favorites"
- `fav_removed`: "已取消收藏" / "Removed from Favorites"
- `delete`: "删除" / "Delete"

### 步骤 2.2: 扩展收藏数据模型
**文件**: `src/static/js/bible-renderer.js`

修改 `_addFavorite`:
- 新增参数: `section` (默认0), `sectionFlag` (默认0), `verseText` (默认'')
- 去重逻辑: `bookIndex + chapter + section + sectionFlag` 组合唯一

修改 `_removeFavorite`:
- 新增参数: `section`, `sectionFlag`
- 匹配逻辑同上

修改 `_isFavorite`:
- 新增参数: `section`, `sectionFlag`
- 返回 boolean

修改 `_getFavorites`:
- 读取时为旧数据补全 `section: 0, sectionFlag: 0, verseText: ''`

### 步骤 2.3: 章节栏星号按钮
**文件**: `src/static/js/bible-renderer.js`

在章节栏（`.bible-chapter-bar`）中增加星号按钮:
- 渲染时检查 `_isFavorite(bookIndex, chapter, 1, 0)` 判断是否已收藏
- 点击: 收藏/取消收藏当前章第一节（经节级收藏入口）
- 动态更新星号状态（实心/空心）

CSS:
- `.bible-fav-star`: 星号按钮样式（不遮挡章节名）

### 步骤 2.4: 长按经文弹出菜单
**文件**: `src/static/js/bible-renderer.js`

在 `_bindVerseEvents()` 或新函数中:
- 对 `.bible-verse` 绑定长按事件（touchstart + 500ms timer）
- touchmove > 10px 取消
- touchend 在 500ms 内取消

长按触发时:
- 提取经节信息: `section`, `flag`, `content`
- 构建菜单 HTML（收藏经节/复制/分享/多选）
- 使用 `CX.openDialog` 显示

菜单项逻辑:
1. **收藏经节**: 调用 `_addFavorite` / `_removeFavorite`
2. **复制经文**: `navigator.clipboard.writeText`
3. **分享经文**: `navigator.share` / 降级复制
4. **多选**: 进入多选模式

### 步骤 2.5: 收藏 Tab 增强
**文件**: `src/static/js/bible-renderer.js`

修改 `_renderFavoritesTab()`:
- 经节级: 显示"书名 N:M" + 经文摘要（1行省略）
- 章级(旧数据): 显示"书名 N章"
- 滑动删除: 向左滑动显示红色删除按钮
- 点击跳转: 经节级 → navigate 到章节 + pendingScrollSection

### 验证
- 长按经文 → 弹出菜单 → 收藏经节 → 侧栏收藏 Tab 显示
- 章节栏星号 → 点击收藏 → 再次点击取消
- 收藏 Tab → 滑动删除 → 确认删除
- 复制经文 → 粘贴确认内容正确
- 分享经文 → 系统分享面板弹出（或降级复制）

---

## Task 3: 多选模式（约 30 分钟）

### 步骤 3.1: 多选状态管理
**文件**: `src/static/js/bible-renderer.js`

新增变量:
- `_multiSelectMode`: boolean
- `_multiSelectedVerses`: Set (存储 section + flag 标识)
- `_multiSelectBarEl`: 底部操作栏 DOM 引用

### 步骤 3.2: 进入/退出多选
**进入**:
- 长按菜单点"多选" → 进入多选模式，自动选中当前节
- 或者: 长按直接进入多选模式

**退出**:
- 点"取消"按钮
- Android 返回键

### 步骤 3.3: 多选 UI
**文件**: `src/static/js/bible-renderer.js`

- 顶部: 半透明覆盖条，显示"已选 N 节" + "取消"按钮
- 每节经文: 左侧出现圆形复选框（选中时填充主题色）
- 选中的经文: 淡色背景高亮

### 步骤 3.4: 底部操作栏
**文件**: `src/static/js/bible-renderer.js`

固定底部操作栏，包含:
- ⭐ 收藏（批量收藏选中经节）
- 📋 复制（复制选中经文，格式: "书名 N章\n1 经文1\n2 经文2"）
- 🔗 分享（Web Share API / 降级复制）
- ☑️ 全选/取消全选

### 步骤 3.5: CSS 样式
**文件**: `src/static/js/bible-renderer.js` (内联 CSS 注入)

- `.multi-select-bar`: 顶部信息栏
- `.multi-select-toolbar`: 底部操作栏
- `.verse-checkbox`: 圆形复选框
- `.bible-verse.selected`: 选中高亮

### 验证
- 长按经文 → 菜单点"多选" → 进入多选模式
- 点击其他经文 → 切换选中状态
- 全选 → 所有经文选中
- 收藏 → 批量添加到收藏 Tab
- 复制 → 粘贴确认内容格式正确
- 取消 → 退出多选模式
- Android 返回键 → 退出多选模式