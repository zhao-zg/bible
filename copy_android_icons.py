#!/usr/bin/env python3
"""
将 src/static/icons/icon.png 缩放为 Android mipmap 各密度图标，
写入 android/app/src/main/res/mipmap-*/ 目录。

用法：
    python copy_android_icons.py
"""

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


def main():
    if not SRC_ICON.exists():
        print(f"[ERR] Source icon not found: {SRC_ICON}")
        return

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
