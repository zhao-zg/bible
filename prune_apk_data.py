#!/usr/bin/env python3
"""
APK 资源瘦身：控制安装包体积（目标 < 25MB）。

Capacitor 同步（npx cap sync）会把 output/ 全量复制到 Android assets，
本脚本在同步之后执行：
  1. 删除未内置译本的分片目录 data/bible/{lang}/（仅保留主版本 zh-rcv 的 bible/*.json）
  2. 删除逐词解析数据 data/parsing/（原文解析功能运行时在线拉取）
  3. 改写 data/bible-versions.json：为主版本标记 bundled=true，其余 bundled=false
     并保留 size（MB），供前端语言包管理界面展示
删除的译本由前端 lang-pack.js 在用户切换时从远程节点（Cloudflare Pages）下载并缓存。

用法：python prune_apk_data.py
"""
import json
import shutil
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / 'android' / 'app' / 'src' / 'main' / 'assets' / 'public'
PRIMARY_LANG = 'zh-rcv'
KEEP_VERSIONS = {PRIMARY_LANG}


def dir_size_mb(p: Path) -> float:
    if not p.exists():
        return 0.0
    return sum(f.stat().st_size for f in p.glob('**/*') if f.is_file()) / (1024 * 1024)


def main():
    if not ASSETS.exists():
        print(f'⚠ Android assets 目录不存在：{ASSETS}')
        sys.exit(1)

    data_dir = ASSETS / 'data'
    bible_dir = data_dir / 'bible'

    size_before = dir_size_mb(ASSETS)

    # 1. 删除未内置译本分片目录
    removed = []
    if bible_dir.exists():
        for sub in sorted(bible_dir.iterdir()):
            if sub.is_dir():
                shutil.rmtree(sub)
                removed.append(f'bible/{sub.name}')

    # 2. 删除逐词解析数据
    parsing_dir = data_dir / 'parsing'
    if parsing_dir.exists():
        shutil.rmtree(parsing_dir)
        removed.append('parsing/')

    # 3. 删除测速文件（仅部署到服务器供远程测速，不进 APK，与 CI 流程对齐）
    speedtest = ASSETS / 'speedtest.bin'
    if speedtest.exists():
        speedtest.unlink()
        removed.append('speedtest.bin')

    # 3. 改写 bible-versions.json：标记内置状态
    versions_path = data_dir / 'bible-versions.json'
    if versions_path.exists():
        with open(versions_path, 'r', encoding='utf-8') as f:
            versions = json.load(f)
        for ver in versions:
            ver['bundled'] = ver.get('lang') in KEEP_VERSIONS
        with open(versions_path, 'w', encoding='utf-8') as f:
            json.dump(versions, f, ensure_ascii=False, separators=(',', ':'))

    size_after = dir_size_mb(ASSETS)
    print(f'已移除: {", ".join(removed) if removed else "（无）"}')
    print(f'APK assets 体积: {size_before:.1f} MB → {size_after:.1f} MB（目标 < 25 MB）')
    if size_after >= 25:
        print('⚠ 仍超过 25MB，请检查内置清单')
        sys.exit(2)
    print('[OK] APK 资源瘦身完成')


if __name__ == '__main__':
    main()
