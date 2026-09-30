# Forward Widget Hub

自托管的 [Forward App](https://apps.apple.com/app/id6503940939) 模块托管平台。上传 `.js` 小组件或 `.fwd` 订阅文件，自动生成可在 Forward App 中导入的订阅链接。

**在线示例：** https://forward-widget-hub.danmu.workers.dev

> **注意：** 示例站仅供体验和测试，请勿将其作为正式使用。站内内容随时可能被清空或删除，请自行部署后使用。

## 功能特性

- **拖拽上传** — 支持 `.js` 和 `.fwd` 文件的拖拽或点击上传
- **URL 转存** — 粘贴远程 `.js` / `.fwd` 链接，一键转存到平台
- **自动解析 .fwd** — 自动下载 `.fwd` 中引用的所有依赖模块并转存
- **元数据识别** — 从 JS 文件中自动解析 `WidgetMetadata`（标题、版本、作者等）
- **加密模块支持** — 自动识别 FWENC1 加密格式
- **合集管理** — 模块自动归入合集，支持增删改查和版本更新
- **订阅链接** — 每个合集自动生成 `.fwd` 订阅链接，Forward App 可直接导入
- **无需注册** — 首次上传自动生成管理令牌，凭链接即可管理

## 本版本改动（定制版）

- **手机暗色 UI** — 管理台改为暗色手机风界面，底部三 Tab：模块 / 合集 / 设置，右上角可切换深浅色（默认深色）
- **新建合集** — 合集页可直接新建空合集（标题/描述/图标），不用再靠上传 .fwd 生成
- **从模块池挑选** — 每个合集卡片下有「+ 从模块池挑选」，勾选已上传的独立模块一键加入合集（模块会从模块池移入合集）
- 原有上传、URL 转存、同步、更新版本、管理令牌、公开合集页等功能全部保留

## 部署方式

支持两种部署方式，任选其一：

| | Cloudflare | Docker |
|---|---|---|
| 存储 | D1 + R2 | SQLite + 本地文件 |
| 费用 | 免费额度内零成本 | 需要自备服务器 |
| 适合 | 无服务器、想省事 | 有服务器、想完全自控 |

---

### 方式一：一键部署到 Cloudflare

点击下方按钮，按提示授权 Cloudflare 和 GitHub 账号即可完成部署，无需任何手动配置：

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/InchStudio/forward-widget-hub)

> 部署过程会自动创建所需的 D1 数据库和 R2 存储桶，并初始化数据表。后续每次推送到 `main` 分支都会自动重新部署。

---

### 方式二：Docker 部署

#### 1. 克隆项目

```bash
git clone https://github.com/InchStudio/forward-widget-hub.git
cd forward-widget-hub
```

#### 2. 启动服务

```bash
docker compose up -d
```

启动完成后访问 http://localhost:3000 即可使用。

#### 3. 使用自定义域名

如果你有域名（比如 `https://widget.example.com`），需要修改 `docker-compose.yml` 中的 `SITE_URL`，让生成的链接指向正确的地址：

```yaml
services:
  forward-widget-hub:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
    environment:
      - SITE_URL=https://widget.example.com
    restart: unless-stopped
```

然后重新启动：

```bash
docker compose up -d --build
```

#### 4. 配置 HTTPS（推荐）

用 Nginx 做反向代理，加上 SSL 证书：

```nginx
server {
    listen 443 ssl;
    server_name widget.example.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 10m;
    }
}
```

#### 数据备份

所有数据存储在项目根目录的 `./data` 文件夹中，备份只需复制这个文件夹：

```
data/
├── db.sqlite           # 数据库
└── modules/
    └── <collection>/
        └── widget.js   # 模块文件
```

## 访问密码（可选）

设置 `ACCESS_PASSWORD` 环境变量即可为首页启用密码保护。不设置则无需密码。

**Docker** — 在 `docker-compose.yml` 的 `environment` 中添加：

```yaml
environment:
  - ACCESS_PASSWORD=你的密码
```

**Cloudflare** — 在 Cloudflare Dashboard → Workers → Settings → Variables 中添加 `ACCESS_PASSWORD`。

> 密码保护范围：首页上传界面和管理接口。模块下载链接、订阅链接等公开接口不受影响。

## 管理后台（可选）

设置 `ADMIN_PASSWORD` 环境变量即可启用管理后台，访问 `/admin` 登录后可查看和删除所有用户上传的合集。

**Docker** — 在 `docker-compose.yml` 的 `environment` 中添加：

```yaml
environment:
  - ADMIN_PASSWORD=你的管理员密码
```

**Cloudflare** — 在 Cloudflare Dashboard → Workers → Settings → Variables 中添加 `ADMIN_PASSWORD`。

> `ADMIN_PASSWORD` 与 `ACCESS_PASSWORD` 相互独立，可以设置不同的密码。

## 使用方式

1. **上传模块** — 将 `.js` 文件拖入上传区域，或粘贴远程链接点击「转存」
2. **保存令牌** — 首次上传会生成管理链接，**务必保存**（丢失无法找回）
3. **复制订阅链接** — 上传成功后复制生成的 `.fwd` 订阅链接
4. **导入 Forward** — 在 Forward App 中粘贴订阅链接即可导入

## .fwd 文件格式

`.fwd` 是一个 JSON 文件，定义了一组小组件的集合。上传后平台会自动下载所有引用的 `.js` 文件并转存：

```json
{
  "title": "我的小组件合集",
  "description": "一些实用的小组件",
  "icon": "https://example.com/icon.png",
  "widgets": [
    {
      "title": "天气组件",
      "version": "1.0.0",
      "url": "https://example.com/weather.js"
    },
    {
      "title": "日历组件",
      "url": "https://example.com/calendar.js"
    }
  ]
}
```

## 技术栈

- [Next.js](https://nextjs.org/) 16 + React 19
- [Tailwind CSS](https://tailwindcss.com/) 4
- SQLite / Cloudflare D1（数据库）
- 本地文件系统 / Cloudflare R2（文件存储）

## License

MIT
