#!/usr/bin/env python3
"""
圣经阅读器构建脚本
从 CG.db 导出圣经数据，生成静态 PWA/APK 站点

3 阶段构建：
  1. 圣经数据准备（调用 export_bible_sql_json.py）
  2. 静态站点生成（复制资产 + 生成 manifest.json / sw.js）
  3. 版本与配置（version.json + remote-config.js）
"""

import base64
import json
import os
import shutil
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import yaml

# 项目根目录
ROOT_DIR = Path(__file__).resolve().parent


def main():
    """主构建入口 - 3 个阶段"""
    # 确保 stdout 使用 UTF-8
    if hasattr(sys.stdout, 'reconfigure'):
        try:
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass

    start_time = time.time()

    print("=" * 60)
    print(" 圣经阅读器构建脚本")
    print("=" * 60)
    print()

    # 加载配置
    config = load_config()
    print("✓ 配置文件加载成功")

    # 同步版本号到 package.json（Capacitor 从中读取 APK 版本）
    sync_version()

    output_dir = ROOT_DIR / config.get('output_dir', 'output')

    # 清理旧的 output 目录，避免残留文件（如 zh-rcv/）
    if os.path.exists(output_dir):
        # Windows 上可能有进程锁定，使用 onexc 跳过无法删除的文件
        shutil.rmtree(output_dir, onexc=lambda *a: None)

    # 阶段 1：圣经数据准备
    print("\n📖 阶段 1：圣经数据准备...")
    prepare_bible_data(config, output_dir)

    # 阶段 2：静态站点生成
    print("\n🏗️  阶段 2：生成静态站点...")
    generate_static_site(config, output_dir)

    # 阶段 2.5：多版本数据已直接保留在 bible/{lang}/ 目录中，无需 ZIP 打包
    # （APK/PWA 直接加载分片文件，无需远程下载）

    # 阶段 3：版本与配置
    print("\n📋 阶段 3：版本与配置...")
    generate_version_and_config(config, output_dir)

    elapsed = time.time() - start_time
    print(f"\n{'=' * 60}")
    print(f"✅ 构建完成！耗时 {elapsed:.1f} 秒")
    print(f"所有输出文件位于: {output_dir}/")
    print("=" * 60)


def load_config():
    """加载 config.yaml"""
    config_path = ROOT_DIR / 'config.yaml'
    with open(config_path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)


def sync_version():
    """将 app_config.json 的版本号同步到 package.json，确保 Capacitor 打包时使用正确版本"""
    app_config_path = ROOT_DIR / 'app_config.json'
    pkg_path = ROOT_DIR / 'package.json'

    if not app_config_path.exists():
        print("⚠ app_config.json 不存在，跳过版本同步")
        return

    with open(app_config_path, 'r', encoding='utf-8') as f:
        app_config = json.load(f)
    app_version = app_config.get('version', '1.0.0')

    if not pkg_path.exists():
        print("⚠ package.json 不存在，跳过版本同步")
        return

    with open(pkg_path, 'r', encoding='utf-8') as f:
        pkg = json.load(f)

    old_version = pkg.get('version', '')
    if old_version == app_version:
        print(f"✓ 版本号已同步（v{app_version}）")
        return

    pkg['version'] = app_version
    with open(pkg_path, 'w', encoding='utf-8') as f:
        json.dump(pkg, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f"✓ 版本号已同步：{old_version} → {app_version}（package.json）")


# ──────────────────────── 阶段 1：圣经数据准备 ────────────────────────

def prepare_bible_data(config, output_dir):
    """调用 export_bible_sql_json.py 导出圣经数据到 output/data/"""
    db_path = ROOT_DIR / config.get('bible_db', 'resource/CG.db')
    data_dir = output_dir / 'data'
    data_dir.mkdir(parents=True, exist_ok=True)

    if not db_path.exists():
        print(f"✗ 圣经数据库不存在：{db_path}")
        sys.exit(1)

    # 将项目根目录加入 sys.path，以便导入 export_bible_sql_json
    root_str = str(ROOT_DIR)
    if root_str not in sys.path:
        sys.path.insert(0, root_str)

    from export_bible_sql_json import export_all

    print(f"  数据源：{db_path}")
    export_all(db_path, data_dir, normalize_xref=True)

    # 递归压缩 output/data/ 下所有 JSON（去缩进）减少打包体积
    compressed = 0
    saved_bytes = 0
    for dirpath, _dirnames, filenames in os.walk(data_dir):
        for filename in filenames:
            if not filename.endswith('.json'):
                continue
            filepath = Path(dirpath) / filename
            orig_size = filepath.stat().st_size
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                with open(filepath, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
                new_size = filepath.stat().st_size
                saved_bytes += orig_size - new_size
                compressed += 1
            except Exception as e:
                print(f"  ⚠ 压缩失败 {filepath}: {e}")
    print(f"✓ JSON 压缩完成：{compressed} 个文件，节省 {saved_bytes / 1024 / 1024:.2f} MB")


# ──────────────────────── 阶段 2：静态站点生成 ────────────────────────

def generate_static_site(config, output_dir):
    """复制静态资产到 output/，生成 manifest.json 和 sw.js"""
    static_dir = ROOT_DIR / config.get('static_dir', 'src/static')
    template_dir = ROOT_DIR / 'src' / 'templates'

    # 1. 复制 index.html
    copy_index_html(static_dir, output_dir)

    # 2. 复制 CSS
    copy_css(static_dir, output_dir)

    # 3. 复制 JS（排除不需要的文件）
    copy_js(static_dir, output_dir)

    # 4. 复制 icons
    copy_icons(static_dir, output_dir)

    # 5. 复制 vendor
    copy_vendor(static_dir, output_dir)

    # 6. 复制静态 data 目录（book-names-i18n.json 等）
    copy_static_data(static_dir, output_dir)

    # 7. 复制圣经插图
    copy_images(static_dir, output_dir)

    # 8. 生成 manifest.json（替换名称）
    generate_manifest(template_dir, output_dir)

    # 9. 生成 sw.js
    generate_sw(template_dir, output_dir)

    # 10. 复制 _redirects
    copy_template_file(template_dir / '_redirects', output_dir / '_redirects')

    # 11. 复制 changelog.json（如存在）
    changelog = ROOT_DIR / 'changelog.json'
    if changelog.exists():
        shutil.copy2(changelog, output_dir / 'changelog.json')
        print("✓ changelog.json 已复制")

    # 12. 创建 .nojekyll
    (output_dir / '.nojekyll').write_text('', encoding='utf-8')


def copy_index_html(static_dir, output_dir):
    """复制 index.html 到 output/"""
    src = static_dir / 'index.html'
    if not src.exists():
        print(f"⚠ 未找到 {src}")
        return
    shutil.copy2(src, output_dir / 'index.html')
    print("✓ index.html 已复制")


def copy_css(static_dir, output_dir):
    """复制 CSS 文件到 output/css/，可选 rcssmin 压缩"""
    css_src = static_dir / 'css'
    if not css_src.exists():
        return
    css_dst = output_dir / 'css'
    css_dst.mkdir(parents=True, exist_ok=True)

    try:
        import rcssmin
        has_cssmin = True
    except ImportError:
        has_cssmin = False

    file_count = 0
    saved_bytes = 0
    for f in css_src.iterdir():
        if not (f.is_file() and f.suffix == '.css'):
            continue
        orig_size = f.stat().st_size
        if has_cssmin:
            try:
                code = f.read_text(encoding='utf-8')
                minified = rcssmin.cssmin(code)
                (css_dst / f.name).write_text(minified, encoding='utf-8')
                new_size = len(minified.encode('utf-8'))
                saved_bytes += orig_size - new_size
            except Exception as e:
                print(f"  ⚠ CSS 压缩失败 {f.name}: {e}，回退到直接复制")
                shutil.copy2(f, css_dst / f.name)
        else:
            shutil.copy2(f, css_dst / f.name)
        file_count += 1

    if has_cssmin and file_count:
        print(f"✓ CSS 压缩完成：{file_count} 个文件，节省 {saved_bytes / 1024:.1f} KB")
    else:
        if not has_cssmin:
            print("⚠ rcssmin 未安装，CSS 未压缩（pip install rcssmin）")
        print(f"✓ CSS 文件已复制（{file_count} 个）")


def copy_js(static_dir, output_dir):
    """复制 JS 文件到 output/js/，可选 rjsmin 压缩（vendor/ 由 copy_vendor 处理）"""
    js_src = static_dir / 'js'
    if not js_src.exists():
        return
    js_dst = output_dir / 'js'
    js_dst.mkdir(parents=True, exist_ok=True)

    try:
        import rjsmin
        has_jsmin = True
    except ImportError:
        has_jsmin = False

    copied = 0
    saved_bytes = 0
    for f in js_src.iterdir():
        if not f.is_file():
            continue
        orig_size = f.stat().st_size
        if has_jsmin:
            try:
                code = f.read_text(encoding='utf-8')
                minified = rjsmin.jsmin(code)
                (js_dst / f.name).write_text(minified, encoding='utf-8')
                new_size = len(minified.encode('utf-8'))
                saved_bytes += orig_size - new_size
            except Exception as e:
                print(f"  ⚠ JS 压缩失败 {f.name}: {e}，回退到直接复制")
                shutil.copy2(f, js_dst / f.name)
        else:
            shutil.copy2(f, js_dst / f.name)
        copied += 1

    if has_jsmin and copied:
        print(f"✓ JS 压缩完成：{copied} 个文件，节省 {saved_bytes / 1024:.1f} KB")
    else:
        if not has_jsmin:
            print("⚠ rjsmin 未安装，JS 未压缩（pip install rjsmin）")
        print(f"✓ JS 文件已复制（{copied} 个）")


def copy_icons(static_dir, output_dir):
    """复制图标文件到 output/icons/，排除未使用的原图 icon.png"""
    icons_src = static_dir / 'icons'
    if not icons_src.exists():
        return
    icons_dst = output_dir / 'icons'
    icons_dst.mkdir(parents=True, exist_ok=True)
    # icon.png (2048x2048) 未在任何地方引用，排除以减小体积
    excluded = {'icon.png'}
    for f in icons_src.iterdir():
        if f.is_file() and f.name not in excluded:
            shutil.copy2(f, icons_dst / f.name)
    print("✓ 图标文件已复制")


def copy_vendor(static_dir, output_dir):
    """复制 vendor 目录（第三方库）到 output/vendor/"""
    vendor_src = static_dir / 'js' / 'vendor'
    if not vendor_src.exists():
        return
    vendor_dst = output_dir / 'vendor'
    vendor_dst.mkdir(parents=True, exist_ok=True)
    for f in vendor_src.iterdir():
        if f.is_file():
            shutil.copy2(f, vendor_dst / f.name)
    print("✓ vendor 目录已复制")


def copy_images(static_dir, output_dir):
    """复制并转换 9 张圣经插图到 output/img/（PNG → WebP）

    转换策略：
    - 所有图片统一转为 WebP 格式（quality=82，视觉无损，体积缩小约 40-60%）
    - 大于 500KB 的源图：若宽或高超过 1200px 则缩小 50%
    - Pillow 不可用时回退为直接复制 PNG（不转换）
    """
    img_src = static_dir / 'img'
    if not img_src.exists():
        return

    required_images = [
        '18.png', 'NW.png', 'br.png', 'EO.png', 'kE.png',
        'KR.png', 'Mr.png', 'O9.png', 'XJ.png'
    ]
    img_dst = output_dir / 'img'
    img_dst.mkdir(parents=True, exist_ok=True)

    # 尝试加载 Pillow
    try:
        from PIL import Image
        has_pillow = True
    except ImportError:
        has_pillow = False
        print("⚠ Pillow 未安装，插图不压缩（pip install Pillow）")

    copied = 0
    for filename in required_images:
        src_file = img_src / filename
        if not src_file.exists():
            print(f"⚠ 未找到圣经插图：{filename}")
            continue

        # 输出文件名：.png → .webp
        webp_name = Path(filename).stem + '.webp'
        dst_file = img_dst / webp_name
        orig_size = src_file.stat().st_size

        if not has_pillow:
            # 无 Pillow：直接复制原 PNG，不改扩展名
            dst_file = img_dst / filename
            shutil.copy2(src_file, dst_file)
        else:
            img = Image.open(src_file)
            # 大于 500KB 且尺寸过大时先缩小
            if orig_size > 500 * 1024:
                w, h = img.size
                if w > 1200 or h > 1200:
                    img = img.resize((w // 2, h // 2), Image.LANCZOS)
            img.save(dst_file, 'WEBP', quality=82, method=6)

        new_size = dst_file.stat().st_size
        saved = (1 - new_size / orig_size) * 100 if orig_size else 0
        print(f"  {filename} → {webp_name if has_pillow else filename}: "
              f"{orig_size//1024}KB → {new_size//1024}KB ({saved:.0f}% saved)")
        copied += 1

    print(f"✓ 圣经插图已处理（{copied}/{len(required_images)}）")


def copy_static_data(static_dir, output_dir):
    """复制 src/static/data/ 中的静态数据文件（如 book-names-i18n.json）到 output/data/，并压缩"""
    data_src = static_dir / 'data'
    if not data_src.exists():
        return
    data_dst = output_dir / 'data'
    data_dst.mkdir(parents=True, exist_ok=True)
    copied = 0
    for f in data_src.iterdir():
        if f.is_file() and f.suffix == '.json':
            # 复制并压缩
            with open(f, 'r', encoding='utf-8') as fh:
                data = json.load(fh)
            with open(data_dst / f.name, 'w', encoding='utf-8') as fh:
                json.dump(data, fh, ensure_ascii=False, separators=(',', ':'))
            copied += 1
    if copied:
        print(f"✓ 静态数据文件已复制并压缩（{copied} 个）")


def generate_manifest(template_dir, output_dir):
    """从模板生成 manifest.json，替换名称为圣经"""
    manifest_src = template_dir / 'main_manifest.json'
    if not manifest_src.exists():
        print("⚠ manifest 模板不存在")
        return

    with open(manifest_src, 'r', encoding='utf-8-sig') as f:
        manifest = json.load(f)

    # 替换为圣经项目信息
    manifest['name'] = '圣经'
    manifest['short_name'] = '圣经'
    manifest['description'] = '多语言圣经阅读 - 含注解和串珠'

    out_path = output_dir / 'manifest.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print("✓ manifest.json 已生成")


def generate_sw(template_dir, output_dir):
    """从模板生成 sw.js，注入构建时间戳以触发 SW 更新"""
    sw_src = template_dir / 'main_sw.js'
    if not sw_src.exists():
        print("⚠ sw.js 模板不存在")
        return
    # 读取模板并替换 __BUILD_TIME__ 为当前构建时间戳
    content = sw_src.read_text(encoding='utf-8')
    build_ts = datetime.now(timezone(timedelta(hours=8))).strftime('%Y%m%d%H%M%S')
    content = content.replace('__BUILD_TIME__', build_ts)
    out_path = output_dir / 'sw.js'
    out_path.write_text(content, encoding='utf-8')
    print(f"✓ sw.js 已生成（版本 {build_ts}）")


def copy_template_file(src, dst):
    """复制模板文件（如 _redirects）"""
    if src.exists():
        shutil.copy2(src, dst)
        print(f"✓ {src.name} 已复制")


# ──────────────────────── 阶段 3：版本与配置 ────────────────────────

def generate_version_and_config(config, output_dir):
    """生成 version.json、remote-config.js，复制 app_config.json"""

    # 1. 读取 app_config.json 获取版本号
    app_config_path = ROOT_DIR / 'app_config.json'
    app_version = '1.0.0'
    if app_config_path.exists():
        with open(app_config_path, 'r', encoding='utf-8') as f:
            app_config = json.load(f)
        app_version = app_config.get('version', '1.0.0')

    # 2. 生成 version.json
    tz_cn = timezone(timedelta(hours=8))
    now = datetime.now(tz_cn)
    version_info = {
        'version': app_version,
        'build_time': now.strftime('%Y-%m-%dT%H:%M:%S+08:00'),
        'apk_version': app_version,
        'apk_file': f'bible-v{app_version}.apk',
    }
    version_path = output_dir / 'version.json'
    with open(version_path, 'w', encoding='utf-8') as f:
        json.dump(version_info, f, ensure_ascii=False, indent=2)
    print(f"✓ version.json 已生成（v{app_version}）")

    # 3. 生成 remote-config.js（如果有远程服务器配置）
    remote_servers = config.get('remote_servers', {})
    if remote_servers:
        generate_remote_config_js(remote_servers, output_dir)

    # 4. 复制 app_config.json 到 output/
    if app_config_path.exists():
        shutil.copy2(app_config_path, output_dir / 'app_config.json')
        print("✓ app_config.json 已复制")


def generate_remote_config_js(remote_servers, output_dir):
    """从配置生成 remote-config.js（URL 以 base64 存储，运行时 atob() 解码）"""
    def b64(s):
        return base64.b64encode(s.encode()).decode()

    def arr(urls):
        if not urls:
            return '[]'
        return '[' + ','.join(f"_d('{b64(u)}')" for u in urls) + ']'

    cf = remote_servers.get('cloudflare', [])
    gh_api = remote_servers.get('github_api', '')
    mirrors = remote_servers.get('github_mirrors', [])
    push = remote_servers.get('push', [])
    ip_apis = remote_servers.get('ip_apis', [])

    js = (
        "(function(){"
        "function _d(s){return atob(s);}"
        "window.CX_SERVERS={"
        f"cloudflare:{arr(cf)},"
        f"githubApi:_d('{b64(gh_api)}'),"
        f"githubMirrors:{arr(mirrors)},"
        f"push:{arr(push)},"
        f"ipApis:{arr(ip_apis)}"
        "};})();"
    )

    js_dir = output_dir / 'js'
    js_dir.mkdir(parents=True, exist_ok=True)
    out_path = js_dir / 'remote-config.js'
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(js)
    print(f"✓ remote-config.js 已生成")


if __name__ == '__main__':
    main()
