#!/usr/bin/env python3
"""
将 src/static/icons/icon-512.png 缩放为 Android mipmap 各密度图标，
写入 android/app/src/main/res/mipmap-*/ 目录。

同时删除 Capacitor 6 模板自带的自适应图标（Adaptive Icon）资源，
确保 Android 8.0+ 设备使用自定义 PNG 图标而非 Capacitor 默认图标。

用法：
    python copy_android_icons.py
"""

import shutil
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("需要 Pillow: pip install Pillow")
    raise

# 项目根目录
ROOT = Path(__file__).resolve().parent

# 源图标（使用 512px 版本，足够所有 mipmap 密度）
SRC_ICON = ROOT / "src" / "static" / "icons" / "icon-512.png"

# Android res 目录
RES_DIR = ROOT / "android" / "app" / "src" / "main" / "res"

# mipmap 密度 → 像素尺寸
DENSITIES = {
    "mipmap-mdpi":    48,
    "mipmap-hdpi":    72,
    "mipmap-xhdpi":   96,
    "mipmap-xxhdpi":  144,
    "mipmap-xxxhdpi": 192,
}

# 输出文件名
ICONS = ["ic_launcher.png", "ic_launcher_round.png"]


def remove_adaptive_icons():
    """删除 Capacitor 6 模板自带的自适应图标资源，
    防止 Android 8.0+ 优先使用默认自适应图标而忽略自定义 PNG。
    注意：只删除自适应图标相关文件，保留 splash.png 等其他资源。"""
    dir_targets = [
        RES_DIR / "mipmap-anydpi-v26",   # 自适应图标 XML
        RES_DIR / "drawable-v24",         # 矢量前景图
    ]
    for t in dir_targets:
        if t.exists():
            shutil.rmtree(t)
            print(f"  删除自适应图标: {t.name}")

    # 只删除 drawable 中的自适应图标背景色文件，保留 splash.png
    bg_color = RES_DIR / "drawable" / "ic_launcher_background.xml"
    if bg_color.exists():
        bg_color.unlink()
        print("  删除自适应图标背景色: drawable/ic_launcher_background.xml")

    # 删除 values/ic_launcher_background.xml（自适应图标背景色定义）
    bg_value = RES_DIR / "values" / "ic_launcher_background.xml"
    if bg_value.exists():
        bg_value.unlink()
        print("  删除自适应图标背景色: values/ic_launcher_background.xml")


def main():
    if not SRC_ICON.exists():
        print(f"[ERR] Source icon not found: {SRC_ICON}")
        return

    # 先清除自适应图标，确保系统回退到 PNG mipmap
    remove_adaptive_icons()

    img = Image.open(SRC_ICON).convert("RGBA")

    for folder, size in DENSITIES.items():
        dir_path = RES_DIR / folder
        dir_path.mkdir(parents=True, exist_ok=True)

        resized = img.resize((size, size), Image.LANCZOS)

        for name in ICONS:
            out = dir_path / name
            resized.save(out, "PNG")

        print(f"  {folder}: {size}x{size} OK")

    print("[OK] Android mipmap icons generated")


if __name__ == "__main__":
    main()
