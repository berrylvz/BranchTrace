# BranchTrace MVP 开发规划

## 1. 目标与成功标准

从当前设计包开始，交付一个可在 Windows、macOS、Linux 离线运行的枝迹（BranchTrace）MVP 桌面应用。应用使用 Tauri 2 + React + TypeScript + Vite + Tailwind CSS + shadcn/ui + TanStack Query + Rust + rusqlite + SQLite，实现项目树、按日推进、Daily 七日视图、独立提醒、统一回收站、主题设置和本地持久化。

完成标准如下：

- 启动时能在系统应用数据目录打开或创建 SQLite 数据库，完成迁移、外键启用和完整性检查后才显示业务界面。
- React 只通过 Tauri Commands 访问 Rust，所有业务校验、日期计算、事务和 SQLite 写入都在 Rust 完成。
- Project、推进记录、完成/取消状态、历史日期、排序、跨级移动和回收站行为符合需求中的业务不变量。
- Daily 始终返回连续七天，正确合并项目完成与推进、展示独立提醒的计划/完成/逾期投影，并保持 Project 数据只读。
- 数据库写入串行化，版本冲突、迁移失败、非法日期、非法状态转换、树循环和数据库错误均有可识别反馈，不出现前端虚假成功状态。
- [docs/01_MVP_需求规格.md](docs/01_MVP_需求规格.md) 中的 15 组验收测试全部通过，并完成三平台构建和启动冒烟验证。

## 2. 需求基线与范围

开发以以下文档为唯一业务基线：

- [docs/01_MVP_需求规格.md](docs/01_MVP_需求规格.md)：产品范围、业务不变量、交互规则、日期规则、回收站规则和验收项。
- [docs/03_Rust_API_设计.md](docs/03_Rust_API_设计.md)：目录分层、DTO、Tauri Commands、数据库工作线程、事务算法、错误码和缓存策略。
- [docs/001_initial.sql](docs/001_initial.sql)：SQLite v1 初始化迁移、表结构、外键、约束和索引。
- [docs/04_品牌与工程命名规范.md](docs/04_品牌与工程命名规范.md)：产品显示名、工程命名、Tauri 标识和应用数据目录约束。
- [docs/00_交付说明.md](docs/00_交付说明.md)：设计包交付边界和已验证内容。

首版明确不开发账号、云同步、搜索、状态筛选、系统通知、托盘常驻、后台调度、自动清理回收站、导入导出、自动备份、行动时长/次数统计、完成百分比、协作和跨日期拖拽。若后续增加这些能力，应通过新的需求和迁移版本进入，不在本 MVP 中隐式扩展。

## 3. 总体架构与数据流

采用以下固定数据流：

```text
React 页面
  -> TypeScript invoke wrappers
  -> Tauri Command
  -> DbHandle 消息通道
  -> 专用数据库工作线程（唯一拥有 rusqlite::Connection）
  -> domain 校验 / service 编排 / repository SQL
  -> 事务提交后的 DTO 或 ApiError
  -> TanStack Query 更新或失效缓存
  -> React 渲染最新服务端结果
```

实现分层保持 API 设计中的边界：

- 前端按 `features/project`、`features/daily`、`features/trash`、`features/settings` 组织页面和交互。
- `api/` 只负责 Tauri 调用和 TypeScript DTO；`hooks/` 负责 TanStack Query 查询与 mutation。
- Rust 的 `commands` 负责参数接收和返回序列化，`services` 负责业务流程，`domain` 负责模型/日期/错误，`repos` 负责 SQL，`db` 负责连接、迁移和工作线程。
- Rust 每次写操作在事务中重新读取最新状态，校验实体、软删除状态、版本、日期、树关系和状态转换，完成写入后递增版本并返回最新 DTO。
- `get_daily_week` 在 Rust 中批量查询和聚合，前端只负责七列布局、交互和展示，不重复实现业务分组规则。

## 4. 数据库、公共 API 与缓存契约

### 4.1 数据库基线

以 [docs/001_initial.sql](docs/001_initial.sql) 作为 migration v1，不改变已有表名、字段语义和业务约束。六类核心数据如下：

- `projects`：树关系、标题、状态、终止日期、排序、版本和软删除信息。
- `project_ui_states`：项目展开状态。
- `progress_records`：项目按日推进记录，以 `(project_id, progress_date)` 保证同日唯一。
- `reminders`：独立提醒的计划日、状态、完成日期、完成操作时间、排序、版本和软删除信息。
- `trash_entries`：项目树或单条提醒的回收站批次。
- `app_settings`：主题设置。

数据库启动顺序固定为：创建应用专属数据目录、打开 `branchtrace.sqlite3`、设置 `foreign_keys=ON`、`journal_mode=WAL`、`synchronous=FULL` 和 `busy_timeout=5000`，执行迁移，检查 `PRAGMA user_version` 和 `PRAGMA foreign_key_check`，全部成功后启动数据库工作线程。迁移失败必须进入可诊断错误页，不能删除旧库或静默创建空库覆盖现有数据。

SQL 只承担结构性约束；真实日历日期、日期与本地今日关系、终止日期与最后推进日期关系、祖先循环、回收站批次状态和版本冲突由 Rust 在事务内校验。后续若确需改表，只新增有明确版本号的 migration，不直接修改已发布的 v1 文件。

### 4.2 Tauri Commands 与 DTO

按 API 设计文档实现以下命令组，并保持 `snake_case` 命令名、camelCase DTO 字段和明确的 `Result<T, ApiError>` 返回形式：

- 时钟和项目查询：`get_clock_context`、`get_project_tree`、`get_project_detail`、`get_project_progress_month`。
- 项目结构：`create_project`、`rename_project`、`set_project_expanded`、`reorder_project_siblings`、`move_project`。
- 项目状态与推进：`set_project_progress`、`complete_project`、`cancel_project`、`restore_project`、`update_project_terminal_date`。
- 独立提醒：`get_reminder`、`create_reminder`、`rename_reminder`、`update_reminder_schedule`、`complete_reminder`、`cancel_reminder`、`restore_reminder`、`update_reminder_completed_date`、`reorder_reminders`。
- Daily、回收站和设置：`get_daily_week`、`preview_project_trash`、`trash_project`、`trash_reminder`、`list_trash`、`restore_trash_entry`、`permanently_delete_trash_entry`、`empty_trash`、`get_app_settings`、`set_theme_mode`。

公共 DTO 至少包括 `ProjectDto`、`ProjectDetailDto`、`ReminderDto`、`DailyWeekDto`、`DailyDayDto`、`ProjectDailyItem`、`ReminderDailyItem`、`TrashEntryDto` 和 `ApiError`。写入 Project/Reminder 的单节点命令携带 `expectedVersion`；五秒快捷撤销也必须使用操作返回的版本，避免旧撤销覆盖后续修改。排序命令提交完整的同级或同计划日 ID 列表，由 Rust 验证集合完全匹配。

错误码固定覆盖 `NOT_FOUND`、`IN_TRASH`、`INVALID_TITLE`、`INVALID_DATE`、`FUTURE_DATE_FORBIDDEN`、`SCHEDULE_IN_PAST`、`TERMINAL_DATE_BEFORE_PROGRESS`、`INVALID_STATUS_TRANSITION`、`VERSION_CONFLICT`、`INVALID_PARENT`、`REORDER_MEMBERSHIP_MISMATCH`、`PARENT_IN_TRASH`、`DB_BUSY`、`DB_ERROR` 和 `MIGRATION_ERROR`。前端根据错误码保留草稿、刷新数据、关闭失效弹层或显示具体修复提示。

### 4.3 TanStack Query 缓存

建立 `projectTree`、`projectDetail`、`projectProgressMonth`、`dailyWeek`、`reminder`、`trash`、`settings`、`clockContext` 查询键。项目结构、状态、推进、回收站和提醒的任何成功写入，都按 API 设计文档使受影响的 Project、Reminder、Settings 和全部 Daily 周查询失效。项目移动或重命名可能改变历史 Daily 的动态路径，因此必须使所有 `dailyWeek` 查询失效；午夜、睡眠唤醒和时区变化必须重新获取 Rust 的时钟上下文，不能使用前端旧的“今天”。

## 5. 分阶段实施计划

### 阶段一：工程脚手架与启动骨架

建立 Tauri 2、React、TypeScript、Vite、Tailwind、shadcn/ui、TanStack Query 和 Rust workspace；按命名规范设置 `productName=枝迹`、开发代号 `branchtrace`、SQLite 文件名和待最终确认的稳定 Tauri `identifier`。搭建前端路由/视图壳、Rust command 注册、应用数据目录解析、日志和统一错误边界。

交付物：可启动的空壳应用、开发/构建脚本、前后端目录骨架、基础主题变量和 command 调用样例。阶段出口：三平台至少能构建，启动时能显示加载态和错误态。

### 阶段二：SQLite、迁移和 Rust 数据层

实现 DB worker、`DbHandle`、请求/响应消息和 oneshot 回包；连接只在工作线程创建和关闭。实现 migration runner、PRAGMA 设置、`user_version` 检查、外键完整性检查、UTC 时间戳服务、本地业务日期服务、UUID 生成、统一 `ApiError` 和日志脱敏。

实现 domain、repository、service 的最小骨架，并先覆盖数据库打开失败、迁移失败、事务回滚、连接忙和线程关闭时等待写事务完成等路径。阶段出口：能在测试数据库上执行 v1 migration，所有 SQL 访问都经过唯一 worker，`foreign_key_check` 无错误。

### 阶段三：Project 树、推进和状态

按“数据先行”顺序实现 Project：

1. 创建、重命名、读取平铺树、展开状态持久化和同级排序。
2. `parent_id` 关系、跨级移动、目标追加到末尾、递归后代查询和自身/后代/回收站目标校验。
3. 今日和历史推进的增加/撤销、同日幂等、未来日期禁止、终止状态禁止新增推进但允许删除历史推进。
4. 完成、取消、恢复、终止日期修改、最后推进日期约束和版本保护。
5. Project 行内编辑、菜单、日历、最近三次推进摘要、五秒版本化撤销和失败恢复 UI。

父子状态、推进和展开状态保持完全独立；父节点终止不阻止子节点操作，不自动传播任何状态。阶段出口：Project 相关验收项 1–6、13 的后端测试通过，前端在失败时恢复真实树顺序和输入草稿。

### 阶段四：Daily Rust 聚合与只读 Project 展示

实现 `get_daily_week`：校验传入周一、在一次查询内固定 Rust 本地今日快照、批量读取七天范围的数据、按日期分组，并返回恰好七个 `DailyDayDto`。完成项目同日推进时只进入完成组一次并设置 `progressedSameDay`；取消项目本身不显示，但历史推进按规则保留；路径按当前树动态计算，同名路径组才生成短 ID。

实现 Daily 前端七列横向布局、周切换/回本周、空组隐藏、项目完成/推进分组、只读 Project 详情弹层和窄窗口横向滚动。Daily 中不提供任何 Project 编辑或导航写入口。阶段出口：Daily 项目展示、周边界、跨月跨年、同日合并、取消/恢复和动态路径测试通过。

### 阶段五：独立提醒与 Daily 投影

实现 Reminder 的创建、重命名、计划日修改、计划日内排序、完成、取消、恢复和完成日期修改。所有计划日新建/修改必须是 Rust 真实今日或未来；完成操作记录真实完成日与 UTC `completed_action_at`；补记完成日保留原操作时间；状态变更不改计划列表顺序。

在 Rust 聚合中实现三类展示投影：计划日事项、仅真实今日的逾期待处理、计划日与完成日不同的跨日完成；计划日等于完成日时合并为一行。前端支持行内连续创建、日期菜单、复选框、状态菜单和仅计划日内拖拽。阶段出口：验收项 8–10、13 的后端和 UI 测试通过，跨日展示不产生重复实体或错误排序。

### 阶段六：统一回收站与永久删除

按删除批次实现 Project 和 Reminder 软删除、分类列表、恢复、单条永久删除和分类清空。删除 Project 前提供活跃节点数预览，但写事务必须重新计算真实子树范围；已有独立回收站批次的后代不能被父批次恢复。恢复子树前校验父级不在回收站；永久删除父树时连同所有已软删除后代、推进、UI 状态和相关 `trash_entries` 一并清理。

实现确认弹窗、受影响数量显示、恢复失败提示和删除期间的加载态。阶段出口：验收项 11–12 通过；嵌套软删除、恢复隔离、硬删除和 `foreign_key_check` 均有事务集成测试。

### 阶段七：主题、生命周期与体验完整性

实现 `light/dark/system` 三种主题、设置持久化和系统主题变化监听；窗口关闭执行完整退出，等待或完成正在进行的写事务，未提交草稿不保存，并处理 macOS 默认关窗行为。实现跨午夜、睡眠唤醒和系统时区变化后的时钟刷新；进入 Daily 时总是定位到当前本地自然周。实现键盘可访问菜单/日历/复选框、状态图标与文字并存、拖拽手柄隔离、超长标题处理和全局错误边界。

确保应用不引入系统通知、托盘、后台常驻或隐式自动备份。阶段出口：生命周期、主题、无障碍和时钟变化测试通过。

### 阶段八：三平台验证与发布准备

在 Windows、macOS、Linux 分别执行开发启动、离线 CRUD、重启数据恢复、主题切换、正常关闭和数据库错误场景；验证安装包的产品名、稳定 identifier、应用数据路径和升级迁移行为。补齐构建说明、数据库迁移说明、错误诊断信息和发布前命名/标识核查。

## 6. 关键边界条件与失败处理

- 日期统一以 `YYYY-MM-DD` 存储并用 Rust 日历类型解析；禁止未来推进、未来终止日和过去计划日；终止日期不能早于该节点最后推进日。
- Project/Reminder 的 `completed` 与 `canceled` 不能直接互转，必须先恢复为 `active`；恢复保留项目推进历史和提醒计划日。
- 删除父项目时，活跃后代进入同一删除批次；此前独立删除的后代保持原批次；父树永久删除时所有后代物理清除。
- 跨级移动不能把项目移入自身或后代；排序提交缺成员、多成员、跨层或跨日期时拒绝并刷新原顺序。
- 预览回收站数量和真实删除范围可能因并发操作变化，写事务必须重新计算，并以实际返回数量更新提示。
- `VERSION_CONFLICT` 不自动盲目重试；前端刷新数据并保留用户可重新执行的操作。旧的五秒撤销同样必须被版本检查拒绝。
- 迁移、IO、忙锁或事务错误不得显示为成功；数据库启动异常显示错误页，写入失败恢复 UI 和输入草稿。
- 跨午夜或时区变化时，前端重新请求 `clockContext` 和受影响查询；过去已保存的业务日期不移动。
- 关闭窗口时不强制终止正在执行的事务，事务必须完整提交或回滚；未提交输入草稿丢弃。

## 7. 测试与验收方案

### 7.1 Rust 单元测试

覆盖标题规范化/长度、UUID、真实日历日期、周一计算、业务今日、状态转换、终止日期约束、版本检查、排序编号、祖先循环检测、路径和 Daily 分组排序。测试不依赖系统当前日期时使用可注入的 clock，生产实现仍读取操作系统本地日期。

### 7.2 SQLite 与 service 集成测试

每个测试使用临时数据库并执行真实 migration，验证：

- 唯一推进、状态 CHECK、软删除标记和外键级联。
- Project 创建/移动/排序/推进/终止/恢复的事务原子性。
- Reminder 的计划日、完成日、操作时间和排序规则。
- Daily 七天聚合、同日完成+推进、历史推进、取消项目、动态路径、提醒逾期和跨日完成。
- 先删子再删父再恢复父、永久删除父树及批次清理。
- 版本冲突、数据库错误、事务回滚和 `PRAGMA foreign_key_check`。

### 7.3 前端与端到端测试

使用前端单元/组件测试覆盖 Project 行编辑、连续创建、Esc 行为、日历、周视图、Reminder 菜单、危险操作确认、错误提示、缓存失效和窄窗口横向滚动；使用 Tauri 集成或端到端测试验证 invoke 参数、DTO 映射、真实 command 错误和重启持久化。

端到端验收按 [docs/01_MVP_需求规格.md](docs/01_MVP_需求规格.md) 的 15 项逐项执行，并将每项关联到自动化测试或明确的手工测试记录。跨平台冒烟至少覆盖启动、创建、修改、删除/恢复、退出和再次启动恢复数据。

## 8. 交付物与阶段出口

最终交付包括：

- 可构建、可启动的 Tauri 2 桌面应用源码。
- v1 数据库迁移、未来迁移入口、错误模型和 DTO/Command 契约实现。
- Project、Daily、Reminder、回收站、主题和生命周期 UI。
- Rust 单元/集成测试、前端组件/端到端测试和三平台构建验证记录。
- 开发、构建、迁移、数据目录和发布标识说明。
- 本开发规划文件本身。

每个阶段只有在对应测试和出口条件完成后进入下一阶段；若实现需要调整接口或数据库结构，先更新契约和迁移，再同步 Rust DTO、前端 wrappers、缓存策略和验收测试，避免只修改单一层。

## 9. 明确假设

- 当前仓库只有设计文档和初始化 SQL，开发按从零创建 Tauri/React/Rust 工程处理。
- 现有 v1 SQL 和 API 设计是兼容基线；MVP 不主动新增字段、状态或功能。
- 正式发布前由项目负责人确定可使用的 Tauri `identifier`；占位 identifier 不进入发行配置。
- 依赖的具体版本在脚手架创建时按 Tauri 2 及当时兼容矩阵锁定，之后通过锁文件保证可复现构建。
- 第一版只保证单用户、单实例本地数据库写入，不承诺多进程并发协同或数据备份能力。
