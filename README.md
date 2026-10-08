> [!WARNING]
> **This is a patched fork of Memos v0.18.2.**
>
> This repository is **not** the official `usememos/memos`. It is based on the upstream
> source at [usememos/memos/tree/v0.18.2](https://github.com/usememos/memos/tree/v0.18.2)
> with a small set of SQLite-specific bug fixes, because the official v0.18.2 image
> becomes permanently unreachable on large databases.
>
> **Upstream reference:** `v0.18.2` • **Base:** <https://github.com/usememos/memos/tree/v0.18.2>
>
> Please read [What was changed and why](#what-was-changed-and-why) before deploying.

<img height="56px" src="https://www.usememos.com/full-logo-landscape.png" alt="Memos" />

A privacy-first, lightweight note-taking service. Easily capture and share your great thoughts.

<a href="https://www.usememos.com">Home Page</a> •
<a href="https://www.usememos.com/blog">Blogs</a> •
<a href="https://www.usememos.com/docs">Docs</a> •
<a href="https://demo.usememos.com/">Live Demo</a>

<p>
  <a href="https://github.com/usememos/memos/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/usememos/memos?logo=github" /></a>
  <a href="https://hub.docker.com/r/neosmemo/memos"><img alt="Docker pull" src="https://img.shields.io/docker/pulls/neosmemo/memos.svg"/></a>
  <a href="https://hosted.weblate.org/engage/memos-i18n/"><img src="https://hosted.weblate.org/widget/memos-i18n/english/svg-badge.svg" alt="Translation status" /></a>
  <a href="https://discord.gg/tfPJa4UmAv"><img alt="Discord" src="https://img.shields.io/badge/discord-chat-5865f2?logo=discord&logoColor=f5f5f5" /></a>
</p>

![demo](https://www.usememos.com/demo.webp)

## Key points

- **Open source and free forever**. Embrace a future where creativity knows no boundaries with our open-source solution – free today, tomorrow, and always.
- **Self-hosting with Docker in just seconds**. Enjoy the flexibility, scalability, and ease of setup that Docker provides, allowing you to have full control over your data and privacy.
- **Pure text with added Markdown support.** Say goodbye to the overwhelming mental burden of rich formatting and embrace a minimalist approach.
- **Customize and share your notes effortlessly**. With our intuitive sharing features, you can easily collaborate and distribute your notes with others.
- **RESTful API for third-party services.** Embrace the power of integration and unleash new possibilities with our RESTful API support.

## What was changed and why

本仓库基于上游 `v0.18.2` 源码，仅修改了**一个文件**：`store/db/sqlite/sqlite.go`（另新增一个回归测试文件）。前端、业务逻辑、API 与数据库结构均未改动。

### 问题现象

在数据量较大（SQLite 单文件超过数 GB）时，v0.18.2 容器运行一段时间后会**永久无法访问**：进程仍在运行，`/healthz` 有响应，但所有需要数据库的接口（含图片加载）**无限期挂起且无任何错误日志**，只能重启容器恢复。日志中偶见：

```
failed to get user: interrupted (9)
```

其中 `interrupted (9)` 即 `SQLITE_INTERRUPT`。

上游相关 issue（截至本仓库修改时**仍未修复**）：

- [usememos/memos#3922](https://github.com/usememos/memos/issues/3922) — Recurring bug with docker container: failed to get user: interrupted (9)
- [usememos/memos#4317](https://github.com/usememos/memos/issues/4317) — Memos container stops working after some time running（维护者标记为 #3922 重复）

### 根本原因

**1. 删除操作触发全库 `VACUUM`（主因）**

原 `Vacuum()` 实现在每次删除后都会执行一次**全库重写**：

```go
// 修改前：DeleteResource / DeleteMemo / DeleteUser 都会调用
if _, err := d.db.Exec("VACUUM"); err != nil {
```

`VACUUM` 的耗时与临时磁盘占用**随数据库大小线性增长**，且全程持有排他写锁。在数GB 的数据库上，单次 `VACUUM` 可能持续数分钟，导致其余连接持续争抢锁，而 `busy_timeout` 仅为 10 秒。

更严重的是删除附件时**没有批量接口**——编辑一条含 N 张图片的 memo 并移除其中一张，会**串行触发 N 次全库 `VACUUM`**。

由于 v2 API 路由未设置超时（`timeoutSkipper` 跳过了所有 `/memos.api.v2.*`），这些请求会**无限期挂起**，表现为「服务失联但无日志」。

**2. 数据库连接池无上限**

原代码从未调用 `SetMaxOpenConns`，即 `MaxOpenConns=0`（**不限制并发连接数**）。图片请求在读取 blob 期间会各自占用一个连接，当并发请求数足够多时，所有连接被占满，其余查询**永久等待**，同样表现为静默失联。

**3. 内存与磁盘放大**

附件存于 Database 时，每次读取都会 `io.ReadAll` 将完整 blob 载入内存；`VACUUM` 期间还需约等于数据库大小的额外临时空间。

### 具体修改

| # | 修改 | 说明 |
|---|------|------|
| 1 | **移除运行时全库 `VACUUM`** | 删除后改为 `PRAGMA wal_checkpoint(TRUNCATE)`，瞬时完成，不重写数据、不长时间持锁，且失败不影响删除操作 |
| 2 | **启用增量自动回收** | `auto_vacuum(INCREMENTAL)` 写入 DSN（必须排在 `journal_mode` 之前，否则会被静默忽略）+ `incremental_vacuum`，空间仍会自动回收，但不再需要阻塞式全库重写（这是保留单文件 SQLite 的关键） |
| 3 | **限制连接池** | `SetMaxOpenConns(4)` / `SetMaxIdleConns(4)` / `SetConnMaxLifetime(1h)`，防止图片请求占满连接导致其他查询饿死 |
| 4 | **加固 PRAGMA** | `busy_timeout` 10s → 30s，新增 `synchronous(NORMAL)` 与 `cache_size(-65536)`（64MB 页缓存） |
| 5 | **修复全新部署迁移失败** | `Migrate` 原以「文件是否存在」判断新库，但打开数据库的 PRAGMA 已会创建文件，导致全新 prod 部署报 `no such table: migration_history`。改为判断「是否无任何用户表」 |
| 6 | **修复静态资源缓存导致的白屏** | 为 `/assets/*` 增加独立路由，缺失资源返回 404 而非回退 index.html；`index.html` 设 `no-cache`，带 hash 的资源设 `immutable` |

> ⚠️ **注意**：本补丁**不修改数据库结构**，无需迁移，可直接覆盖部署。但它**修复的是「永久失联」**，并不会缩小已有数据库体积。

### 保留单文件 SQLite

本补丁的目的正是让**单文件 SQLite 存储**在大数据量下继续可用。若改用 Local Storage 存储附件，同样能规避该问题，但会改变数据存储方式，故未采用。

### 新增诊断日志

排查问题时可直接看容器日志，无需 attach 数据库：

| 日志关键字 | 含义 / 排查方向 |
|---|---|
| `starting memos` | 启动时的 version / mode / driver / data_dir。**若未出现，说明 profile 加载失败** |
| `sqlite database configured` | 启动即打印 `journal_mode`、`auto_vacuum`、`page_count`、`freelist_count`、`db_size_bytes`、`free_bytes`、`max_open_conns` |
| `sqlite auto_vacuum is not incremental` | **需要执行一次离线 `VACUUM`**（见下节）。修复前该 PRAGMA 被静默忽略，故此告警是判断是否已切换成功的唯一依据 |
| `sqlite connection pool` | 每 30 秒打印连接池 `open_connections / in_use / idle / wait_count / wait_duration` |
| `sqlite connection pool saturated` | 池已打满。若持续出现且请求变慢，说明有慢查询或长事务占住了连接 |
| `sqlite vacuum begin` / `sqlite vacuum done` | 删除操作前后的空闲页统计与耗时。**耗时若随数据库增大而变长，说明全库重写又回来了** |
| `slow request` | 超过 3s 的请求（含 uri 与 latency）。v2 API 无超时机制，卡住的请求只能靠这条暴露 |
| `frontend assets verified` | 启动即校验 `index.html` 引用的资源是否都存在，并记录 `index_sha256`。**若报 `index.html references assets that do not exist`，说明镜像构建有问题** |
| `requested frontend asset does not exist` | 浏览器请求了当前构建不存在的资源。**这条就是白屏的直接原因**，出现时请清理该站点浏览器缓存 |

> 💡 **白屏自查**：看到白屏时先在日志里搜 `frontend assets`。若出现 `requested frontend asset does not exist`，是浏览器缓存了旧版 `index.html`，清理该站点缓存或强制刷新即可。

### 验证

新增回归测试：

```bash
# 空白页：缺失资源必须返回 404，且 index.html 不可缓存
go test ./server/frontend/ -v

# SQLite：连接池上限、auto_vacuum 生效、删除不触发全库重写、全新部署可迁移
go test ./store/db/sqlite/ -v
```

其中 `TestVacuumDoesNotRewriteWholeDatabase` 会构造约 48MB 的附件库并计时删除操作，
防止全库 `VACUUM` 被重新引入；`TestMigrateAppliesSchemaOnFreshDatabase` 防止全新
部署因迁移判断错误而启动失败。

### 部署后建议：离线回收数据库空间

补丁消除了运行时 `VACUUM`，但**不会自动缩小已有的数据库文件**。若数据库已膨胀到数 GB，建议在**停止服务时**执行一次离线回收（此时无人抢锁，也不会被context 取消）：

```bash
docker stop memos
docker run --rm -v <你的volume>:/data keinos/sqlite3 /data/memos_prod.db \
  "PRAGMA wal_checkpoint(TRUNCATE); VACUUM;"
docker start memos
```

> ⚠️ `VACUUM` 需要约等于数据库大小的**额外临时磁盘空间**，请先确认可用空间充足。
> ⚠️ 执行前**务必先备份数据目录**。

### 回收残留附件

`patch.4` 之前的版本在删除 memo 时**不会删除其附件**（`resource` 表在 `memo_id` 上没有外键）。这些附件成为孤儿：数据库记录仍在、本地文件仍在，且图片仍可通过公开路由 `/o/r/:resourceId` 访问——即使所属 memo 早已删除。

升级到 `patch.4` 后，新删除的 memo 会正确清理附件，但**历史残留不会自动清除**。可以这样回收：

```bash
docker stop memos
```

**第 1 步：找出真正的孤儿**（`memo_id` 有值，但指向的 memo 已不存在）：

```bash
docker run --rm -v <你的volume>:/data keinos/sqlite3 /data/memos_prod.db \
  "SELECT r.id, r.filename, r.memo_id, r.size
     FROM resource r
    WHERE r.memo_id IS NOT NULL
      AND r.memo_id NOT IN (SELECT id FROM memo)
    ORDER BY r.size DESC;"
```

> 💡 **不要用 `memo_id IS NULL` 判定孤儿。** 上传流程是先建资源、再由 `UpdateResource` 绑定到 memo，
> 所以 `memo_id IS NULL` 同时包含：用户头像、已上传但没用到、以及粘贴后未保存的临时资源。
> 用它筛选会连同所有用户的头像一起删掉。**只清理上一步查出来的这批记录。**

**第 2 步：确认无误后删除这批孤儿**（把 `WHERE` 换成第 1 步的条件即可）：

```bash
docker run --rm -v <你的volume>:/data keinos/sqlite3 /data/memos_prod.db \
  "DELETE FROM resource
    WHERE memo_id IS NOT NULL
      AND memo_id NOT IN (SELECT id FROM memo);
   VACUUM;"
```

数据库记录删除后，对应的本地文件（`<volume>/assets/`）与缩略图仍会留在磁盘上。确认数据库中已无这些记录后，再手动删除 `<volume>/assets/` 下不再被引用的文件。

> ⚠️ 执行前**务必先备份数据目录**。

### 已知限制

- 上游 issue #3922 / #4317 至今未被官方修复，**升级官方镜像不能替代本补丁**。
- 附件存于 Database 时，每次读取仍会全量载入内存（`GetBlob: true` 会取回 blob 列）。`patch.4` 已让**文件型附件**（Local Storage）改为直接从磁盘流式返回，但纯 Database 存储的附件仍受此限制。极大并发下可能触及内存上限，若后续出现 OOM，可考虑改用 Local Storage。

## Deploy with Docker in seconds

```bash
docker run -d --name memos -p 5230:5230 -v ~/.memos/:/var/opt/memos ghcr.io/usememos/memos:latest
```

> The `~/.memos/` directory will be used as the data directory on your local machine, while `/var/opt/memos` is the directory of the volume in Docker and should not be modified.

Learn more about [other installation methods](https://www.usememos.com/docs/install).

### Using the patched image (Unraid / Docker Compose)

本仓库构建的镜像推送到 GitHub Container Registry。**使用前请先将 package 设为 Public**，否则拉取会因未授权而失败。

```yaml
services:
  memos:
    # Use :latest to always receive new builds without editing this template.
    # Pin a version tag (e.g. :v0.18.2-patch.1) if you prefer a fixed image.
    image: ghcr.io/jomonylw/memos:latest
    container_name: memos
    ports:
      - "5230:5230"
    volumes:
      - /path/to/memos_data:/var/opt/memos
    environment:
      - MEMOS_MODE=prod
    restart: unless-stopped
```

每次构建会同时推送三个 tag：`:latest`（跟随最新构建）、`:v0.18.2-patch.10`（与 git tag 一致）以及 `:0.18.2-patch.10`（semver 形式）。

镜像可通过 **Actions → build-and-push-patched-image** 手动触发构建，或推送 `v*` 标签自动触发：

```bash
git tag v0.18.2-patch.10 && git push origin v0.18.2-patch.10
```

### 版本说明

| Tag | 内容 |
|---|---|
| `v0.18.2-patch.1` | 初版：移除运行时全库 `VACUUM`、限制连接池 |
| `v0.18.2-patch.2` | 增加诊断日志 |
| `v0.18.2-patch.3` | **修复空白页**（缺失资源返回 404 + 缓存头）、**修复 `auto_vacuum` 被静默忽略**、**修复全新部署迁移失败** |
| `v0.18.2-patch.4` | **修复删除 memo 后附件残留**（数据与隐私泄露）、**修复删除不存在资源时谎报成功**、**修复成员角色/归档状态更改不生效**（三个数据库驱动）、**修复空更新生成非法 SQL**、**增加 HTTP / gRPC panic 恢复**（此前 panic 会杀死进程）、**修复文件型资源全量读入内存** |
| `v0.18.2-patch.5` | **消除 `ListMemos` (API v2) N+1 查询性能开销**（批量拉取 resources 与 relations、系统设置解析复用及 creator 缓存）、**修复全新安装空指针 Panic**（`CreateMemo` 系统设置未配置时的空安全保护）、**修复 macOS 环境下 gRPC Gateway 连接异常与测试端口冲突**、**补充 gRPC 服务优雅关闭及连接释放** |
| `v0.18.2-patch.6` | **图片缩略图与内存优化**：单图 memo 自动加载缩略图（减少 ~95% 无谓流量）、磁盘缓存优先流式直出（0 堆内存分配）、限制并发图像解码（semaphore=2 防止 RAM 激增）、CatmullRom 快速平滑缩放、空闲触发内存主动归还操作系统、全链路 ETag / 304 协商缓存、Docker 默认环境变量 `GOMEMLIMIT=768MiB` 与 `GOGC=50` |
| `v0.18.2-patch.7` | **安全 Iframe 嵌入与视频链接自动解析**：修复 Gomark 标签解析确保 raw `<iframe>` 完整传递；前端实现严格安全校验（拦截 `javascript:` 等恶意伪协议并启用沙箱隔离）；支持 YouTube 与哔哩哔哩（Bilibili）单行链接自动转换为播放器卡片；Click-to-Load 门面（Facade）按需加载（防追踪与省流量）；支持 YouTube 时间戳、B站分P与无防盗链跨域播放；行内视频链接播放标识 |
| `v0.18.2-patch.8` | **Twitter / X 贴文嵌入完整支持**：扩展 Gomark 解析器以完整保留官方 `<blockquote class="twitter-tweet">` 及其脚本；前端支持单行推文链接与官方嵌入代码自动渲染为交互式 Twitter Widget；自动跟随深浅主题无缝切换；内置加载骨架屏；在加载超时、被广告拦截器或网络阻断时自动降级为原生精美卡片（支持作者、正文、发布时间与跳转链接）；普通混排链接增加 Twitter 图标标识 |
| `v0.18.2-patch.9` | **Twitter / X 渲染超时与布局保护**：增加渲染超时判定兜底逻辑，并优化挂载容器的可见度管理 |
| `v0.18.2-patch.10` | **修复移动端 Twitter 嵌入视口跳跃与横向抖动**：严格限制加载期挂载容器尺寸防视口溢出、样式限制 iframe 最大宽度 100%、避免 oEmbed 无谓二阶段重排 |

> ⚠️ `patch.1` 的 `auto_vacuum` 实际未生效（运行时 PRAGMA 在 WAL 切换后是空操作），
> 因此**若你的数据库尚未做离线 `VACUUM`，建议直接使用 `patch.4` 或更新版本**。

> 🔒 **`patch.4` 建议尽快升级**：该版本修复了附件残留问题。在 `patch.3` 及更早版本中，删除 memo 不会删除其附件，
> 图片仍可通过公开路由 `/o/r/:resourceId` 访问，且文件与数据库记录会一直占用磁盘。
> 若你此前删过含附件的 memo，可按[下文「回收残留附件」](#回收残留附件)清理历史残留。

> 💡 **Unraid 用户**：使用 `:latest` 时，更新后请务必勾选 **Force Download New Image**，否则 Unraid 会因本地已存在 `latest` 缓存而不会真正拉取新镜像。这是使用固定 tag 时最容易踩的坑。
>
> 💾 **磁盘提醒**：数据卷需保留足够空间。离线 `VACUUM` 会额外占用约等于数据库大小的临时空间（见[上文「部署后建议：离线回收数据库空间」](#部署后建议离线回收数据库空间)）。

## Contribution

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. We greatly appreciate any contributions you make. Thank you for being a part of our community! 🥰

<a href="https://github.com/usememos/memos/graphs/contributors">
  <img src="https://contri-graphy.yourselfhosted.com/graph?repo=usememos/memos&format=svg" />
</a>

---

- [Moe Memos](https://memos.moe/) - Third party client for iOS and Android
- [lmm214/memos-bber](https://github.com/lmm214/memos-bber) - Chrome extension
- [Rabithua/memos_wmp](https://github.com/Rabithua/memos_wmp) - WeChat MiniProgram
- [qazxcdswe123/telegramMemoBot](https://github.com/qazxcdswe123/telegramMemoBot) - Telegram bot
- [eallion/memos.top](https://github.com/eallion/memos.top) - Static page rendered with the Memos API
- [eindex/logseq-memos-sync](https://github.com/EINDEX/logseq-memos-sync) - Logseq plugin
- [quanru/obsidian-periodic-para](https://github.com/quanru/obsidian-periodic-para#daily-record) - Obsidian plugin
- [JakeLaoyu/memos-import-from-flomo](https://github.com/JakeLaoyu/memos-import-from-flomo) - Import data. Support from flomo, wechat reading
- [Quick Memo](https://www.icloud.com/shortcuts/1eaef307112843ed9f91d256f5ee7ad9) - Shortcuts (iOS, iPadOS or macOS)
- [Memos Raycast Extension](https://www.raycast.com/JakeYu/memos) - Raycast extension
- [Memos Desktop](https://github.com/xudaolong/memos-desktop) - Third party client for MacOS and Windows
- [MemosGallery](https://github.com/BarryYangi/MemosGallery) - A static Gallery rendered with the Memos API

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=usememos/memos&type=Date)](https://star-history.com/#usememos/memos&Date)
