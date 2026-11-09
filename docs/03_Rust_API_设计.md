# 枝迹（BranchTrace）— Rust / Tauri API 设计（v1.0）

**目标：** React 仅通过 Tauri Commands 与 Rust 交互；Rust 在专用单线程 rusqlite 工作线程中完成所有 SQL、状态/日期校验及事务。  
**配套文件：** `01_MVP_需求规格.md`、`001_initial.sql`、`04_品牌与工程命名规范.md`。  
**约定：** 本文的 Rust/TypeScript 片段为接口契约及实现示例，不是可直接编译运行的完整应用。

## 0. 产品与工程命名

- 产品显示名：**枝迹**；英文名 **BranchTrace**；开发代号 `branchtrace`。
- 项目目录和包名使用 ASCII `branchtrace`；UI 显示名使用“枝迹”；内部数据库文件建议 `branchtrace.sqlite3`。
- Tauri `identifier` 必须在正式发布前根据拥有的命名空间确定；**不要将示例占位标识用于正式发布**。详见 `04_品牌与工程命名规范.md`。
- Product / Project / Daily 等命令和模型名称维持原接口约定，不因产品改名而重命名业务 API。

## 1. 分层与目录

```text
src/
  components/ui/             # shadcn/ui
  features/project/          # Project 树、推进日历、行内编辑
  features/daily/            # 七列周视图、独立提醒、只读详情
  features/trash/            # 统一回收站
  features/settings/         # 主题
  api/                       # Tauri invoke wrapper + DTO
  hooks/                     # TanStack Query hooks
  lib/date.ts                # 纯展示日期函数，不决定“今天”
src-tauri/src/
  lib.rs                     # 注册命令、数据库启动/关闭
  commands/{project,daily,reminder,trash,settings}.rs
  db/{worker,migrations,connection}.rs
  domain/{models,errors,dates}.rs
  services/{project,daily,reminder,trash,settings}.rs
  repos/{projects,progress,reminders,trash}.rs
src-tauri/migrations/
  001_initial.sql
```

依赖建议：`tauri`、`rusqlite` (`bundled`)、`serde`/`serde_json`、`chrono`、`uuid`、`tokio`（oneshot 回包）；以开发时兼容的版本锁定。Windows/macOS/Linux 需各自构建与打包。

## 2. 接口统一规范

- Tauri Command 名：`snake_case`；前端 `invoke('complete_project', { projectId, expectedVersion })`（Tauri 参数名默认 camelCase）。
- Rust 入参 ID：`String` UUID；Date：ISO 本地日期 `YYYY-MM-DD`；Timestamp：UTC RFC3339。业务日期使用 `NaiveDate` 解析与比较。
- Rust 输出 DTO 字段对前端序列化为 `camelCase`（`#[serde(rename_all = "camelCase")]`）；列表顺序按接口契约稳定。
- 单节点写接口：接收 `expected_version` 并做乐观版本检查，成功 `version += 1`；**五秒撤销必须携带上次操作返回的版本**。只读接口不需要版本。
- 批量排序接口：调用方提交完整的同级/同计划日活跃成员 ID 列表；Rust 检查集合和长度完全匹配，拒绝跨层/跨日或回收站项。
- 业务操作成功后返回最新 DTO/受影响计数；错误以 `Result<T, ApiError>` 抛出，不通过 `Ok(false)` 隐藏原因。
- 与当前日有关的命令从 Rust 获取实时系统本地日期；前端传的日期不是可信“今天”。
- 只有 Rust 服务可以访问 SQLite；React 只能 `invoke`，不配置 SQL 插件的前端访问权限。

## 3. 共用 DTO（TypeScript 契约）

```ts
export type ISODate = string;        // YYYY-MM-DD
export type UTCDateTime = string;    // RFC3339 UTC, trailing Z
export type ProjectStatus = 'active' | 'completed' | 'canceled';
export type ReminderStatus = ProjectStatus;
export type ThemeMode = 'light' | 'dark' | 'system';

export interface ProjectDto {
  id: string;
  parentId: string | null;
  title: string;
  status: ProjectStatus;
  completedDate: ISODate | null;
  canceledDate: ISODate | null;
  sortOrder: number;
  version: number;
  isExpanded: boolean;
  recentProgressDates: ISODate[];  // 最多三天，升序
  progressCount: number;
  progressedToday: boolean;
}

export interface ProjectDetailDto extends ProjectDto {
  parentPath: string[];            // 从根节点到直属父节点
  progressDates: ISODate[];        // 全量，升序
}

export interface ReminderDto {
  id: string;
  title: string;
  scheduledDate: ISODate;
  status: ReminderStatus;
  completedDate: ISODate | null;
  completedActionAt: UTCDateTime | null;
  canceledDate: ISODate | null;
  sortOrder: number;
  version: number;
}

export interface ProjectDailyItem {
  projectId: string;
  title: string;
  parentPath: string[];
  shortId: string | null;          // 仅完整路径冲突时返回
  status: ProjectStatus;
  progressedSameDay?: boolean;    // 仅 completedProjects 行使用
}

export type ReminderDisplayType =
  | 'planned'                    // 原计划（含按计划日完成/取消/仍待处理）
  | 'completed'                  // 计划日与完成日不同的跨日完成
  | 'overdue';                   // 仅真实今日出现

export interface ReminderDailyItem {
  reminder: ReminderDto;
  displayType: ReminderDisplayType;
  isPlannedAndCompletedSameDay: boolean;
}

export interface DailyDayDto {
  date: ISODate;
  completedProjects: ProjectDailyItem[];
  progressedProjects: ProjectDailyItem[];
  plannedReminders: ReminderDailyItem[];
  overdueReminders: ReminderDailyItem[];  // 仅真实今日可能非空
  crossDayCompletedReminders: ReminderDailyItem[];
}

export interface DailyWeekDto {
  weekStart: ISODate;              // 周一
  today: ISODate;                  // 本次查询使用的 Rust 本地今日
  days: [DailyDayDto, DailyDayDto, DailyDayDto, DailyDayDto,
         DailyDayDto, DailyDayDto, DailyDayDto];
}

export interface TrashEntryDto {
  id: string;
  kind: 'project' | 'reminder';
  rootEntityId: string;
  titleSnapshot: string;
  deletedAt: UTCDateTime;
  affectedCountAtDelete: number;
  currentDescendantCount: number | null; // project 硬删确认用
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
```

注意：`ProjectDailyItem` 中的 `shortId` 是展示字段，**不得**作为调用写接口的标识。`DailyWeekDto` 的七元素元组表示始终七天，Rust 可用 `Vec<DailyDayDto>` 序列化并在构造时断言长度为 7。

## 4. Tauri Commands 清单

### 4.1 项目查询/结构

| 命令 | 主要入参 | 返回 | 核心约束 |
|---|---|---|---|
| `get_clock_context` | 无 | `{today, weekStart, timeZoneLabel}` | Rust 本地日期权威来源 |
| `get_project_tree` | 无 | `ProjectDto[]` | 排除回收站节点，按根/同级顺序稳定排列 |
| `get_project_detail` | `projectId` | `ProjectDetailDto` | 含全推进历史与当前完整父路径 |
| `get_project_progress_month` | `projectId, month`（`YYYY-MM`） | `ISODate[]` | 返回该月已推进日；终止状态只读/可撤销由 UI+Rust 限制 |
| `create_project` | `title, parentId?` | `ProjectDto` | 创建到同级末尾；父节点必须存在且未软删除，状态不限 |
| `rename_project` | `projectId, title, expectedVersion` | `ProjectDto` | 标题非空；同名允许 |
| `set_project_expanded` | `projectId, isExpanded` | `{projectId,isExpanded}` | 单节点 UI 状态持久化，临时展开不调用此接口 |
| `reorder_project_siblings` | `parentId?, orderedIds[]` | `ProjectDto[]` | 必须是同一父节点下**全部正常可见的直属节点** |
| `move_project` | `projectId, targetParentId?, expectedVersion` | `ProjectDto` | 不允许自身/后代/已软删除目标；追加到目标末尾 |

### 4.2 Project 日期与状态

| 命令 | 主要入参 | 返回 | 核心约束 |
|---|---|---|---|
| `set_project_progress` | `projectId, date?: ISODate, present: bool, expectedVersion` | `ProjectDto` | date 缺省=Rust 今日；present=true 仅 active/日期≤今天；false 删除已有记录允许终止态 |
| `complete_project` | `projectId, expectedVersion` | `ProjectDto` | active→completed；完成日=Rust 今日；不自动推进 |
| `cancel_project` | `projectId, expectedVersion` | `ProjectDto` | active→canceled；取消日=Rust 今日 |
| `restore_project` | `projectId, expectedVersion` | `ProjectDto` | completed/canceled→active；清空终止日，推进保留；用于快捷撤销 |
| `update_project_terminal_date` | `projectId, date, expectedVersion` | `ProjectDto` | 仅对应终止状态可用；最后推进日期≤date≤Rust 今日 |

### 4.3 独立提醒

| 命令 | 主要入参 | 返回 | 核心约束 |
|---|---|---|---|
| `get_reminder` | `reminderId` | `ReminderDto` | 仅正常有效记录 |
| `create_reminder` | `title, scheduledDate` | `ReminderDto` | scheduledDate≥Rust 今日；加入该日末尾 |
| `rename_reminder` | `reminderId, title, expectedVersion` | `ReminderDto` | 同名允许，保留日期/顺序/状态 |
| `update_reminder_schedule` | `reminderId, scheduledDate, expectedVersion` | `ReminderDto` | 新计划日≥Rust 今日；任何状态可改，移至新日期末尾 |
| `complete_reminder` | `reminderId, expectedVersion` | `ReminderDto` | active→completed；实际完成日=Rust 今日，操作时间=UTC now |
| `cancel_reminder` | `reminderId, expectedVersion` | `ReminderDto` | active→canceled；取消日=Rust 今日，不再显示逾期 |
| `restore_reminder` | `reminderId, expectedVersion` | `ReminderDto` | 终止→active；清除终止日期/操作时间，计划日保留 |
| `update_reminder_completed_date` | `reminderId, date, expectedVersion` | `ReminderDto` | 仅 completed；date≤Rust 今日；保留 completedActionAt |
| `reorder_reminders` | `scheduledDate, orderedIds[]` | `ReminderDto[]` | 完整列表，且成员计划日相同；跨日完成投影不可拖拽 |

### 4.4 Daily / 回收站 / 设置

| 命令 | 主要入参 | 返回 | 核心约束 |
|---|---|---|---|
| `get_daily_week` | `weekStart`（周一） | `DailyWeekDto` | Rust 批量查询、分组、合并；取消 Project 不显示 |
| `trash_project` | `projectId` | `{entry:TrashEntryDto,affectedCount}` | 事务内软删整个当前活跃子树；删除前前端先获得确认数量 |
| `preview_project_trash` | `projectId` | `{activeNodeCount}` | 返回即将进入该删除批次的活跃节点数 |
| `trash_reminder` | `reminderId` | `TrashEntryDto` | 单条软删除 |
| `list_trash` | `kind` | `TrashEntryDto[]` | 按 deletedAt 倒序；含当前硬删范围计数 |
| `restore_trash_entry` | `entryId` | `{kind,restoredCount}` | 只恢复该批次；若项目父级仍在回收站，返回错误 |
| `permanently_delete_trash_entry` | `entryId` | `{deletedProjectCount,deletedReminderCount}` | 事务内硬删除；项目树包含其他批次的已删除后代 |
| `empty_trash` | `kind` | `{deletedProjectCount,deletedReminderCount}` | 只清空目标分类；需要 UI 二次确认 |
| `get_app_settings` | 无 | `{themeMode: ThemeMode}` | 默认 system |
| `set_theme_mode` | `mode` | `{themeMode: ThemeMode}` | 限 light/dark/system，SQLite 持久化 |

**删除确认机制：** `preview_project_trash` 仅做 UI 预览；`trash_project` 在**同一事务内重新计算**节点范围和数量并删除，不能将预览结果视为写时真实值。若在预览后树结构改变，前端必须按服务返回的实际结果提示，或者使用版本保护后拒绝并要求重新确认。

## 5. Rust Domain & Command 示例

```rust
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

// DbHandle 只包含可跨线程发送的消息 Sender，不包含 rusqlite::Connection。
// DbHandle::request 用 oneshot 等待唯一数据库线程处理完请求。
#[tauri::command]
pub async fn complete_project(
    db: State<'_, DbHandle>,
    project_id: String,
    expected_version: i64,
) -> Result<ProjectDto, ApiError> {
    let handle = db.inner().clone();
    handle.request(DbOp::CompleteProject {
        project_id,
        expected_version,
    }).await?.into_project()
}
```

上述示例中的 `DbHandle`、`DbOp`、`ProjectDto`、`into_project()` 是后续代码实现的自定义类型/方法；要先实现它们才可编译。不同命令重复使用同一个共享 `DbHandle`，并在启动时 `.manage(db_handle)`、在 `generate_handler![]` 注册。

```ts
import { invoke } from '@tauri-apps/api/core';

export function completeProject(projectId: string, expectedVersion: number) {
  return invoke<ProjectDto>('complete_project', { projectId, expectedVersion });
}

// TanStack Query mutation onSuccess: invalidate Project 树和 Daily 周缓存。
// mutation onError: 告知用户失败，不谎称保存成功。
```

## 6. 专用数据库工作线程

```text
Main/Tauri async Command
   └── clone(DbHandle.sender)
       └── send(DbRequest { operation, reply: oneshot::Sender })
           └── DB worker thread [owns exactly one rusqlite::Connection]
               ├── validate request + current local date
               ├── BEGIN IMMEDIATE (for writes)
               ├── SELECT latest state / version
               ├── perform domain validation
               ├── INSERT / UPDATE / DELETE
               ├── version += 1; COMMIT
               └── reply.send(Result<DTO, ApiError>)
```

- `Connection` 创建、关闭均在 DB worker；前端线程无连接；读和写均串行排队。
- 如果 command 取消等待或 UI 关闭，正在执行的写事务应执行完整提交/回滚；再停止工作线程。不可在半事务时直接强制中止进程。
- 启动：创建应用数据目录 → 打开库 → 设置 PRAGMA → 按版本运行 migrations → `PRAGMA foreign_key_check` → 启动 worker → 加载 UI。
- 迁移失败：退出启动流程并显示可诊断错误，不执行无条件重建覆盖；支持将来引入备份/恢复。
- 单连接无需连接池；rusqlite 同步执行**只在工作线程**，而非 Tauri UI 主线程。

## 7. 关键事务算法

### 7.1 `set_project_progress`

```text
BEGIN IMMEDIATE
SELECT status, version, deleted_at ... FROM projects WHERE id=?;
check not deleted and expectedVersion matches;
resolve date = request.date ?? RustLocalToday(); validate real ISO calendar date;
IF present:
   require status == active; require date <= today;
   INSERT progress_records(project_id, progress_date, created_at)
   ON CONFLICT(project_id, progress_date) DO NOTHING;
ELSE:
   DELETE FROM progress_records WHERE project_id=? AND progress_date=?;
IF a row was actually changed: UPDATE projects SET version=version+1, updated_at=?;
COMMIT; SELECT updated ProjectDto;
```

重复设置同一状态为幂等写（不新增额外记录），但按钮语义由前端根据刷新后的值决定 `present` 真/假。若 `expectedVersion` 已变返回 `VERSION_CONFLICT`，由前端刷新后重试用户意图。

### 7.2 `complete_project` / `cancel_project` / `update_project_terminal_date`

```text
BEGIN IMMEDIATE
SELECT project status/version/deleted_at; require active for complete/cancel;
terminalDate = RustLocalToday() (or validated requested historical date);
SELECT MAX(progress_date) FROM progress_records WHERE project_id=?;
require max_progress_date IS NULL OR max_progress_date <= terminalDate;
require terminalDate <= RustLocalToday();
UPDATE projects SET status=?, completed_date=?, canceled_date=?,
    version=version+1, updated_at=? WHERE id=?;
COMMIT;
```

完成和取消只设置一个终止日期；直接修改终止日不改变 `status`。`restore_project` 清空两种终止日期，推进记录完全不动。快捷撤销调用 `restore_project` 并使用刚返回的新 `version`，若用户后续已修改项目则拒绝旧撤销。

### 7.3 `move_project`

```text
BEGIN IMMEDIATE
verify source is active (not trashed); verify target is null or active;
WITH RECURSIVE descendants(id) AS (
    SELECT id FROM projects WHERE id=:source
    UNION ALL
    SELECT p.id FROM projects p JOIN descendants d ON p.parent_id=d.id
)
SELECT ... descendants;
reject target==source or target IN descendants;
UPDATE source parent_id=:target, sort_order=:tail_sort_order,
       version=version+1, updated_at=now;
COMMIT;
```

同级拖拽通过完整成员 ID 列表校验后，事务中重新编号顺序；不得因为已完成/取消项目而隐藏其排序成员。跨级移动不修改后代 `parent_id`，但影响所有后代的动态显示路径，因此相关 Daily 周缓存需要刷新。

### 7.4 `trash_project` 与恢复（关键：原已删除子树）

采用**删除批次**模型（`trash_entries` + 每个节点的 `trash_entry_id`）：

```text
trash_project(root):
  BEGIN IMMEDIATE
  root must have deleted_at IS NULL;
  descendants = all subtree IDs (including previously trashed descendants);
  active_descendants = descendants WHERE deleted_at IS NULL;
  create trash_entries(batchId, kind='project', root=root, affected_count=count(active));
  UPDATE projects SET deleted_at=now, trash_entry_id=batchId
      WHERE id IN active_descendants;  -- 不覆盖先前其他批次
  COMMIT

restore_trash_entry(batchId):
  BEGIN IMMEDIATE
  root = trash_entry.root_entity_id; verify root exists;
  verify root parent is null OR parent is not trashed;
  UPDATE projects SET deleted_at=NULL, trash_entry_id=NULL
      WHERE trash_entry_id=batchId;
  DELETE trash_entries WHERE id=batchId;
  COMMIT
```

**示例：** B 先单独删除为批次 #1，后来父 A 删除为批次 #2，恢复 A/#2 不能将 B/#1 恢复。永久删除 A 时，B 无论是否仍在回收站，都会随 A 树一起实际删除；同时必须清除 B/#1 的 `trash_entries` 元数据。

**物理删除实现建议：** 使用递归 CTE 获取目标完整子树所有 ID，包括已软删除节点；在一个事务中按由深到浅的顺序删除 Project（避免 SQLite 深层级级联递归上限），其关联进度/UI 状态通过 FK CASCADE 删除；最后删除本次涉及的全部 `trash_entries`。树很大时要限制单批处理时长并保证取消操作不会留下半删除结果。

### 7.5 提醒完成、取消、恢复

```text
complete_reminder(active):
  completed_date=RustLocalToday(),
  completed_action_at=UtcNow(), status=completed,
  canceled_date=NULL;

cancel_reminder(active):
  canceled_date=RustLocalToday(), status=canceled,
  completed_date=NULL, completed_action_at=NULL;

restore_reminder(completed or canceled):
  status=active, completed_date=NULL,
  completed_action_at=NULL, canceled_date=NULL;

update_reminder_completed_date(completed, newDate):
  validate newDate <= RustLocalToday();
  change completed_date ONLY; completed_action_at stays unchanged.
```

Reminder 每次计划日修改必须重新排序到新日末尾（且新日≥今日），在同一事务里更新日期和顺序。取消/完成不改变该计划列表中的 `sort_order`。

## 8. DailyWeek Rust 聚合算法

`get_daily_week(weekStart)` 要求 `weekStart` 是有效周一日，计算 7 天闭区间 `[weekStart, weekStart+6]`。Rust 在此查询期间取得一次 `today` 快照，所有逾期判断共享同一天值，避免跨午夜半周出现混合判断。

**建议批量查询（非每天七次全量查询）：**

1. 本周内有效完成的 Projects：`status='completed' AND completed_date BETWEEN start AND end AND deleted_at IS NULL`。
2. 本周内有效推进：`progress_records.progress_date BETWEEN ...` JOIN 未删除 Projects；取消状态不排除推进。
3. 本周内 `scheduled_date` 命中的未删除 Reminders；本周内 `completed_date` 命中的已完成 Reminders；另取 `scheduled_date < today` 且 `status='active'` 的未删除逾期 Reminders（仅当本周包含今天时）。
4. 用 Rust Map 按日期分组，Project 同一 ID 同一天“完成+推进”只进入完成组一次并设置 `progressedSameDay=true`。
5. Reminder 若计划日=完成日仅在 `plannedReminders` 输出一次、状态为 completed；计划日≠完成日时在计划日输出 planned，在完成日输出 `crossDayCompletedReminders`；历史逾期额外记录不输出。
6. 真实今日的逾期投影只输出到 `overdueReminders`；今天计划日相同者不在逾期查询中（`scheduled_date < today`）。
7. 计划提醒按 `sort_order,id`；今日逾期按 `scheduled_date,sort_order,id`；跨日完成按 `completed_action_at,id`；Project 列表推荐按当前项目树深度优先顺序稳定排序。
8. 生成 Project 当前父路径；对同一日所有 Project 显示行（包含 completed/progress 两组）统计 `fullPath + title` 重复组，只对重复组生成足以区分的短 ID。
9. 返回恰好 7 个 `DailyDayDto`，依次周一→周日；不在 React 中重复实现合并、逾期、取消过滤规则。

**性能：** 以日期索引限定查询范围；对少量涉及的 Project ID 批量获取祖先路径，避免按每行逐级查询造成 N+1。`get_project_tree` 可返回平铺 DTO，React 负责树形渲染，不重新推导业务状态。

## 9. 错误码及前端对应交互

| code | 触发条件 | 前端处理 |
|---|---|---|
| `NOT_FOUND` | ID 不存在 | 关闭旧弹窗，刷新查询 |
| `IN_TRASH` | 目标实体或祖先不可用 | 告知已在回收站，刷新 |
| `INVALID_TITLE` | 空白或超长名称 | 保留输入，提示修改 |
| `INVALID_DATE` | 格式错误、无效日历日期 | 日期字段错误提示 |
| `FUTURE_DATE_FORBIDDEN` | 推进、终止或完成日设置未来 | 日期范围提示 |
| `SCHEDULE_IN_PAST` | 新建/修改计划日早于本地今日 | 引导选择今天或未来 |
| `TERMINAL_DATE_BEFORE_PROGRESS` | 项目终止日小于最后推进日 | 给出最后推进日期及处理提示 |
| `INVALID_STATUS_TRANSITION` | 终止→另一终止，或终止态新增推进 | 提示需先恢复 |
| `VERSION_CONFLICT` | 旧版本写入/旧撤销 | 刷新数据，不盲目重试 |
| `INVALID_PARENT` | 目标不存在、已软删或跨级循环 | 不修改项目树 |
| `REORDER_MEMBERSHIP_MISMATCH` | 排序列表缺失/多余/跨层/跨日 | 恢复排序，刷新成员 |
| `PARENT_IN_TRASH` | 恢复子项目但父节点仍在回收站 | 提示先恢复父项目 |
| `DB_BUSY` / `DB_ERROR` | SQLite 事务/IO 失败 | 显示错误，不宣称成功 |
| `MIGRATION_ERROR` | 无法升级或初始化数据库 | 启动错误页，保护现有文件 |

序列化时可使用 `Result<T, ApiError>`，并确保 `ApiError` 是 Tauri 可返回的可序列化对象；日志记录内部错误明细，UI 只展示安全、易理解的消息。

## 10. TanStack Query 缓存策略

| query key | 作用 |
|---|---|
| `['projectTree']` | Project 完整节点与节点摘要 |
| `['projectDetail', projectId]` | 只读详情/全部推进历史 |
| `['projectProgressMonth', projectId, month]` | 日历月视图 |
| `['dailyWeek', weekStart]` | 指定自然周的完整 Daily 结果 |
| `['reminder', reminderId]` | 提醒详情与菜单操作 |
| `['trash', kind]` | 回收站分类 |
| `['settings']` | 主题配置 |
| `['clockContext']` | Rust 今天与本周 |

- 项目新增/排序/移动/终止/推进：使 Project tree 相关缓存失效；影响已缓存的历史周时应使**所有** `['dailyWeek']` 查询失效，而非只刷新当前周。
- Reminder 新增/修改/状态：使 Daily 周缓存失效；只读详情和提醒详情按 ID 失效。
- 回收站：对应类型的 Project/Reminder 与所有 Daily 周缓存失效，并刷新当前回收站列表。
- 切换周次：`weekStart` 作为查询参数，缓存允许保留已浏览周；进入 Daily 时将当前周重置为 Rust 计算的本周。
- 午夜变化/睡眠恢复/时区变更：刷新 `clockContext`、Project 今日推进摘要以及所有必要 Daily 周查询。绝对不能用上次渲染时的旧“今天”直接提交。

## 11. 数据库约束 vs Rust 校验职责

| 约束 | SQLite | Rust |
|---|---|---|
| Project ID / Reminder ID 唯一 | PK | 创建 UUID |
| 同项目同日最多一条推进 | `(project_id, progress_date)` PK | 写时幂等处理 |
| 状态枚举、状态/日期非空组合 | CHECK | 转换前置条件 |
| 父 ID 存在 / 清除相关进度 | FK | 移动前校验 |
| 循环父子关系 | 无单条 CHECK 能完全保证 | 必须递归校验 |
| 日期字符格式 | 基础 CHECK | 真实日历合法性与本地今日上限 |
| 终止日≥最后推进日 | 不在简单 CHECK 中保证 | 必须在同一事务中校验 |
| 计划日期≥今天（仅新建和修改时） | 不适合动态 CHECK | 每次业务写操作重新校验 |
| 回收站嵌套批次一致性 | FK + 批次表 | 软删/恢复/硬删事务 |
| 5 秒撤销不覆盖较新操作 | `version` | `expected_version` 强校验 |

## 12. 开发及测试顺序

1. 运行 SQL v1 migration，建立 DB worker、错误模型、UTC 时间戳与本地日期服务。
2. 实现 Project CRUD、状态、按日推进、日期校验、同级排序、跨级移动，写单元/集成测试。
3. 实现 Daily Rust 聚合并测试跨日合并、历史逾期、项目取消和同名路径。
4. 实现 Reminder CRUD、排序、日期更新、取消与恢复，验证完成时间排序。
5. 实现批次回收站（特别验证“先删子，再删父，再恢复父”和“永久删父”），全程事务测试。
6. React 接入 Tauri Command wrappers、TanStack Query、ProjectTree、DailyWeekView、回收站和主题。
7. 测试跨午夜/本地时区变化、关窗退出、故障回滚；分别构建 Windows/macOS/Linux。

## 13. 参考技术文档

- Tauri 2 — Calling Rust from the Frontend: https://v2.tauri.app/develop/calling-rust/
- Tauri 2 — State Management: https://v2.tauri.app/develop/state-management/
- rusqlite — Connection: https://docs.rs/rusqlite/latest/rusqlite/struct.Connection.html
- SQLite — Foreign Keys: https://www.sqlite.org/foreignkeys.html
- SQLite — Recursive CTE: https://www.sqlite.org/lang_with.html

---

**交付定义：** 文档描述的是接口与实现契约；尚未包含可运行的 Tauri/React 源码。所有 SQL 实体表和索引的可执行初版位于 `001_initial.sql`。
