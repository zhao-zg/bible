/**
 * 圣经阅读器国际化模块
 * 使用 IIFE 模式，挂载到 window.CXI18n
 */
(function() {
    'use strict';

    var translations = {
        'zh-CN': {
            // ── 应用标题与元信息 ──
            app_title: '圣经',
            app_emoji_title: '📖 圣经',
            app_subtitle: '多语言圣经阅读',
            meta_description: '多语言圣经阅读',

            // ── 导航标签 ──
            tab_books: '书卷',
            tab_favorites: '收藏',
            tab_history: '历史',

            // ── 旧约/新约 ──
            old_testament: '旧约',
            new_testament: '新约',

            // ── 搜索 ──
            search_placeholder: '搜索经文和注解',
            search_btn: '🔍 搜索经文',

            // ── 阅读主题 ──
            reading_theme: '阅读主题',
            theme_gray_white: '灰白',
            theme_light_yellow: '浅黄',
            theme_warm_yellow: '米黄',
            theme_dark_gray: '深灰',
            theme_night: '黑夜',

            // ── 设置面板 ──
            settings: '设置',
            font_size: '字号大小',
            display_content: '显示内容',
            toggle_book_theme: '书卷主题',
            toggle_book_intro: '书卷简介',
            toggle_outline: '经文纲目',
            toggle_notes: '经文注解',
            toggle_beads: '经节串珠',
            toggle_divider: '经节分割线',

            // ── 经文操作 ──
            copy_all: '全部复制',
            copied: '已复制',
            note_not_found: '（未找到注解）',
            bead_not_found: '（未找到串珠）',
            note_label: '注',
            bead_label: '串',

            // ── 书卷导航 ──
            back_to_books: '◀ 书卷导航',
            back: '◀ 返回',
            book_nav: '书卷导航',
            prev_chapter: '上一章',
            next_chapter: '下一章',

            // ── 历史与收藏 ──
            no_history: '暂无浏览记录',
            favorites_wip: '收藏功能开发中',
            chapter_label: '章',

            // ── 读经计划 ──
            reading_plan: '读经计划',
            plan_not_found: '未找到读经计划',
            no_plan_content: '暂无计划内容',
            plan_a: '读经计划 A',
            plan_b: '读经计划 B',
            plan_c: '读经计划 C',
            plan_d: '读经计划 D',

            // ── 图表 ──
            charts: '图表',
            charts_wip: '图表功能开发中',
            bible_illustrations: '圣经插图',
            illustrations_hint: '点击查看大图',

            // ── 状态提示 ──
            no_content: '暂无内容',
            no_scripture: '暂无经文数据',
            loading: '加载中…',
            load_failed: '加载失败，请重试',
            offline: '离线状态',

            // ── TTS 朗读 ──
            tts_play: '朗读',
            tts_stop: '停止',

            // ── 管理面板 ──
            admin_panel: '🔧 管理面板',
            admin_password_prompt: '请输入管理密码：',
            admin_password_error: '密码错误',
            check_update: '检查更新',
            check_update_apk_desc: '检查并安装最新 APK',
            check_update_pwa_desc: '检查 PWA 缓存是否最新',
            check_btn: '检查',
            dev_mode: '开发者模式',
            dev_mode_desc: '在页面底部显示调试日志',
            close: '关闭',

            // ── PWA 安装与缓存 ──
            install_cache: '首次安装缓存',
            cache_updating: '缓存更新中',
            install_cache_desc: '首次使用会缓存核心资源，请保持网络连接...',
            cache_update_desc: '正在重新缓存资源，用户数据不受影响...',
            caching_resources: '正在缓存核心资源...',
            cache_complete: '✓ 缓存完成',
            cache_done_reload: '✅ 缓存完成，即将重载...',
            cache_error: '⚠ 出错：',
            retry: '重试',
            preparing: '正在准备...',
            start_caching: '开始缓存资源...',
            env_no_cache: '当前环境不支持缓存',

            // ── 离线横幅 ──
            offline_banner: '📶 需要网络连接才能首次安装缓存',
            dismiss: '知道了',

            // ── 伪装/维护页 ──
            ios_add_home: '添加到主屏幕',
            ios_add_home_desc: '请发送到桌面缓存使用，在线版已不支持，请谅解',
            android_download_apk: '请下载 APK 离线使用',
            android_download_apk_desc: '请下载APK离线使用，在线版已不支持，请谅解',

            // ── 启动页 ──
            splash_ref: '诗篇 119:148',
            splash_verse: '我趁夜更未换，将眼睁开，为要默想你的话语。',

            // ── 底部工具栏 ──
            toolbar_books: '书卷导航',
            toolbar_tts: '朗读',
            toolbar_font: '字体设置',
            toolbar_outline: '目录',
            toolbar_more: '更多',

            // ── 通用 ──
            font_settings: '字体设置',
            outline: '目录',
            more: '更多',

            // ── 多语言版本 ──
            display_languages: '显示语言',
            primary_version: '主',
            version_zh_rcv: '恢复本',
            version_zh_cuv: '和合本',
            version_en_darby: 'Darby',
            version_en_kjv: 'KJV',
            version_zh_ncv: '新译本',
            version_he_el: '词典(希/希)',
            version_he_orig: '原文(希/希)',
            parsing_view: '原文解析',
            strongs_lookup: 'Strong\u2019s 词典',
            no_dict_entry: '暂无词典数据',

            // ── 相对时间 ──
            time_just_now: '刚刚',
            time_minutes_ago: '{n}分钟前',
            time_hours_ago: '{n}小时前',
            time_days_ago: '{n}天前',
            time_months_ago: '{n}月前',

            // ── 图表/统计 ──
            reading_stats: '阅读统计',
            no_reading_history: '暂无阅读记录',
            stats_hint: '开始阅读后这里会显示统计数据',
            books_read: '已读书卷',
            chapters_read: '已读章节',
            fav_chapters: '收藏章节',
            last_7_days: '最近 7 天',
            reading_progress: '阅读进度',
            books_unit: '卷',
            day_labels: '日,一,二,三,四,五,六',

            // ── 收藏/书签 ──
            no_favorites: '暂无收藏',
            fav_hint: '在阅读页点击星标按钮添加收藏',
            user_guide: '使用说明',
            view_book_intro: '查看本卷书介',
            view_book_outline: '查看本卷纲目',
            no_data: '暂无数据',

            // ── 使用说明内容 ──
            guide_books: '📅 点击底部工具栏书卷导航按钮选择书卷开始阅读',
            guide_tts: '🔊 朗读按钮可开启语音朗读',
            guide_font: 'Aa 调整字号和阅读主题',
            guide_outline: '📑 目录按钮查看当前章节纲目',
            guide_fav: '⭐ 标题栏星标可收藏当前章节',

            // ── 读经计划 ──
            plan_not_found_msg: '未找到读经计划',

            // ── 章节格式 ──
            chapter_n: '第{n}章',
            section_n: '段 {n}',

            // ── TTS 朗读状态 ──
            tts_plugin_not_ready: '朗读插件未就绪',
            tts_unavailable: '朗读暂不可用',
            tts_failed: '朗读失败',
            tts_loop_on: '循环播放当前页面（已开启）',
            tts_loop_off: '只播放当前页面',
            tts_allow_bg: '允许后台朗读',
            tts_battery_hint: '息屏或切换 App 时，电池优化可能中断朗读。<br>点击"立即开启"后，系统将弹出确认框，选择"允许"即可保障息屏连续播放。<br><small style="color:var(--text-muted,#888)">（若系统弹框未出现，可在 App 详情页的电池选项中手动设置）</small>',
            tts_later: '稍后再说',
            tts_enable_now: '立即开启',

            // ── 加载失败 ──
            tts_play_pause: '播放/暂停',
            tts_play_label: '播放',
            tts_rate: '语速',
            load_failed_retry: '加载失败，请重试',

            // ── 语言版本管理 ──
            lang_pack_manager: '语言版本管理',
            lang_pack_bundled: '内置',
            lang_pack_downloaded: '已下载',
            lang_pack_available: '可下载',
            lang_pack_download: '下载',
            lang_pack_delete: '删除',
            lang_pack_downloading: '下载中…',
            lang_pack_download_complete: '下载完成',
            lang_pack_download_failed: '下载失败，请重试',
            lang_pack_no_network: '离线状态，无法下载',
            lang_pack_confirm_delete: '确定要删除该语言版本吗？',
            lang_pack_size_mb: '{n} MB',

            // ── 语言版本显示顺序 ──
            lang_versions_title: '语言版本',
            lang_display_order: '显示顺序',
            lang_display_order_hint: '点击箭头调整阅读时的语言显示顺序',
            lang_version_primary: '主',
            lang_move_up: '上移',
            lang_move_down: '下移'
        },

        'en': {
            // ── App title & meta ──
            app_title: 'Bible',
            app_emoji_title: '📖 Bible',
            app_subtitle: 'Multi-language Bible Reading',
            meta_description: 'Multi-language Bible Reading',

            // ── Navigation tabs ──
            tab_books: 'Books',
            tab_favorites: 'Favorites',
            tab_history: 'History',

            // ── Old/New Testament ──
            old_testament: 'Old Testament',
            new_testament: 'New Testament',

            // ── Search ──
            search_placeholder: 'Search scriptures and notes',
            search_btn: '🔍 Search',

            // ── Reading themes ──
            reading_theme: 'Reading Theme',
            theme_gray_white: 'White',
            theme_light_yellow: 'Light',
            theme_warm_yellow: 'Warm',
            theme_dark_gray: 'Dark',
            theme_night: 'Night',

            // ── Settings ──
            settings: 'Settings',
            font_size: 'Font Size',
            display_content: 'Display Content',
            toggle_book_theme: 'Book Theme',
            toggle_book_intro: 'Book Intro',
            toggle_outline: 'Outline',
            toggle_notes: 'Footnotes',
            toggle_beads: 'Cross References',
            toggle_divider: 'Verse Divider',

            // ── Scripture actions ──
            copy_all: 'Copy All',
            copied: 'Copied',
            note_not_found: '(Note not found)',
            bead_not_found: '(Cross ref not found)',
            note_label: 'fn',
            bead_label: 'xr',

            // ── Book navigation ──
            back_to_books: '◀ Books',
            back: '◀ Back',
            book_nav: 'Book Navigation',
            prev_chapter: 'Previous Chapter',
            next_chapter: 'Next Chapter',

            // ── History & Favorites ──
            no_history: 'No browsing history',
            favorites_wip: 'Favorites coming soon',
            chapter_label: 'Ch.',

            // ── Reading plans ──
            reading_plan: 'Reading Plan',
            plan_not_found: 'Plan not found',
            no_plan_content: 'No plan content',
            plan_a: 'Reading Plan A',
            plan_b: 'Reading Plan B',
            plan_c: 'Reading Plan C',
            plan_d: 'Reading Plan D',

            // ── Charts ──
            charts: 'Charts',
            charts_wip: 'Charts coming soon',
            bible_illustrations: 'Bible Illustrations',
            illustrations_hint: 'Tap to view full size',

            // ── Status ──
            no_content: 'No content',
            no_scripture: 'No scripture data',
            loading: 'Loading...',
            load_failed: 'Load failed, please retry',
            offline: 'Offline',

            // ── TTS ──
            tts_play: 'Read',
            tts_stop: 'Stop',

            // ── Admin ──
            admin_panel: '🔧 Admin Panel',
            admin_password_prompt: 'Enter admin password:',
            admin_password_error: 'Wrong password',
            check_update: 'Check Update',
            check_update_apk_desc: 'Check and install latest APK',
            check_update_pwa_desc: 'Check PWA cache is up to date',
            check_btn: 'Check',
            dev_mode: 'Developer Mode',
            dev_mode_desc: 'Show debug log at page bottom',
            close: 'Close',

            // ── PWA install & cache ──
            install_cache: 'Install Cache',
            cache_updating: 'Updating Cache',
            install_cache_desc: 'First use will cache core resources, keep network connected...',
            cache_update_desc: 'Re-caching resources, user data is not affected...',
            caching_resources: 'Caching core resources...',
            cache_complete: '✓ Cache Complete',
            cache_done_reload: '✅ Cache complete, reloading...',
            cache_error: '⚠ Error: ',
            retry: 'Retry',
            preparing: 'Preparing...',
            start_caching: 'Start caching resources...',
            env_no_cache: 'This environment does not support caching',

            // ── Offline banner ──
            offline_banner: '📶 Network required for first-time cache install',
            dismiss: 'Got it',

            // ── Disguise/maintenance ──
            ios_add_home: 'Add to Home Screen',
            ios_add_home_desc: 'Please add to desktop for offline use. Online version is no longer supported.',
            android_download_apk: 'Download APK for Offline Use',
            android_download_apk_desc: 'Please download APK for offline use. Online version is no longer supported.',

            // ── Splash ──
            splash_ref: 'Psalm 119:148',
            splash_verse: 'My eyes stay open through the watches of the night, that I may meditate on your promises.',

            // ── Bottom toolbar ──
            toolbar_books: 'Books',
            toolbar_tts: 'Read',
            toolbar_font: 'Font Settings',
            toolbar_outline: 'Outline',
            toolbar_more: 'More',

            // ── General ──
            font_settings: 'Font Settings',
            outline: 'Outline',
            more: 'More',

            // ── Multi-language versions ──
            display_languages: 'Display Languages',
            primary_version: 'Primary',
            version_zh_rcv: 'Recovery Version',
            version_zh_cuv: 'Chinese Union',
            version_en_darby: 'Darby',
            version_en_kjv: 'KJV',
            version_zh_ncv: 'New Chinese Version',
            version_he_el: 'Dictionary (Heb/Gk)',
            version_he_orig: 'Original (Heb/Gk)',
            parsing_view: 'Word Analysis',
            strongs_lookup: "Strong's Dictionary",
            no_dict_entry: 'No dictionary entry available',

            // ── Relative time ──
            time_just_now: 'Just now',
            time_minutes_ago: '{n}m ago',
            time_hours_ago: '{n}h ago',
            time_days_ago: '{n}d ago',
            time_months_ago: '{n}mo ago',

            // ── Charts / stats ──
            reading_stats: 'Reading Stats',
            no_reading_history: 'No reading history',
            stats_hint: 'Statistics will appear here after you start reading',
            books_read: 'Books Read',
            chapters_read: 'Chapters Read',
            fav_chapters: 'Favorited',
            last_7_days: 'Last 7 Days',
            reading_progress: 'Reading Progress',
            books_unit: 'books',
            day_labels: 'Su,Mo,Tu,We,Th,Fr,Sa',

            // ── Favorites / bookmarks ──
            no_favorites: 'No favorites',
            fav_hint: 'Tap the star icon on the reading page to add favorites',
            user_guide: 'User Guide',
            view_book_intro: 'Book Introduction',
            view_book_outline: 'Book Outline',
            no_data: 'No data available',

            // ── Guide content ──
            guide_books: '📅 Tap the Books button in the bottom toolbar to start reading',
            guide_tts: '🔊 Tap the Read button to enable text-to-speech',
            guide_font: 'Aa Adjust font size and reading theme',
            guide_outline: '📑 Tap Outline to view chapter sections',
            guide_fav: '⭐ Tap the star in the title bar to favorite',

            // ── Reading plans ──
            plan_not_found_msg: 'Reading plan not found',

            // ── Chapter format ──
            chapter_n: 'Chapter {n}',
            section_n: 'Section {n}',

            // ── TTS status ──
            tts_plugin_not_ready: 'TTS plugin not ready',
            tts_unavailable: 'TTS unavailable',
            tts_failed: 'TTS failed',
            tts_loop_on: 'Loop current page (on)',
            tts_loop_off: 'Play current page only',
            tts_allow_bg: 'Allow Background Reading',
            tts_battery_hint: 'Battery optimization may interrupt reading when the screen is off or you switch apps.<br>Tap "Enable Now" and select "Allow" to ensure continuous background playback.<br><small style="color:var(--text-muted,#888)">(If the system dialog does not appear, you can set it manually in the app\'s battery options)</small>',
            tts_later: 'Later',
            tts_enable_now: 'Enable Now',

            // ── Load failure ──
            tts_play_pause: 'Play/Pause',
            tts_play_label: 'Play',
            tts_rate: 'Speed',
            load_failed_retry: 'Load failed, please retry',

            // ── Language Pack Manager ──
            lang_pack_manager: 'Language Packs',
            lang_pack_bundled: 'Bundled',
            lang_pack_downloaded: 'Downloaded',
            lang_pack_available: 'Available',
            lang_pack_download: 'Download',
            lang_pack_delete: 'Delete',
            lang_pack_downloading: 'Downloading…',
            lang_pack_download_complete: 'Download Complete',
            lang_pack_download_failed: 'Download Failed, please retry',
            lang_pack_no_network: 'Offline, cannot download',
            lang_pack_confirm_delete: 'Are you sure you want to delete this language version?',
            lang_pack_size_mb: '{n} MB',

            // ── Language version display order ──
            lang_versions_title: 'Language Versions',
            lang_display_order: 'Display Order',
            lang_display_order_hint: 'Tap arrows to adjust language display order',
            lang_version_primary: 'Primary',
            lang_move_up: 'Move Up',
            lang_move_down: 'Move Down'
        }
    };

    window.CXI18n = {
        _lang: 'zh-CN',

        init: function() {
            var saved = null;
            try { saved = localStorage.getItem('bible_lang'); } catch(e) {}
            if (saved && translations[saved]) {
                this._lang = saved;
            }
        },

        t: function(key) {
            return (translations[this._lang] && translations[this._lang][key]) ||
                   (translations['zh-CN'] && translations['zh-CN'][key]) ||
                   key;
        },

        /**
         * 带占位符替换的翻译
         * 用法: CXI18n.tf('time_minutes_ago', {n: 5}) -> '5分钟前'
         */
        tf: function(key, vars) {
            var tpl = this.t(key);
            if (!vars) return tpl;
            return tpl.replace(/\{(\w+)\}/g, function(_, k) {
                return (k in vars) ? String(vars[k]) : '{' + k + '}';
            });
        },

        setLang: function(lang) {
            if (translations[lang]) {
                this._lang = lang;
                try { localStorage.setItem('bible_lang', lang); } catch(e) {}
                if (window.CXBible && window.CXBible.refresh) {
                    window.CXBible.refresh();
                }
            }
        },

        getLang: function() {
            return this._lang;
        },

        getAvailableLangs: function() {
            return Object.keys(translations).map(function(k) {
                var names = {
                    'zh-CN': '简体中文',
                    'en': 'English'
                };
                return { code: k, name: names[k] || k };
            });
        },

        /**
         * 获取中文数字数组（用于章节显示）
         * @returns {Array<string>}
         */
        getCnNums: function() {
            if (this._lang === 'zh-CN') {
                return ['零','一','二','三','四','五','六','七','八','九','十',
                    '十一','十二','十三','十四','十五','十六','十七','十八','十九','二十',
                    '二十一','二十二','二十三','二十四','二十五','二十六','二十七','二十八','二十九','三十',
                    '三十一','三十二','三十三','三十四','三十五','三十六','三十七','三十八','三十九','四十',
                    '四十一','四十二','四十三','四十四','四十五','四十六','四十七','四十八','四十九','五十'];
            }
            // 非中文环境返回 null，调用方使用阿拉伯数字
            return null;
        },

        /**
         * 格式化章节号
         * @param {number} n 章节序号
         * @returns {string}
         */
        formatChapter: function(n) {
            var nums = this.getCnNums();
            if (nums) {
                return '第' + (nums[n] || String(n)) + '章';
            }
            return 'Chapter ' + n;
        }
    };

    window.CXI18n.init();
})();
