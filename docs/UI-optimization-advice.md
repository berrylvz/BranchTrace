# BranchTrace UI/UX 优化与重构方案

**文档版本：** V1.0  
**方案类型：** UI/UX Design & Frontend Refactoring  
**适用范围：** Projects、Weekly、Monthly 及全局公共组件  
**设计方向：** Minimalist / Local-first / Progress-oriented  
**实施方式：** 渐进式重构

---

# 01. 项目背景

## 1.1 产品定位

BranchTrace 是一款以树形项目管理、持续进度记录、日历提醒和阶段性复盘为核心的个人生产力工具。

与传统 Todo List 不同，BranchTrace 不仅关注任务是否完成，也关注用户是否持续推进某个长期目标。

产品的核心设计理念应当是：

**Track Progress, Not Just Completion.**

不仅记录完成，更记录持续进步。

## 1.2 核心页面定位

| 页面 | 核心职责 | 用户需要解决的问题 |
|---|---|---|
| Projects | 项目结构与进度记录 | 我正在推进什么？ |
| Weekly | 活动回顾与短期安排 | 我这一周做了什么？ |
| Monthly | 日历规划与提醒管理 | 我什么时候需要做？ |

三个页面分别承担目标管理、进度复盘和时间规划的职责，形成完整的个人管理闭环。

## 1.3 当前 UI 存在的问题

根据现有 Projects、Weekly、Monthly 页面，主要问题如下：

- 整体文字对比度偏低，辅助信息阅读困难。
- 页面标题、项目名称、操作按钮和辅助信息之间的视觉层级不够明确。
- Projects 页面存在大量重复操作按钮。
- 树形项目结构的层级辨识度不足。
- 项目历史进度的可视化程度较低。
- Weekly 页面存在大量无效留白，信息密度分布不均衡。
- Monthly 页面存在重复的 Details 按钮。
- Project Progress 与 Overdue 使用相近的颜色语义。
- 计划日期与实际完成日期的表达不够直观。
- 不同页面的工具栏及交互方式缺乏统一规范。
- 随着项目和提醒数量增加，现有布局的可扩展性可能受到限制。

---

# 02. 总体设计目标

## 2.1 视觉目标

建立一套简洁、现代、统一且适合长期使用的视觉体系。

整体视觉应具备以下特征：

- Minimal：简洁、克制。
- Calm：低干扰、低视觉压力。
- Structured：强调结构与层级。
- Efficient：提高信息获取和操作效率。
- Consistent：保持跨页面一致性。
- Desktop-first：优先考虑桌面应用的使用体验。

## 2.2 交互目标

- 降低记录每日进度的操作成本。
- 降低查找项目及提醒事项的成本。
- 减少不必要的弹窗和页面跳转。
- 提高键盘操作效率。
- 提高历史活动记录的可读性。
- 帮助用户快速识别长期未推进的项目。
- 让用户更加直观地感受到持续投入与阶段性成果。

## 2.3 重构原则

1. 保留现有产品的核心功能和数据语义。
2. 优先优化现有功能，而非盲目增加新功能。
3. 不为了视觉美观牺牲操作效率。
4. 不引入过度装饰性的阴影、渐变和卡片。
5. 不将 BranchTrace 重构为复杂的企业项目管理平台。
6. 优先通过公共组件与 Design Tokens 实现全局一致性。
7. UI 重构不应破坏已有数据、历史记录及数据库兼容性。
8. 渐进式实施，确保每个阶段均可以独立交付。

---

# 03. 全局 Design System

## 3.1 色彩体系

保留现有绿色作为品牌主色，调整背景、文字和状态颜色，提高视觉对比度。

### 基础颜色

| Design Token | 色值 | 用途 |
|---|---|---|
| color-primary | #216E57 | 品牌主色、主要按钮 |
| color-primary-hover | #185641 | 主要按钮悬停 |
| color-primary-active | #124536 | 按钮按下状态 |
| color-primary-soft | #E5F3EC | 选中背景 |
| color-background | #F6F8F7 | 应用背景 |
| color-surface | #FFFFFF | 内容面板 |
| color-surface-hover | #F0F4F2 | 列表悬停背景 |
| color-border | #DDE5E0 | 常规边框 |
| color-border-strong | #C5D2CB | 强调边框 |
| color-text-primary | #24352E | 正文与标题 |
| color-text-secondary | #64746C | 辅助文字 |
| color-text-muted | #89948E | 非关键辅助信息 |

### 状态颜色

| 状态 | 前景色 | 背景色 |
|---|---|---|
| Active | #216E57 | #E5F3EC |
| Completed | #21845F | #E5F3EC |
| Progress | #5479A8 | #E9F0F8 |
| Overdue | #B45309 | #FAEFE2 |
| Canceled | #89948E | #EDF0EE |
| Inactive | #64746C | #EDF0EE |
| Error / Destructive | #B42318 | #FDECEC |

以上色值为初始设计建议，最终应根据实际渲染效果进行可访问性对比度测试。

### 色彩使用原则

- 绿色表示品牌、完成、选中及积极状态。
- 蓝色表示正常的项目推进活动。
- 橙色仅用于逾期、警告及需要注意的事项。
- 红色仅用于删除、错误和严重风险。
- 灰色表示辅助信息、取消或禁用状态。
- 不允许仅通过颜色传递关键状态，应结合文字或图标。

正常项目进度不应继续与逾期提醒共享橙色语义。

## 3.2 字体系统

优先使用系统原生字体，保持桌面应用的一致性。

推荐 Font Stack：

`Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif`

| 类型 | 字号 | 字重 | 行高 |
|---|---:|---:|---:|
| Page Title | 22–24px | 600 | 30–32px |
| Section Title | 16–18px | 600 | 24px |
| Root Project | 15–16px | 600 | 22px |
| Body Text | 14px | 400 | 20px |
| Project Item | 13–14px | 400–500 | 20px |
| Button Text | 13px | 500 | 18px |
| Secondary Text | 12px | 400 | 18px |
| Metadata | 11–12px | 400 | 16px |
| Badge Text | 11–12px | 500 | 16px |

日期、计数及统计数字建议使用 Tabular Numbers，使数字在变化时保持对齐。

关键操作和主要正文不应过度使用低对比度颜色。

## 3.3 间距系统

使用 4px 作为基础间距单位。

| Token | 数值 | 使用场景 |
|---|---:|---|
| space-1 | 4px | 图标与文字之间 |
| space-2 | 8px | 紧凑组件内部 |
| space-3 | 12px | 常规组件内部 |
| space-4 | 16px | 组件之间 |
| space-5 | 20px | 页面边距 |
| space-6 | 24px | 区域间距 |
| space-8 | 32px | 大区域分隔 |
| space-12 | 48px | 主要布局间距 |

避免在每个页面单独定义不规则间距。

## 3.4 组件尺寸

| 组件 | 推荐尺寸 |
|---|---|
| 顶部导航栏 | 48–52px |
| 页面工具栏 | 48–56px |
| 普通按钮 | 32–36px |
| 主要按钮 | 36px |
| Icon Button | 28–32px |
| 输入框 | 34–36px |
| 普通图标 | 16px |
| 主要导航图标 | 18–20px |
| Checkbox | 14–16px |
| 普通项目行高 | 32–36px |
| 一级项目行高 | 40–44px |
| 项目树单级缩进 | 20–24px |
| 详情侧边栏宽度 | 320–400px |

## 3.5 圆角与边框

| Token | 数值 |
|---|---:|
| radius-sm | 4px |
| radius-md | 6px |
| radius-lg | 8px |
| radius-xl | 12px |
| radius-full | 999px |
| border-width | 1px |

普通面板优先使用浅色边框，而不是阴影。

阴影主要用于：

- Dropdown Menu
- Context Menu
- Popover
- Dialog
- Floating Panel

## 3.6 图标体系

建议统一采用 Lucide Icons 或现有项目中的同一套线性图标库。

| 功能 | 推荐图标 |
|---|---|
| Projects | GitBranch |
| Weekly | CalendarRange |
| Monthly | CalendarDays |
| Progress | TrendingUp |
| Completed | CheckCircle |
| Canceled | CircleMinus |
| Overdue | ClockAlert |
| Add | Plus |
| Search | Search |
| Filter | ListFilter |
| Settings | Settings |
| Delete | Trash2 |
| More | Ellipsis |
| Expand | ChevronDown |
| Collapse | ChevronRight |
| Activity | Activity |

统一图标尺寸、线宽及对齐方式，避免混合不同视觉风格的图标。

## 3.7 动画与微交互

| 动画类型 | 推荐时长 |
|---|---:|
| Hover | 100–120ms |
| Button transition | 100–150ms |
| Dropdown | 120–150ms |
| Tree expand/collapse | 120–180ms |
| Side panel transition | 150–200ms |
| Dialog | 150–200ms |
| Toast | 150–200ms |

动画应服务于状态反馈，不应阻碍连续操作。

尊重系统 Reduced Motion 设置。

## 3.8 深色模式

如果现有应用已经支持 Dark Mode，应将所有颜色统一迁移到语义化 Design Tokens。

禁止在页面组件中直接硬编码 Light Mode 色值。

深色模式应独立调整：

- 背景层级。
- 文字对比度。
- 状态颜色亮度。
- Hover 和 Selected 背景。
- 日历网格边框。
- 树形连接线。
- Activity Heatmap。

深色模式不应简单地对浅色模式进行颜色反转。

---

# 04. 全局应用布局

## 4.1 布局架构

采用以下层级：

- Application Shell
  - Global Navigation
  - Page Toolbar
  - Page Content
  - Optional Detail Panel
  - Overlay Layer
  - Toast Container

三个主要页面共用 Application Shell，不重复实现公共导航和工具栏组件。

## 4.2 顶部导航栏

保留现有横向导航。

左侧：

- BranchTrace Logo
- BranchTrace Wordmark
- Projects
- Weekly
- Monthly

右侧：

- 当前日期（如具有全局定位价值则保留）
- Trash
- Theme Switch
- Settings（如已有对应功能）

导航选中状态使用绿色文字和底部指示线，避免过大的彩色背景。

## 4.3 页面工具栏

统一三个页面的工具栏结构：

左侧显示：

- 页面标题。
- 项目数量或当前日期范围。
- 时间导航控件。

右侧显示：

- Search。
- Filter。
- View Mode。
- 页面主要操作。

Projects 的主要操作为 New Project。

Monthly 的主要操作为 Add Reminder。

Weekly 作为只读复盘页面，不强行增加创建操作。

## 4.4 页面滚动

- 全局导航保持固定。
- 页面工具栏在长列表中保持可见。
- Projects 内容区独立纵向滚动。
- Monthly 日历表头保持可见。
- Weekly 根据显示模式提供合理滚动行为。
- 避免无必要的多层嵌套滚动。
- 在页面间切换时尽可能保留原有视图状态。

## 4.5 显示密度

后续提供两种显示密度。

| 属性 | Compact | Comfortable |
|---|---:|---:|
| 项目行高 | 30px | 36px |
| 一级项目行高 | 36px | 44px |
| 组件间距 | 8px | 12px |
| 页面边距 | 16px | 24px |
| 普通按钮 | 30px | 36px |

默认采用 Comfortable 或与现有桌面布局最接近的密度。

---

# 05. Projects 页面重构

## 5.1 页面设计目标

Projects 是 BranchTrace 的核心功能页面。

页面应重点突出：

- 项目的树形结构。
- 当前项目状态。
- 今日是否已经记录进度。
- 项目的历史活跃程度。
- 快速创建和推进项目的能力。

整体方向为高效率的 Tree-based Project Tracker。

## 5.2 页面结构

Projects 页面分为以下区域：

1. 页面工具栏。
2. 搜索与筛选区域。
3. 项目树形列表。
4. 可选的项目详情面板。

工具栏包含：

- Projects 标题及项目数量。
- Search Projects。
- Expand All。
- Collapse All。
- Filter。
- New Project。

Expand All 和 Collapse All 可以合并为一个紧凑的操作组。

## 5.3 Project Row 组件

统一项目行的布局。

左侧信息区域：

- Expand / Collapse Icon。
- Tree Connector。
- Project Status Icon。
- Project Name。

右侧信息区域：

- Today Progress Status。
- Recent Activity。
- Completion Metadata。
- Quick Actions。
- Context Menu。

所有项目的右侧状态和操作区域应尽量对齐。

不再让操作按钮随着项目名称长度变化而产生大量不规则位置。

## 5.4 树形结构优化

### 一级项目

- 使用 15–16px 字号。
- 字重为 600。
- 行高为 40–44px。
- 与其他一级项目之间增加轻微分隔。
- 保留扁平列表形式，不额外使用独立卡片。

### 子项目

- 使用 13–14px 字号。
- 行高为 32–36px。
- 每一级增加 20–24px 缩进。
- 使用清晰但不过度强调的树形连接线。

### 树形交互

- 支持独立展开和折叠。
- 展开状态在页面切换后得到保留。
- 搜索匹配子项目时自动显示对应祖先节点。
- 搜索结束后恢复之前的展开状态。
- 深层级项目不能导致主要操作完全移出可视区域。

## 5.5 项目行操作优化

目前 Log Today、Progressed、Add Child 和 More 等操作重复出现，容易产生视觉噪音。

建议将操作分为三类。

### 常驻操作

- Project Status。
- Expand / Collapse。
- 今日进度状态。
- 可快速触达的 Log Today 操作。

### Hover / Focus 操作

- Add Child。
- 更多操作菜单。
- 其他低频快捷操作。

### Context Menu 操作

根据现有功能提供：

- Rename。
- Add Child Project。
- Move Project（如已有）。
- View Activity。
- Complete。
- Cancel。
- Restore。
- Delete。

需要确保隐藏的操作仍然可以通过键盘 Focus 或 Context Menu 访问，避免仅依赖鼠标 Hover。

当 Hover 操作出现时，应预留固定空间，避免项目名称及右侧信息发生横向位移。

## 5.6 项目状态规范

项目生命周期状态与每日进度状态必须分离。

### 生命周期状态

| 状态 | 表现形式 |
|---|---|
| Active | 空心圆形状态图标 |
| Completed | 实心绿色圆形及勾选图标 |
| Canceled | 灰色圆形及减号图标 |

### 每日进度状态

| 状态 | 表现形式 |
|---|---|
| Not Logged Today | Log Today |
| Logged Today | Check + Logged Today |
| Not Applicable | 隐藏或禁用记录操作 |

Progressed 不应被视为与 Completed、Canceled 并列的生命周期状态。

一个 Active 项目可以已经记录今日进度，也可以尚未记录。

已完成或已取消项目的操作权限应遵循现有业务规则，UI 重构不得自行改变项目状态机。

## 5.7 Log Today 交互

这是 BranchTrace 中最重要的高频操作之一。

操作要求：

1. 用户点击 Log Today。
2. 按照现有业务规则记录当天的项目活动。
3. 按钮立即更新为 Logged Today 或等价状态。
4. Activity Timeline 同步更新。
5. Weekly 和 Monthly 的对应统计同步更新。
6. 如果保存失败，恢复原状态并显示错误反馈。

如果现有业务规则限制同一项目每天只能记录一次，则应防止重复提交。

如果系统已经支持撤销进度记录，可以通过 Undo Toast 或项目菜单提供撤销入口。

不应为了记录普通进度而额外要求用户填写复杂表单。

## 5.8 Activity Timeline

将现有的历史日期列表进一步优化为微型 Activity Timeline。

### 默认显示

显示最近 14 天的项目活动。

宽屏模式下可以进一步支持最近 30 天。

### 视觉规则

- 无活动：浅灰色方格。
- 有进度记录：浅绿色或蓝绿色方格。
- 当日完成：深绿色方格或完成标记。
- 当前日期：细边框强调。
- 未来日期：不显示为已发生的活动。

如果每个项目每天只有一条记录，则只使用二元活动状态，不制造虚假的活动强度层级。

如果业务支持多次记录，再根据真实记录数量增加颜色深浅。

### 交互规则

鼠标 Hover 或键盘 Focus 到日期方格时显示：

- 日期。
- 活动类型。
- 进度记录数量（如适用）。
- 完成状态（如适用）。

点击 Activity Timeline 可以打开项目历史活动详情。

原有的具体日期信息应保留在 Tooltip 或详情视图中。

## 5.9 Inactive Project

增加长期未推进项目的识别能力。

Inactive 应当是一个由活动记录计算得到的筛选维度，而不是新的项目生命周期状态。

初始建议：

- 最近 7 天无进度。
- 最近 14 天无进度。
- 最近 30 天无进度。

用户可按需要设置阈值。

Completed 和 Canceled 项目默认不参与 Inactive 计算。

从未记录过活动的新项目，应根据产品规则显示为 No Activity Yet 或在超过设定时间后归为 Inactive。

不使用红色表示普通的长期未推进项目，以避免制造不必要的压力。

## 5.10 搜索与筛选

支持按照项目名称进行搜索。

推荐筛选项：

- All。
- Active。
- Completed。
- Canceled。
- Logged Today。
- Not Logged Today。
- Inactive。

搜索结果应保留匹配节点的祖先路径，避免用户失去项目上下文。

筛选条件可通过 Clear Filters 一键清除。

新增排序功能属于可选增强，不建议默认破坏用户已有的树形项目排列顺序。

## 5.11 Project Detail Panel

后续可增加右侧项目详情面板。

建议宽度为 320–400px。

面板包含：

- Project Name。
- Project Status。
- Parent Path。
- 最近活动。
- 完整进度历史。
- 完成日期。
- 取消日期（如适用）。
- 子项目数量。
- 与现有业务对应的项目操作。

项目描述、优先级、标签等尚未确认存在的数据字段，不作为本次基础 UI 重构的强制要求。

---

# 06. Weekly 页面重构

## 6.1 页面设计目标

Weekly 不应仅仅是七个日期列的集合，而应该成为轻量级的每周活动回顾页面。

主要职责：

- 回顾本周完成的项目。
- 查看本周记录的进度。
- 查看本周提醒事项。
- 了解活动在一周内的分布。
- 识别当前需要关注的事项。

继续保留现有 Read-only 设计原则。

## 6.2 页面结构

建议划分为：

1. Weekly Toolbar。
2. Weekly Overview。
3. Overdue Section。
4. Weekly Content。
5. View Mode Switch。

页面标题优先强调实际日期范围，例如：

Nov 23 – Nov 29, 2026

提供 Previous Week、This Week 和 Next Week 操作。

## 6.3 Weekly Overview

新增紧凑型统计栏。

| 统计项 | 定义 |
|---|---|
| Completed Projects | 本周实际完成的项目数量 |
| Progress Logs | 本周实际发生的进度记录数量 |
| Active Days | 本周存在项目活动的日期数量 |
| Reminders Done | 本周实际完成的提醒数量 |
| Upcoming | 本周尚未完成且未逾期的计划提醒数量 |

Overdue 建议独立展示，不与普通的历史周统计混合。

### 统计原则

- 以真实记录为数据来源。
- 不重复统计跨日期展示的提醒事项。
- 区分项目完成事件与进度记录事件。
- 明确父项目是否存在独立的进度记录。
- 不将自动汇总的子项目活动误算为父项目的独立活动。
- 未来日期不参与已发生活动统计。
- 切换历史周时，统计结果应对应选中的周。

## 6.4 Daily Activity Chart

可以在 Weekly Overview 中加入微型柱状图。

横轴：

Mon / Tue / Wed / Thu / Fri / Sat / Sun

纵轴：

每日真实活动数量。

不同活动类型可以采用：

- Completed：绿色。
- Progress：蓝色。

提醒完成记录如需纳入图表，应明确标记统计口径。

图表主要用于识别活动分布，不需要复杂的数据分析或生产力评分。

## 6.5 Week Grid 模式

保留现有七列布局。

重点优化：

- 日期栏高度和字号。
- 日期标题与内容的区分。
- 今天的选中表现。
- 空白日期的展示。
- 信息密集日期的内容溢出。
- 周末背景的辨识度。

空日期不需要突出显示大段 No Items。

可以仅使用低干扰的占位符，或者保持自然留白。

在窗口较窄时，允许用户切换 Timeline 模式，避免将七列压缩到无法阅读的宽度。

## 6.6 Timeline 模式

新增纵向时间线模式，解决活动分布不均衡的问题。

时间线按照日期排列。

每个日期包含：

- Date Header。
- Daily Summary。
- Completed Projects。
- Project Progress。
- Reminders。
- Reminders Completed from Other Dates。

### 日期区块

今天的日期区块默认展开，并使用浅绿色背景或细绿色边框强调。

其他日期根据内容数量决定是否需要折叠。

允许用户：

- 展开或折叠某一天。
- 展开全部活动。
- 隐藏无活动日期。
- 切换回 Week Grid 模式。

信息密集日期可以占据更多纵向空间，不再受七列等宽布局限制。

Timeline 模式应记忆用户的显示偏好。

## 6.7 日期内部信息层级

推荐显示顺序：

1. Completed Projects。
2. Project Progress。
3. Scheduled Reminders。
4. Reminders Completed from Other Dates。
5. Canceled Items（如需显示）。

日期内的 Section Title 应具有清晰的字体和颜色层级。

对于已经完成的项目，不必同时在两个区块中重复完整显示；如果该项目同日确实产生了完成和进度两类事件，可以通过状态标记表达，并保留独立的统计口径。

## 6.8 项目路径展示

目前项目路径可能因日期列宽度不足而被截断。

建议：

- 主文本显示项目名称。
- 次级文字显示直接父项目或简化路径。
- Hover 时显示完整 Breadcrumb。
- 如果支持跳转，则点击项目名称定位到 Projects 对应节点。

相同名称的项目通过父级路径进行区分。

内部 ID 不应作为默认的用户可读信息，除非用于必要的同名消歧或调试模式。

## 6.9 Overdue Section

将逾期提醒从今天的日期列中提取出来，作为独立的关注区域。

显示：

- Overdue Reminders。
- 逾期数量。
- Reminder Name。
- 原定日期。
- 逾期天数（可选）。

支持折叠与展开。

Weekly 页面保持只读，不直接提供完成提醒的 Checkbox 操作，可以通过点击提醒跳转至 Monthly。

在查看历史周时，应明确区分：

- 当前仍然逾期的提醒。
- 历史日期上的计划或完成记录。

不能将当前的逾期状态直接作为历史时点的状态使用。

## 6.10 Read-only 交互优化

Weekly 的所有状态图标应明确表示只读。

- 未完成：空心状态图标。
- 已完成：勾选状态图标。
- 已取消：减号状态图标。
- 已逾期：橙色时钟图标。

不要使用看起来可直接编辑、实际上没有响应的交互式 Checkbox。

允许只读页面提供导航操作，但不应破坏其复盘定位。

---

# 07. Monthly 页面重构

## 7.1 页面设计目标

Monthly 是时间规划和提醒管理的主要页面。

优化重点：

- 减少日历格子的视觉噪音。
- 提高日期活动统计的可读性。
- 方便创建和管理提醒。
- 清晰表达计划日期与实际完成日期。
- 提供连续、低干扰的日期详情浏览体验。

## 7.2 页面结构

Monthly 页面包括：

1. Calendar Toolbar。
2. Overdue Reminders Banner。
3. Calendar Grid。
4. Calendar Legend。
5. Optional Day Detail Panel。

工具栏左侧：

- 当前年月。
- Previous Month。
- Today / This Month。
- Next Month。

工具栏右侧：

- Display Mode。
- Filter。
- Add Reminder。

保留当前快速输入提醒的效率，不强制将所有新增操作改为弹窗。

## 7.3 Calendar Cell 组件

每个日期格子使用统一结构。

### Header

包含：

- 日期数字。
- Today 标识。
- 项目完成数量。
- 项目进度数量。

### Content

包含：

- 未完成提醒。
- 已完成提醒。
- 已取消提醒。
- 与该日期相关的实际完成记录。
- Overflow Indicator。

### Interaction

- Hover：轻微背景变化。
- Selected：明确的边框或选中背景。
- Today：绿色日期标记。
- Weekend：轻微差异化背景。
- Outside Month：降低视觉强调程度。

今天与用户当前选中的日期必须使用不同的视觉表达。

## 7.4 移除重复的 Details 按钮

当前每个日期格子均存在 Details 按钮，产生大量重复视觉元素。

优化方式：

- 默认隐藏独立 Details 按钮。
- 点击日期标题或日期格子的空白区域，打开日期详情。
- Hover / Focus 时显示可选的详情入口。
- 支持通过键盘打开日期详情。
- 保留提醒事项自身的操作能力。

点击提醒的 Checkbox 时，不应同时触发打开日期详情的事件。

## 7.5 Calendar Cell 信息容量

每个日期格子根据可用高度展示有限数量的提醒。

建议默认展示 3–4 条，具体数量根据窗口尺寸动态调整。

超出可显示范围时使用：

+ 3 more

点击后打开对应的 Day Detail Panel。

不得出现：

- 提醒文字覆盖日期。
- 内容溢出到其他日期格子。
- 单个日期导致整个日历布局异常拉伸。
- 无法访问被截断的提醒内容。

## 7.6 日期活动统计

将日期上的统计标记统一为：

- Check Icon + Completed Count。
- Progress Icon + Progress Count。

颜色语义：

- Completed：绿色。
- Progress：蓝色。
- Overdue：橙色。

统计标记应配有 Tooltip，说明具体含义。

例如：

2 projects completed

8 progress records

在没有对应活动时，可以隐藏数量标记，避免每个日期都出现零值。

## 7.7 Day Detail Panel

使用非模态右侧详情面板，替代高频使用的独立日期弹窗。

推荐宽度：320–400px。

面板打开后，用户仍然能够点击日历中的其他日期。

### 面板顶部

- 完整日期。
- 星期。
- Today 状态。
- Previous Day。
- Next Day。
- Close。

### 面板内容

第一部分：Reminders。

- 未完成提醒。
- 已完成提醒。
- 已取消提醒。
- 新增提醒。
- 编辑提醒。
- 删除提醒。

第二部分：Completed Projects。

- 当天完成的项目列表。
- 项目路径。
- 对应项目跳转。

第三部分：Project Progress。

- 当天真实进度记录。
- 项目路径。
- 对应项目跳转。

第四部分：Cross-date Completion。

- 其他日期计划、当天实际完成的提醒。
- 当天计划、其他日期实际完成的提醒。

详情面板应根据现有权限和业务规则提供操作。

## 7.8 Overdue Banner

保留 Monthly 顶部的 Overdue Reminders 区域。

优化目标：

- 避免所有逾期提醒无限横向排列。
- 提高提醒数量增长后的扩展能力。
- 支持快速处理当前需要关注的提醒。

默认显示：

Overdue Reminders · 3

在空间足够时展示少量提醒预览。

内容超出时使用：

+ N more

展开后展示完整逾期列表，并提供现有业务支持的操作，如完成、修改日期或更多菜单。

没有逾期提醒时隐藏该区域。

该区域应明确表达当前逾期状态，而不是当前浏览月份的历史逾期状态。

## 7.9 Planned Date 与 Actual Completion Date

保留 BranchTrace 已有的计划日期与实际完成日期分离能力。

这是产品的重要差异化功能。

### 场景 A：按时完成

Planned: Nov 23

Completed: Nov 23

显示为：

Completed on time

### 场景 B：提前完成

Planned: Nov 25

Completed: Nov 23

显示为：

Completed 2 days early

### 场景 C：延后完成

Planned: Nov 20

Completed: Nov 23

显示为：

Completed 3 days late

### 展示规则

- 日历格子内使用简短的日期元数据。
- 详情面板内使用完整的日期说明。
- 提前完成可以使用绿色或中性文字。
- 延后完成属于历史事实，默认使用中性文字。
- 已经完成的提醒不应继续被标记为当前 Overdue。
- 计划日期和实际完成日期上的重复展示必须指向同一个提醒记录。

## 7.10 Calendar Display Mode

后续增加三种显示模式。

### Planned

按照计划日期展示提醒。

用于：

- 计划管理。
- 查看原始日程。
- 管理未来提醒。

### Actual

按照实际完成日期展示已完成提醒。

未完成提醒仍需通过 Planned 模式或其他明确入口访问。

用于：

- 实际活动回顾。
- 历史完成记录查看。

### Both

同时展示计划日期与实际完成日期。

用于：

- 对照计划和实际执行情况。
- 查看提前或延后完成的事项。

默认建议保留现有 Both 展示逻辑，避免改变用户已经熟悉的行为。

所有模式应保持统计去重。

## 7.11 快速创建提醒

保留现有快速创建区域，并优化交互反馈。

推荐流程：

1. 输入提醒名称。
2. 选择提醒日期。
3. 点击 Add 或按 Enter。
4. 保存成功。
5. 日历立即更新。
6. 根据连续录入场景决定是否保留当前日期。
7. 输入框恢复为可继续录入状态。

在选中某个日期时，可以默认将该日期作为新提醒的计划日期。

空名称、无效日期及保存失败需要提供明确反馈。

---

# 08. 公共交互规范

## 8.1 Hover

所有可交互组件应具有统一 Hover 状态。

包括：

- Button。
- Icon Button。
- Project Row。
- Calendar Cell。
- Navigation Item。
- Menu Item。

Hover 不应引起组件尺寸变化或布局偏移。

## 8.2 Focus

所有可通过键盘访问的交互组件应提供清晰的 Focus Ring。

推荐：

- 2px Focus Outline。
- 适当的 Outline Offset。
- 绿色或其他高对比度焦点颜色。

Focus 不应仅依赖背景变化。

## 8.3 Selected State

选中状态用于：

- 当前导航页面。
- 当前选中的项目。
- 当前选中的日历日期。
- 当前激活的筛选条件。

使用浅绿色背景、绿色边框或明确的文字强调。

选中状态与 Hover 状态应有所区别。

## 8.4 Disabled State

禁用组件应具有：

- 降低的视觉强调程度。
- 不可触发的交互。
- 必要时提供禁用原因。

避免所有禁用控件都采用过低对比度，导致用户无法理解其含义。

## 8.5 Toast Notification

统一操作反馈机制。

| 操作 | 示例反馈 |
|---|---|
| 记录进度 | Progress logged |
| 创建项目 | Project created |
| 完成项目 | Project completed |
| 创建提醒 | Reminder added |
| 完成提醒 | Reminder completed |
| 删除项目 | Project moved to Trash |
| 保存失败 | Failed to save changes |

低风险操作优先采用 Toast，而不是阻塞式 Dialog。

如果现有业务支持撤销，可以提供 Undo。

Toast 不应遮挡主要操作区域。

## 8.6 Dialog

仅用于需要用户明确确认的操作。

例如：

- 永久删除。
- 删除或取消包含子项目的项目，且会产生不可忽略的影响。
- 可能导致数据丢失的操作。
- 不可逆的数据操作。

确认弹窗应明确描述操作对象、影响范围和可恢复性。

## 8.7 Context Menu

Projects 和 Monthly 可以统一使用公共 Context Menu 组件。

要求：

- 支持鼠标右键。
- 支持 More Button。
- 支持键盘导航。
- 危险操作放置于菜单底部。
- 使用 Divider 区分操作分组。
- 菜单不得超出窗口可视范围。
- Escape 可以关闭菜单。
- 关闭后恢复合理的键盘焦点。

## 8.8 空状态

### Projects

No projects yet.

Create your first project and start tracking progress.

### Search

No matching projects.

Try a different search or clear your filters.

### Weekly

No activity recorded for this week.

### Monthly

没有提醒的日期默认保持简洁，不为每个日期重复增加空状态文案。

### Activity Timeline

No activity recorded yet.

空状态应清晰、简短，不使用无必要的大型插画。

---

# 09. 键盘操作与可访问性

## 9.1 推荐快捷键

| 快捷键 | 功能 |
|---|---|
| Ctrl/Cmd + 1 | Projects |
| Ctrl/Cmd + 2 | Weekly |
| Ctrl/Cmd + 3 | Monthly |
| Ctrl/Cmd + K | 搜索 |
| N | 创建当前页面对应的项目或提醒 |
| Enter | 确认或打开 |
| Escape | 关闭面板或取消当前操作 |
| Arrow Up / Down | 项目节点或菜单导航 |
| Arrow Left / Right | 折叠或展开项目树 |
| T | 返回今天或当前时间范围 |
| Ctrl/Cmd + F | 当前页面搜索 |

新增快捷键前需要检查操作系统和现有应用快捷键是否冲突。

普通字符快捷键不得在输入框、文本编辑区域或组合输入过程中误触发。

## 9.2 Tree Keyboard Navigation

Projects 页面应支持：

- Up：上一个可见节点。
- Down：下一个可见节点。
- Left：折叠当前节点或移动到父节点。
- Right：展开当前节点或移动到子节点。
- Home：第一个可见节点。
- End：最后一个可见节点。
- Enter：执行约定的节点操作。

节点折叠或删除后应恢复到合理的焦点位置。

## 9.3 Accessibility

建议以 WCAG 2.2 AA 的相关要求作为设计和测试目标。

重点要求：

- 普通文字对比度至少为 4.5:1。
- 大号文字对比度至少为 3:1。
- 必要的非文本状态与交互边界满足相应对比度要求。
- 所有主要功能支持键盘操作。
- Icon Button 提供可访问名称。
- Tooltip 不作为唯一的关键信息来源。
- 状态不能只通过颜色表达。
- 支持系统字体缩放。
- 支持 Reduced Motion。
- 避免焦点被固定工具栏或面板遮挡。

对于自定义 Tree、Calendar Grid 等复杂组件，应提供合理的语义角色和焦点管理。

---

# 10. 响应式桌面布局

BranchTrace 采用 Desktop-first 设计，但需要适配不同尺寸的桌面窗口。

## 10.1 宽屏模式

建议窗口宽度：1440px 及以上。

- Projects 显示完整树形结构及 Activity Timeline。
- Weekly 支持七列 Week Grid。
- Monthly 支持日历与右侧详情面板并排显示。
- 工具栏显示完整操作。

## 10.2 标准窗口

建议窗口宽度：1024–1439px。

- Projects 减少 Activity Timeline 显示天数。
- 低频操作收纳至 More Menu。
- Weekly 支持切换 Timeline 模式。
- Monthly 详情面板根据剩余日历宽度决定并排或覆盖显示。

## 10.3 窄窗口模式

建议窗口宽度低于 1024px。

- 使用紧凑工具栏。
- 隐藏非必要的元数据。
- Weekly 优先提供 Timeline 模式。
- Monthly 详情面板采用 Overlay。
- 保证提醒操作及项目主要操作仍然可访问。

上述断点属于初始设计建议，应以实际桌面应用窗口尺寸和系统缩放测试结果为准。

---

# 11. 前端组件重构建议

建议将公共组件、布局组件和页面专属组件分离。

以下为逻辑组件结构示意，具体文件命名及实现方式应适配当前技术栈。

```text
src/
├── components/
│   ├── ui/
│   │   ├── Button
│   │   ├── IconButton
│   │   ├── Input
│   │   ├── Checkbox
│   │   ├── Badge
│   │   ├── StatusIcon
│   │   ├── Tooltip
│   │   ├── Dropdown
│   │   ├── ContextMenu
│   │   ├── Dialog
│   │   ├── Toast
│   │   ├── SidePanel
│   │   ├── EmptyState
│   │   └── SegmentedControl
│   ├── layout/
│   │   ├── AppShell
│   │   ├── GlobalNavigation
│   │   ├── PageToolbar
│   │   └── PageContent
│   └── shared/
│       ├── DateNavigator
│       ├── ProjectBreadcrumb
│       ├── ReminderItem
│       ├── ActivityIndicator
│       └── OverdueSummary
├── features/
│   ├── projects/
│   │   ├── ProjectTree
│   │   ├── ProjectRow
│   │   ├── ProjectActions
│   │   ├── ProjectSearch
│   │   ├── ProjectFilters
│   │   ├── ActivityTimeline
│   │   └── ProjectDetailPanel
│   ├── weekly/
│   │   ├── WeeklyOverview
│   │   ├── WeeklyGrid
│   │   ├── WeeklyTimeline
│   │   ├── WeeklyDay
│   │   └── DailyActivityChart
│   └── monthly/
│       ├── CalendarGrid
│       ├── CalendarCell
│       ├── CalendarHeader
│       ├── CalendarLegend
│       ├── DayDetailPanel
│       ├── ReminderQuickAdd
│       └── OverdueBanner
└── styles/
    ├── tokens
    ├── typography
    ├── themes
    ├── utilities
    └── animations
```

## 11.1 Design Tokens 示例

以下以 CSS Custom Properties 为例。

```css
:root {
  --color-primary: #216e57;
  --color-primary-hover: #185641;
  --color-primary-active: #124536;
  --color-primary-soft: #e5f3ec;

  --color-background: #f6f8f7;
  --color-surface: #ffffff;
  --color-surface-hover: #f0f4f2;

  --color-text-primary: #24352e;
  --color-text-secondary: #64746c;
  --color-text-muted: #89948e;

  --color-border: #dde5e0;
  --color-border-strong: #c5d2cb;

  --color-completed: #21845f;
  --color-progress: #5479a8;
  --color-overdue: #b45309;
  --color-canceled: #89948e;
  --color-danger: #b42318;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;

  --font-size-xs: 11px;
  --font-size-sm: 12px;
  --font-size-base: 14px;
  --font-size-lg: 16px;
  --font-size-xl: 18px;
  --font-size-2xl: 24px;

  --row-height-project: 36px;
  --row-height-root: 44px;
  --tree-indent: 24px;
  --control-height: 36px;
  --detail-panel-width: 360px;

  --transition-fast: 120ms;
  --transition-normal: 180ms;
}
```

## 11.2 组件复用原则

- Button 统一管理尺寸、颜色和交互状态。
- StatusIcon 统一管理项目及提醒的状态图标。
- ReminderItem 支持 Editable 和 Read-only 两种模式。
- DateNavigator 由 Weekly 和 Monthly 共享。
- OverdueSummary 统一逾期数量及展示逻辑。
- SidePanel 统一面板打开、关闭及焦点管理。
- ActivityIndicator 统一项目活动的可视化表现。
- 所有业务状态通过统一映射函数生成显示样式。

避免同一个业务状态在不同页面拥有不同的视觉语义。

---

# 12. 数据与业务逻辑约束

UI 重构原则上不改变现有数据库 Schema。

新增展示功能优先根据已有数据计算。

## 12.1 数据概念区分

必须区分以下概念：

- Project Lifecycle Status。
- Daily Progress Event。
- Project Completion Event。
- Reminder Planned Date。
- Reminder Actual Completion Date。
- Reminder Status。
- Derived Overdue State。
- Derived Inactive State。

不得将 Progressed 直接等同于 Completed。

不得将 Overdue 或 Inactive 无条件写入生命周期状态字段。

## 12.2 统计一致性

Projects、Weekly、Monthly 必须共享统一的数据统计口径。

例如：

用户在 Projects 页面记录一条当天进度后：

- Projects 显示当天已记录状态。
- Activity Timeline 更新对应日期。
- Weekly 显示对应项目活动。
- Monthly 更新对应日期的进度统计。

不应由各页面独立维护相互冲突的统计逻辑。

## 12.3 日期一致性

- 使用一致的本地日期转换规则。
- 正确处理跨月、跨年。
- 正确处理闰年。
- 正确处理未来日期。
- 保留计划日期与实际完成日期的独立性。
- 不因 UI 格式化而改变原始时间数据。

## 12.4 数据兼容性

现有用户数据在重构后应正常读取。

应覆盖：

- 已完成项目。
- 已取消项目。
- 多层级项目。
- 同名项目。
- 无进度项目。
- 历史进度记录。
- 逾期提醒。
- 提前完成提醒。
- 延后完成提醒。
- 已取消提醒。
- 已删除或移至 Trash 的项目。

如后续功能确实需要新的数据字段，应单独提出数据库迁移方案，而不是混入基础 UI 优化。

---

# 13. 性能优化

## 13.1 Projects

- 避免单个项目更新导致整个项目树不必要地重新渲染。
- 折叠节点无需渲染不可见的子节点内容。
- 搜索和筛选使用合理的数据缓存。
- Activity Timeline 避免为每个日期创建独立数据库查询。
- 项目数量达到较大规模后再根据性能测试决定是否引入虚拟列表。

## 13.2 Weekly

- 只读取当前显示周所需的数据。
- 提前计算每日活动分组。
- Week Grid 与 Timeline 共享同一份数据。
- 切换显示模式不应重复执行不必要的数据库查询。

## 13.3 Monthly

- 按当前日历可见日期范围读取数据。
- 统一计算每个日期的项目活动统计。
- Day Detail Panel 复用已加载数据。
- 快速切换月份时避免旧请求覆盖新页面。

## 13.4 性能目标

以下为建议测试目标，而非当前性能测量结果。

| 操作 | 建议目标 |
|---|---|
| Hover 反馈 | 即时 |
| Button Press 反馈 | 即时 |
| 普通树节点展开 | 100ms 内 |
| 常规搜索反馈 | 150ms 内 |
| 日期面板打开 | 200ms 内 |
| 月份或周切换 | 300ms 内 |
| 普通交互动画 | 尽量保持流畅 |

具体指标应在实际桌面环境、合理数据规模和明确的测试设备上进行测量。

---

# 14. 分阶段实施计划

## Phase 1：Design Foundation

优先级：P0

目标：建立统一的 UI 基础设施。

任务：

- [ ] 建立全局 Design Tokens。
- [ ] 统一 Light / Dark Theme。
- [ ] 提高文字对比度。
- [ ] 统一字体层级。
- [ ] 统一间距及圆角。
- [ ] 统一 Button 组件。
- [ ] 统一 Icon Button。
- [ ] 统一 Status Icon。
- [ ] 统一 Tooltip。
- [ ] 统一 Hover / Focus / Disabled 状态。
- [ ] 统一公共页面工具栏。
- [ ] 区分 Progress 和 Overdue 的颜色语义。

交付标准：

三个页面具备一致的基础视觉体系，原有业务功能保持正常。

## Phase 2：Projects Optimization

优先级：P0–P1

目标：提升核心项目管理及进度记录体验。

任务：

- [ ] 重构 Project Row。
- [ ] 优化树形缩进及连接线。
- [ ] 强化一级项目视觉层级。
- [ ] 减少重复操作按钮。
- [ ] 优化 Log Today。
- [ ] 完善项目状态映射。
- [ ] 优化 Context Menu。
- [ ] 增加项目搜索。
- [ ] 增加项目筛选。
- [ ] 保留项目展开状态。
- [ ] 增加 Activity Timeline。
- [ ] 完善树形键盘导航。

交付标准：

用户能够更快速地识别项目层级、查找项目及记录每日进度。

## Phase 3：Monthly Optimization

优先级：P0–P1

目标：提高日历的可读性和提醒管理效率。

任务：

- [ ] 重构 Calendar Cell。
- [ ] 移除重复 Details 按钮。
- [ ] 完善日期选择交互。
- [ ] 优化活动数量标识。
- [ ] 优化 Overdue Banner。
- [ ] 增加提醒 Overflow Indicator。
- [ ] 优化快速创建提醒。
- [ ] 增加 Day Detail Panel。
- [ ] 明确 Planned / Actual 元数据。
- [ ] 统一提醒状态样式。
- [ ] 完善窄窗口布局。

交付标准：

用户能够在不频繁打开弹窗的情况下浏览日期详情、创建和管理提醒。

## Phase 4：Weekly Redesign

优先级：P1

目标：将 Weekly 优化为轻量级复盘工具。

任务：

- [ ] 优化现有七列布局。
- [ ] 增加 Timeline 模式。
- [ ] 增加 Weekly Overview。
- [ ] 增加 Daily Activity Chart。
- [ ] 独立展示 Overdue。
- [ ] 优化项目路径展示。
- [ ] 完善只读状态。
- [ ] 增加项目及提醒跳转。
- [ ] 保存显示模式偏好。
- [ ] 统一历史统计口径。

交付标准：

Weekly 能够清晰展示一周活动，避免大量信息集中在单个狭窄日期列中。

## Phase 5：Advanced Experience

优先级：P2

目标：提升长期使用体验及产品差异化。

任务：

- [ ] Project Detail Panel。
- [ ] Inactive Project Filter。
- [ ] Compact / Comfortable Mode。
- [ ] Planned / Actual / Both Mode。
- [ ] 高级键盘快捷键。
- [ ] 30 天 Activity Timeline。
- [ ] 完整微交互优化。
- [ ] 大数据量性能优化。
- [ ] 全局可访问性测试。

---

# 15. 优化任务优先级总表

| ID | 优化任务 | 优先级 | 预估复杂度 |
|---|---|---|---|
| UI-001 | 全局 Design Tokens | P0 | 中 |
| UI-002 | 字体与对比度优化 | P0 | 低 |
| UI-003 | 状态颜色统一 | P0 | 低 |
| UI-004 | 公共按钮组件 | P0 | 中 |
| UI-005 | 全局导航与工具栏 | P0 | 低 |
| UI-006 | Project Row 重构 | P0 | 中 |
| UI-007 | 重复操作按钮优化 | P0 | 低 |
| UI-008 | Log Today 优化 | P0 | 低 |
| UI-009 | 移除重复 Details | P0 | 低 |
| UI-010 | 日历活动标识优化 | P0 | 低 |
| UI-011 | Read-only 状态优化 | P0 | 低 |
| UI-012 | Hover / Focus 规范 | P0 | 低 |
| UI-013 | 项目搜索与筛选 | P1 | 中 |
| UI-014 | Activity Timeline | P1 | 中 |
| UI-015 | Day Detail Panel | P1 | 中 |
| UI-016 | Overdue 区域优化 | P1 | 中 |
| UI-017 | Weekly Timeline | P1 | 中 |
| UI-018 | Weekly Overview | P1 | 中 |
| UI-019 | 跨页面导航定位 | P1 | 中 |
| UI-020 | 日期元数据优化 | P1 | 低 |
| UI-021 | Project Detail Panel | P2 | 中 |
| UI-022 | Inactive Project Filter | P2 | 中 |
| UI-023 | 显示密度切换 | P2 | 中 |
| UI-024 | Calendar Display Mode | P2 | 中 |
| UI-025 | 高级键盘导航 | P2 | 中 |
| UI-026 | 大数据量性能优化 | P2 | 高 |
| UI-027 | 微交互及动画 | P2 | 低 |

复杂度为初步估计，实际开发成本取决于现有组件结构、数据接口和技术栈。

---

# 16. 测试与验收标准

## 16.1 全局视觉验收

- [ ] 三个页面使用统一的 Design Tokens。
- [ ] 不存在无必要的硬编码颜色。
- [ ] 主文字与辅助文字层级明确。
- [ ] Progress 与 Overdue 颜色明显区分。
- [ ] 所有按钮具有统一交互状态。
- [ ] Hover 不导致布局位移。
- [ ] Focus 状态清晰可见。
- [ ] Light Mode 和 Dark Mode 正常。
- [ ] 窗口缩放后无明显布局异常。

## 16.2 Projects 验收

- [ ] 多层项目结构能够清晰识别。
- [ ] 展开和折叠行为正常。
- [ ] 项目名称不会被操作按钮不合理遮挡。
- [ ] Log Today 操作无需额外无意义步骤。
- [ ] 进度记录成功后页面正确更新。
- [ ] 保存失败时不会显示虚假的成功状态。
- [ ] 搜索结果保留项目祖先路径。
- [ ] 筛选条件能够正确组合或清除。
- [ ] 已完成及已取消项目状态正确。
- [ ] Activity Timeline 与真实记录一致。
- [ ] 同名项目能够区分。
- [ ] 所有隐藏操作仍可通过键盘访问。

## 16.3 Weekly 验收

- [ ] 正确显示选定周的日期范围。
- [ ] Week Grid 与 Timeline 数据一致。
- [ ] 统计数量与真实记录一致。
- [ ] 无活动日期不会产生过多视觉噪音。
- [ ] 信息密集日期能够完整浏览。
- [ ] Overdue 区域与历史周数据正确区分。
- [ ] Read-only 组件不会误导用户进行编辑。
- [ ] 跨页面跳转能够正确定位目标项目。
- [ ] 已完成提醒不会被重复统计。

## 16.4 Monthly 验收

- [ ] 日历能够正确显示不同月份。
- [ ] 跨年及闰年显示正常。
- [ ] 今天与选中日期能够区分。
- [ ] 日期格子的活动数量正确。
- [ ] 提醒过多时显示 Overflow Indicator。
- [ ] 所有被收起的提醒仍可访问。
- [ ] 点击日期能够打开详情面板。
- [ ] 点击提醒不会误触日期详情。
- [ ] 快速创建提醒正常。
- [ ] Overdue 状态计算正确。
- [ ] 提前和延后完成的提醒表达正确。
- [ ] 同一提醒在跨日期展示时不会重复计数。

## 16.5 数据安全验收

- [ ] UI 重构不会丢失现有数据。
- [ ] 现有数据库能够正常加载。
- [ ] 历史记录保持完整。
- [ ] 原有项目层级保持不变。
- [ ] 已完成和已取消状态保持不变。
- [ ] 所有页面的数据更新保持一致。
- [ ] 操作失败后能够恢复正确状态。
- [ ] 应用重启后必要的用户偏好得到保留。

## 16.6 压力测试场景

建议覆盖以下数据规模：

| 测试项 | 测试规模 |
|---|---|
| 项目总量 | 26 / 100 / 500 / 1000 |
| 项目嵌套深度 | 1 / 3 / 5 / 10 |
| 单日项目活动 | 0 / 10 / 50 / 100 |
| 单日提醒数量 | 0 / 5 / 20 / 50 |
| 历史记录跨度 | 1 / 6 / 12 / 24 个月 |
| 窗口宽度 | 800 / 1024 / 1440 / 1920px |
| 系统缩放 | 100% / 125% / 150% / 200% |

---

# 17. 本次重构非目标

为了避免项目范围不断扩张，本次基础 UI 重构暂不包含：

- 团队协作系统。
- 企业权限管理。
- 多用户项目分配。
- 云端同步系统重构。
- 复杂的甘特图。
- OKR 管理系统。
- 复杂的任务优先级体系。
- 工时与计费管理。
- AI 自动任务规划。
- 生产力评分及排名。
- 与核心体验无关的大型 Dashboard。
- 无明确业务需求的数据库重构。

这些功能如有后续需求，应单独进行产品设计，不应干扰当前 UI 优化目标。

---

# 18. 产品设计参考

## Linear

参考方向：

- 高效率列表布局。
- 一致的 Hover 状态。
- 克制的操作按钮。
- 快速搜索。
- 键盘交互。

## Things 3

参考方向：

- 清晰的任务状态。
- 轻量化个人管理体验。
- 日期信息组织。
- 简洁的字体与留白。

## Workflowy

参考方向：

- 多层级树形结构。
- 节点展开和折叠。
- 项目上下文保留。
- 低干扰列表操作。

## GitHub

参考方向：

- Activity Heatmap。
- 历史活动可视化。
- 持续投入的表达。
- 日期与记录的关联。

BranchTrace 不应直接复制上述产品，而应结合自身进度追踪理念，形成独立设计语言。

---

# 19. 最终产品体验目标

完成本次重构后，BranchTrace 应形成以下体验闭环。

Projects：

组织长期目标，管理项目结构，低成本记录每次推进。

Monthly：

安排未来事项，管理时间，追踪计划与实际完成情况。

Weekly：

回顾近期活动，识别阶段性成果，理解自己的持续投入。

三个页面通过统一的进度记录和时间信息形成连接。

最终目标不是让用户管理更多任务，而是让用户以更低的管理成本，更清晰地看到自己正在取得的进步。

**BranchTrace — Make Progress Visible.**

