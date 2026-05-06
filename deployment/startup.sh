#!/bin/bash
set -e

echo "=== 部署聊天应用到服务器 ==="

# 创建应用目录
mkdir -p /var/www/chat-app/client /var/www/chat-app/server

# 解压前端文件
echo "解压前端文件..."
tar -xzvf /root/chat-app-dist.tar.gz -C /var/www/chat-app/client

# 解压后端文件
echo "解压后端文件..."
tar -xzvf /root/server-dist.tar.gz -C /var/www/chat-app/server

# 安装后端依赖
echo "安装后端依赖..."
cd /var/www/chat-app/server
npm install --prod

# 配置环境变量
echo "配置环境变量..."
cat > /var/www/chat-app/server/.env << 'ENVEOF'
DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
PORT=3000
NODE_ENV=production
ENVEOF

# 使用 PM2 启动后端服务
echo "启动后端服务..."
cd /var/www/chat-app/server
pm2 delete chat-server 2>/dev/null || true
pm2 start dist/index.js --name chat-server
pm2 save

# 配置 PM2 开机自启
pm2 startup

echo "=== 部署完成 ==="
echo "后端服务运行状态："
pm2 status
