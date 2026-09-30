# Forward Widget Hub - 设计文档

## 概述

一个开源的 ForwardWidget 模块托管平台，允许用户上传 `.js` 模块文件和 `.fwd` 模块合集，生成可在 Forward App 中直接导入的订阅链接。

## 核心场景

- **个人托管**：用户上传自己的模块并获得托管链接，可分享给他人手动导入
- **认证方式**：上传时生成管理 Token，通过管理链接访问，无需注册账号
- **部署方式**：Docker 单容器部署

## 技术栈

- **前端**：Next.js 15 (App Router) + React 19 + Tailwind CSS + shadcn/ui
- **后端**：Next.js API Routes (Route Handlers)
- **数据库**：SQLite (better-sqlite3)
- **文件存储**：本地文件系统
- **部署**：Docker (multi-stage build)

## 数据模型

### users 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | nanoid |
| token_hash | TEXT UNIQUE | SHA-256 hash of token |
| token_prefix | TEXT | 前 6 字符，用于快速查找 |
| name | TEXT | 可选显示名 |
| created_at | INTEGER | 创建时间 (unixepoch) |

### collections 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | nanoid |
| user_id | TEXT FK | 关联 users |
| slug | TEXT UNIQUE | URL 友好标识 |
| title | TEXT | 集合标题 |
| description | TEXT | 集合描述 |
| icon_url | TEXT | 图标 URL |
| created_at | INTEGER | 创建时间 |
| updated_at | INTEGER | 更新时间 |

### modules 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | nanoid |
| collection_id | TEXT FK | 关联 collections |
| filename | TEXT | 原始文件名 |
| widget_id | TEXT | 从 WidgetMetadata 提取 |
| title | TEXT | 从 WidgetMetadata 提取 |
| description | TEXT | 模块描述 |
| version | TEXT | 模块版本 |
| author | TEXT | 作者 |
| file_size | INTEGER | 文件大小 |
| is_encrypted | BOOLEAN | 是否已加密 |
| created_at | INTEGER | 创建时间 |
| updated_at | INTEGER | 更新时间 |

## API 设计

### 公开端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/upload` | 上传 .js 文件，首次自动创建 user + token |
| GET | `/api/collections/:slug` | 获取集合信息和模块列表 |
| GET | `/api/collections/:slug/fwd` | 生成 .fwd 索引（Forward App 使用） |
| GET | `/api/modules/:id/raw` | 下载原始 .js 文件 |

### 需认证端点（token）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/manage` | 获取自己的所有集合 |
| PUT | `/api/collections/:id` | 更新集合信息 |
| POST | `/api/collections/:id/upload` | 上传模块到指定集合 |
| PUT | `/api/modules/:id` | 更新模块 |
| DELETE | `/api/modules/:id` | 删除模块 |

### Token 认证方式

- URL path: `/manage/fwt_xxxxx`（前端自动提取存入 localStorage）
- Query param: `?token=fwt_xxxxx`（API 调用时前端自动附带）
- Header: `Authorization: Bearer fwt_xxxxx`（可选）

## Token 安全

1. **生成**：`crypto.randomBytes(32)` → 256-bit，base64url 编码，前缀 `fwt_`
2. **存储**：数据库存 SHA-256 hash，不存明文
3. **速率限制**：每 IP 每分钟最多 10 次认证请求，连续失败 5 次锁定 15 分钟
4. **传递**：前端通过 localStorage 管理，API 调用时自动附带

## 页面结构

### 1. 首页 `/`
- 项目介绍 + 突出的拖拽上传区域
- 说明什么是 ForwardWidget 以及如何在 App 中导入

### 2. 上传结果（上传成功后展示）
- 显示管理 Token 和管理链接（醒目提示保存）
- 显示 `.fwd` 订阅链接
- 已上传模块列表预览

### 3. 管理页 `/manage/[token]`
- 集合列表 + 每个集合的模块管理
- 上传新模块、删除模块、编辑集合信息
- 集合的 `.fwd` 订阅链接

### 4. 集合公开页 `/c/[slug]`
- 展示集合名、描述、模块列表
- 复制 `.fwd` 链接按钮

## 核心流程

### 首次上传
1. 用户拖入 .js 文件到首页上传区
2. 服务端解析 WidgetMetadata 提取元数据
3. 创建 user（生成 token）+ collection + module
4. 存储 .js 文件到本地 `/data/modules/`
5. 返回 `{ token, manageUrl, collectionUrl }`

### Forward App 导入
1. 用户复制 `.fwd` 链接 `/api/collections/:slug/fwd`
2. Forward App 拉取 .fwd JSON 索引
3. 逐个下载 .js 模块文件
4. 自动检测并解密加密模块

### 模块管理
1. 用户访问管理链接 `/manage/fwt_xxxxx`
2. 前端提取 token 存入 localStorage
3. 查看/上传/更新/删除模块

## 文件存储结构

```
/data/
├── db.sqlite                    # SQLite 数据库
└── modules/
    └── {collection_id}/
        └── {filename}.js        # 模块文件
```

## Docker 部署

### Dockerfile (multi-stage)
- Builder: `node:20-alpine`，编译 Next.js
- Runner: `node:20-alpine`，运行 standalone output
- 单个 volume `/data` 包含所有持久化数据

### 一键部署
```bash
docker run -d -p 3000:3000 -v ./data:/data ghcr.io/user/forward-widget-hub
```

### docker-compose.yml
```yaml
services:
  forward-widget-hub:
    image: ghcr.io/user/forward-widget-hub
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
    environment:
      - SITE_URL=https://your-domain.com
```

## 模块元数据解析

服务端使用安全的沙箱方式解析 `WidgetMetadata`：
- 使用正则或 AST 解析提取 `var WidgetMetadata = {...}` 部分
- 不执行用户上传的 JS 代码（避免安全风险）
- 提取字段：id, title, description, version, author, requiredVersion

## UI 技术

- Tailwind CSS 样式
- shadcn/ui 组件库
- 支持深色/浅色主题
- 响应式设计
