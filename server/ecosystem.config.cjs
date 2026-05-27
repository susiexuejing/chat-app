const fs = require('fs');
const path = require('path');

// 使用绝对路径确保能找到 .env 文件
const envPath = path.join(__dirname, '.env');
const env = fs.readFileSync(envPath, 'utf8');
const envVars = {};
env.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
    envVars[key.trim()] = valueParts.join('=').trim();
  }
});

// 构建版本信息（构建时自动注入）
envVars['GIT_COMMIT'] = '55dcaed';
envVars['BUILD_TIME'] = '2026-05-27T09:10:49Z';

module.exports = {
  apps: [{
    name: 'chat-server',
    script: 'dist/index.js',
    exec_mode: 'fork',
    env: envVars
  }]
};

