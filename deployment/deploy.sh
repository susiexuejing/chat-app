#!/bin/bash
# 部署脚本 - chat.douhaoyu.cn
# 在本地执行此脚本，或上传到服务器执行

set -e

# 配置
APP_NAME="mental-health-chat"
DEPLOY_DIR="/var/www/chat-app"
SERVER_IP="8.145.45.174"
DOMAIN="chat.douhaoyu.cn"
BACKEND_PORT="9091"

echo "========================================="
echo " 心理咨询应用部署脚本"
echo " 域名: $DOMAIN"
echo " 服务器: $SERVER_IP"
echo "========================================="

# 1. 构建前端
echo ""
echo "[1/5] 构建前端..."
cd /workspace/projects/client
npx expo export --platform web
echo "前端构建完成 ✓"

# 2. 构建后端
echo ""
echo "[2/5] 构建后端..."
cd /workspace/projects/server
pnpm run build
echo "后端构建完成 ✓"

# 3. 上传到服务器（使用scp）
echo ""
echo "[3/5] 上传到服务器..."
echo "提示：请确保已将SSH公钥添加到服务器"
echo ""

# 创建部署目录
ssh root@$SERVER_IP "mkdir -p $DEPLOY_DIR/client $DEPLOY_DIR/server"

# 上传前端
echo "上传前端文件..."
scp -r /workspace/projects/client/dist/* root@$SERVER_IP:$DEPLOY_DIR/client/

# 上传后端
echo "上传后端文件..."
scp -r /workspace/projects/server/dist/* root@$SERVER_IP:$DEPLOY_DIR/server/

echo "文件上传完成 ✓"

# 4. 服务器端配置
echo ""
echo "[4/5] 配置服务器..."

ssh root@$SERVER_IP << 'ENDSSH'
set -e
DEPLOY_DIR="/var/www/chat-app"

# 安装依赖
cd $DEPLOY_DIR/server
pnpm install --production

# 配置nginx
cp /etc/nginx/sites-available/default /etc/nginx/sites-available/chat.douhaoyu.cn.bak 2>/dev/null || true
cat > /etc/nginx/sites-available/chat.douhaoyu.cn << 'NGINX'
server {
    listen 80;
    server_name chat.douhaoyu.cn;

    root /var/www/chat-app/client;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:9091;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_buffering off;
        proxy_cache off;
    }
}
NGINX

# 启用站点
ln -sf /etc/nginx/sites-available/chat.douhaoyu.cn /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# 配置SSL（Let's Encrypt）
echo "配置SSL证书..."
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d chat.douhaoyu.cn --non-interactive --agree-tos -m admin@douhaoyu.cn || {
    echo "SSL证书申请失败，将使用HTTP访问"
}

# 安装PM2并启动后端
npm install -g pm2
cd $DEPLOY_DIR/server
pm2 stop all 2>/dev/null || true
pm2 start dist/index.js --name "$APP_NAME-backend"
pm2 save
pm2 startup

echo "服务器配置完成 ✓"
ENDSSH

# 5. 验证部署
echo ""
echo "[5/5] 验证部署..."
sleep 2
curl -s -o /dev/null -w "HTTP状态码: %{http_code}\n" https://$DOMAIN || curl -s -o /dev/null -w "HTTP状态码: %{http_code}\n" http://$DOMAIN

echo ""
echo "========================================="
echo " 部署完成!"
echo " 访问地址: https://$DOMAIN"
echo "========================================="
