#!/bin/bash
set -e

echo "=== EmotionFlow Server Startup ==="

# 检查必要的环境变量
echo "检查环境变量..."
if [ -z "$DASHSCOPE_API_KEY" ]; then
    echo "错误: DASHSCOPE_API_KEY 环境变量未设置"
    exit 1
fi

if [ -z "$DASHSCOPE_API_KEY_DEEP" ]; then
    echo "警告: DASHSCOPE_API_KEY_DEEP 环境变量未设置，深度分析功能可能不可用"
fi

# 设置默认值
export PORT=${PORT:-3000}
export NODE_ENV=${NODE_ENV:-production}

echo "配置:"
echo "  PORT: $PORT"
echo "  NODE_ENV: $NODE_ENV"
echo "  DASHSCOPE_API_KEY: [已设置]"
echo "  DASHSCOPE_API_KEY_DEEP: $([ -n "$DASHSCOPE_API_KEY_DEEP" ] && echo '[已设置]' || echo '[未设置]')"

# 检查服务器目录
if [ ! -d "/var/www/chat-app/server" ]; then
    echo "错误: 服务器目录 /var/www/chat-app/server 不存在"
    exit 1
fi

# 启动后端服务
echo "启动后端服务..."
cd /var/www/chat-app/server

# 检查构建产物
if [ ! -f "dist/index.js" ]; then
    echo "错误: dist/index.js 不存在，请先构建项目"
    exit 1
fi

# 使用 PM2 启动
pm2 delete chat-server 2>/dev/null || true
pm2 start dist/index.js --name chat-server --update-env
pm2 save

# 配置 PM2 开机自启
echo "配置 PM2 开机自启..."
pm2 startup

echo ""
echo "=== 启动完成 ==="
pm2 status
