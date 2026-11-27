# 枝迹（BranchTrace）

枝迹是一个离线优先的树形项目管理与每日行动记录桌面应用，使用 Tauri 2、React、TypeScript、TanStack Query、Rust、rusqlite 和 SQLite。

| project-view | calendar-view |
| --- | --- |
| ![project-view](./assets/project-view.png) | ![calendar-view](assets/calendar-view.png) |



## 开发

```bash
pnpm install
pnpm dev
```

开发浏览器页面会使用本地演示数据（清空 `localStorage` 键 `branchtrace-mock` 即可重置回初始演示状态）；通过 Tauri 启动时，前端会调用 Rust Commands 并将 SQLite 保存到操作系统的应用数据目录。

## 演示 / 测试数据库

项目内置了一份覆盖全部功能的动态日期测试数据库生成器（不会提交 `.sqlite3` 文件到 Git，也不会影响个人正式数据库）：

```bash
# 按当前本地日期生成 demo/branchtrace-demo.sqlite3（已存在时覆盖）
pnpm db:demo

# 如需指定输出路径或固定基准日期
cargo run --manifest-path src-tauri/Cargo.toml --bin seed_demo -- \
  --output demo/branchtrace-demo.sqlite3 --today 2026-11-23 --force

# 通过 BRANCHTRACE_DB_PATH 环境变量隔离启动桌面端（不触碰正式库）
BRANCHTRACE_DB_PATH="$PWD/demo/branchtrace-demo.sqlite3" pnpm tauri dev
```

演示数据库直观涵盖以下功能场景：

- **Projects**：4 棵多领域项目树（最深 4 级）、持久化折叠分支与 `Expand All` / `Collapse All`、已完成/已取消父节点下的活跃子项目（父子状态独立）、`Log Today` / `Progressed` 切换、`+N` 多月推进历史日历，以及同名同路径项目 `Release Checklist`（在移动弹窗与周视图自动分配短 ID `a4c1e` / `a4c1f`）。
- **Weekly**：当日同时包含“同日推进并完成（`Progressed same day`）”与“仅完成”项目、同名短 ID 区分、已取消项目的历史推进保留、当日计划提醒（活跃 / 同日完成合并 / 已取消）、逾期提醒以及跨日完成提醒（延迟补完 + 提前完成）。
- **Monthly**：顶部跨月 `Overdue Reminders` 横幅、每日项目完成/推进去重徽章、点击日期打开弹窗管理与同日拖拽排序，以及点击 `Details` 精准跳转至周视图对应列。
- **Trash**：`Projects` 与 `Reminders` 双分类，包含单节点、普通子树以及**嵌套回收站批次**（`Old Mobile Companion Idea` 与更早单独删除的子节点 `Push Notification Spike`），可直接验证父节点仍在回收站时的恢复拦截与隔离恢复行为。

## 构建

```bash
pnpm build
pnpm tauri dev
pnpm tauri build --bundles deb
```

Linux 构建需要 Tauri 2 的系统依赖，包括 WebKitGTK、GTK 3 和 librsvg；Windows 与 macOS 请按 Tauri 2 官方前置依赖安装 Rust 和平台工具链。

## 本地 `.deb` 安装与自动更新（`dpkg` + GitHub Releases）

项目已接入 `tauri-plugin-updater`（支持 Linux `.deb` 原生升级，使用 `pkexec dpkg -i` 提权安装）和 GitHub Actions 自动发布流水线（`.github/workflows/release.yml`）。

### 1. 一次性配置 GitHub Actions 签名密钥

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中新增：

- `TAURI_SIGNING_PRIVATE_KEY`：本机 `~/.tauri/branchtrace.key` 文件的完整内容（切勿提交私钥到 Git）。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：生成私钥时设置的密码（如为无密码密钥可留空或不设置）。

对应的公钥已写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`，并开启 `requireSignedVersion: true` 防止降级重放。

### 2. 发布新版本（自动构建 `.deb` 并生成 `latest.json`）

```bash
# 同步更新 package.json、src-tauri/tauri.conf.json、src-tauri/Cargo.toml 三处版本号
pnpm release:bump 1.0.1

# 更新 Cargo.lock（如需要）并提交打 tag 推送
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(release): v1.0.1"
git tag -a v1.0.1 -m "Release v1.0.1"
git push origin main v1.0.1
```

推送 `v*` 标签后，`.github/workflows/release.yml` 会自动执行全量测试、构建带签名的 `.deb` 安装包、生成包含 `linux-x86_64-deb` 目标的 `latest.json` 与 `.deb.sha256`，并上传到 GitHub Releases。

### 3. 本地首次安装与后续应用内更新

- **首次安装**：从 GitHub Releases 下载最新 `BranchTrace_<version>_amd64.deb`（或在本地通过 `TAURI_SIGNING_PRIVATE_KEY=~/.tauri/branchtrace.key TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" pnpm tauri build --ci --bundles deb` 构建）后执行：
  ```bash
  sudo apt install ./BranchTrace_<version>_amd64.deb
  ```
- **后续自动更新**：打开已安装的 BranchTrace，应用会在启动后静默检查一次更新，也可以在 **Settings → Software Updates** 手动点击 **Check for Updates** → **Download & Install**，通过系统认证弹窗由 `dpkg` 完成升级，再点击 **Restart Now**（重启前会自动排空并关闭 SQLite 工作线程，保留 `~/.local/share/com.branchtrace.app/branchtrace.sqlite3` 中的本地数据）。

## 后端结构

- `src-tauri/src/models.rs`：DTO、错误码与领域枚举。
- `src-tauri/src/db/`：唯一 SQLite 连接的数据库工作线程、迁移、事务、各领域业务操作、演示数据生成器（`demo.rs`）与测试（`tests.rs`）。
- `src-tauri/src/bin/seed_demo.rs`：生成独立演示 SQLite 文件的 CLI 工具。
- `src-tauri/src/lib.rs`：Tauri Commands、应用数据目录（含 `BRANCHTRACE_DB_PATH` 覆盖）和生命周期。
- `src-tauri/migrations/001_initial.sql`：SQLite v1 初始化迁移。

所有业务写入都经过 Rust 的状态、日期、树关系和版本校验。React 不直接访问 SQLite。

## 测试与验证

### 1. 一键全量测试（推荐）

在仓库根目录执行（如使用仓库内置 Rust 工具链，先导出 `RUSTUP_HOME`、`CARGO_HOME` 与 `PATH`）：

```bash
export RUSTUP_HOME="$PWD/.rustup" CARGO_HOME="$PWD/.cargo" PATH="$PWD/.cargo/bin:$PATH"

# 前端 TypeScript 类型检查 + 生产构建
./node_modules/.bin/tsc
./node_modules/.bin/vite build

# Node.js 回归测试（Mock API、月视图布局、树展开、移动选项、树形布局、日期格式化）
node --test tests/*.test.mjs

# Rust 代码格式检查 + 全部单元测试与 SQLite 集成测试
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo test --manifest-path src-tauri/Cargo.toml

# 演示 / 测试数据库生成器冒烟验证
cargo run --manifest-path src-tauri/Cargo.toml --bin seed_demo -- --output demo/branchtrace-demo.sqlite3 --force
```

### 2. 按模块定向测试

```bash
# 单独运行前端 / 浏览器 Mock 回归测试
node --test tests/mock-api.test.mjs
node --test tests/monthly-layout.test.mjs
node --test tests/project-tree.test.mjs
node --test tests/project-options.test.mjs
node --test tests/project-expansion.test.mjs
node --test tests/ui-format.test.mjs

# 单独运行 Rust 测试（支持按名称过滤）
export RUSTUP_HOME="$PWD/.rustup" CARGO_HOME="$PWD/.cargo" PATH="$PWD/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml demo
cargo test --manifest-path src-tauri/Cargo.toml resolve_db_path
cargo test --manifest-path src-tauri/Cargo.toml month_calendar
cargo test --manifest-path src-tauri/Cargo.toml nested_trash

# 查看 seed_demo 参数说明与固定日期生成测试
cargo run --manifest-path src-tauri/Cargo.toml --bin seed_demo -- --help
cargo run --manifest-path src-tauri/Cargo.toml --bin seed_demo -- \
  --output demo/branchtrace-demo.sqlite3 --today 2026-11-23 --force
```

前端回归测试使用 Node.js 24 内置的 TypeScript 支持，无需额外测试依赖。

核心需求与验收边界见 `docs/version1.0/01_MVP_需求规格.md`，API 契约见 `docs/version1.0/03_Rust_API_设计.md`，版本变更说明见 `docs/changelog.md`。

## 桌面窗口调试

### 使用正式数据库启动

```bash
pnpm build
RUSTUP_HOME="$PWD/.rustup" CARGO_HOME="$PWD/.cargo" \
PATH="$PWD/.cargo/bin:$PATH" \
pnpm tauri dev --no-watch --config '{"build":{"beforeDevCommand":"pnpm preview --host 127.0.0.1 --port 1420"}}'
```

### 使用测试数据库隔离启动（不触碰正式库）

```bash
export RUSTUP_HOME="$PWD/.rustup" CARGO_HOME="$PWD/.cargo" PATH="$PWD/.cargo/bin:$PATH"
pnpm db:demo
pnpm build
BRANCHTRACE_DB_PATH="$PWD/demo/branchtrace-demo.sqlite3" \
pnpm tauri dev --no-watch --config '{"build":{"beforeDevCommand":"pnpm preview --host 127.0.0.1 --port 1420"}}'
```

