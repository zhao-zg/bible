#!/bin/bash
# Cloudflare Pages 构建脚本
set -e

echo "📖 开始构建圣经应用..."

# 安装 Python 依赖
echo "📦 安装依赖..."
pip install -r requirements.txt

# 生成静态文件
echo "🔨 生成静态文件..."
python main.py

echo "✅ 构建完成！"
