# 华域 - 选举制度推演沙盒

社会选择与选举制度推演可视化平台。基于中国地级市数据，支持对比不同选举制度下的政治版图与组阁走向。

## 快速开始

### 后端

```bash
cd backend
pip install -r requirements.txt
python -m app.main
```

后端运行在 http://localhost:8000

### 前端

```bash
cd frontend
npm install
npm run dev
```

前端运行在 http://localhost:5173

## 功能特性

- 双方案对比推演 (FPTP vs PR)
- D'Hondt 与 Sainte-Laguë 席位分配算法
- 可视化政治地图（基于 DataV GeoJSON）
- 半圆形议会席位分布图
- 最小获胜联盟推演
- 7 个预设政党模型，支持光谱调整
- 344+ 地级市模拟数据

## 技术栈

- **后端**: FastAPI + Pydantic
- **前端**: React + Vite + ECharts
- **数据处理**: NumPy
