# Vercel 部署指南

## 方案：前端 Vercel + 后端 Railway

由于 Vercel 不支持 Python 后端，推荐将前后端分开部署：

### 1. 部署后端（Railway）

1. 访问 [railway.app](https://railway.app) 并登录
2. 点击 **New Project** → **Deploy from GitHub repo**
3. 选择 `Liumoren000/huyuxuanju` 仓库
4. 设置根目录为 `backend`
5. 在 **Settings** → **Deploy** 中设置 Start Command:
   ```
   python -m app.main
   ```
6. 在 **Settings** → **Networking** 中生成域名（如 `https://huyuxuanju.up.railway.app`）
7. 等待部署完成

### 2. 部署前端（Vercel）

1. 访问 [vercel.com](https://vercel.com) 并登录
2. 点击 **Add New** → **Project**
3. 导入 `Liumoren000/huyuxuanju` 仓库
4. 配置：
   - **Framework Preset**: Vite
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. 点击 **Deploy**

### 3. 连接前后端

1. 打开 Vercel 项目设置 → **Environment Variables**
2. 添加环境变量：
   ```
   VITE_API_BASE = https://your-railway-url.up.railway.app
   ```
3. 重新部署前端

### 4. 更新前端 API 配置

修改 `frontend/src/services/api.js`：

```javascript
const API_BASE = import.meta.env.VITE_API_BASE || '/api';
```

### 一键部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Liumoren000/huyuxuanju&project-name=huayu-sandbox&framework=vite)
