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
            more: '更多'
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
            more: 'More'
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
