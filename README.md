# 山地地质灾害隐患巡查与治理工作台

面向隐患点建档、坡体形变与裂缝观测、雨量预警发布、避险搬迁与治理工程验收的山区地质灾害防治工作台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 隐患点建档 | `hazard` | 隐患点 | 隐患编号、所在乡镇、灾害类型 |
| 边坡形变 | `slope` | 边坡观测点 | 测点编号、所属隐患点、监测方式 |
| 裂缝观测 | `crack` | 裂缝观测记录 | 裂缝编号、所属隐患点、裂缝走向 |
| 雨量站网 | `rain` | 雨量站 | 站号、站点名称、所属流域 |
| 预警发布 | `warning` | 预警信息 | 预警编号、发布对象、预警级别 |
| 群测群防巡查 | `patrol` | 巡查记录 | 巡查编号、所属隐患点、巡查人 |
| 避险搬迁 | `relocate` | 搬迁安置单 | 搬迁编号、所属隐患点、涉及户数 |
| 避险场所 | `refuge` | 避险场所 | 场所编号、场所名称、可容纳人数 |
| 应急演练 | `drill` | 应急演练 | 演练编号、演练主题、参演队伍 |
| 治理工程 | `project` | 治理工程 | 工程编号、所属隐患点、工程类型 |
| 削坡减载 | `cutting` | 削坡工序 | 工序编号、所属工程、削坡方量 |
| 支挡结构 | `wall` | 支挡结构 | 结构编号、所属工程、结构形式 |
| 排水系统 | `drainage` | 排水设施 | 排水编号、所属工程、排水形式 |
| 警示标识 | `signboard` | 警示标识 | 标识编号、所属隐患点、标识类别 |
| 险情上报 | `report` | 险情上报单 | 上报编号、所属隐患点、险情类别 |
| 专家会商 | `consult` | 专家会商 | 会商编号、会商主题、参会专家 |
| 隐患核销 | `clearance` | 核销单 | 核销编号、所属隐患点、核销依据 |
| 受威胁对象 | `threat` | 受威胁对象 | 对象编号、所属隐患点、对象类型 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 专家会商的提交结论与取消会商共用 `frontend/src/api/consult-flow.ts` 里的一份判定：
  状态逐段推进（待组织→已组织→已出结论，取消进已取消），跳级与重复评估一律拦下；
  字段校验的优先级（会商编号→主题与参会专家→建议措施→纪要归档日）写在该文件头部注释里。
  会商一出结论，应急演练清单会同步生成一条待核项。
- 想回到初始数据：清掉浏览器里 `geohazard-patrol:entries` 这一项，或调用 `resetModule(模块)`。
