# 开发注意事项（Development Notes）

面向维护者。使用者请看 [README.md](README.md)——那里只回答「能不能用、怎么调」：安装、上手三步与配置表。请求准入条件、跳过与只读时的行为、两处界面入口的交互差异、已知限制、实现内部细节与踩过的坑全部留在本文档。

README 是刻意精简的：上述四类内容曾经在 README 里，按要求移除后没有第二落点，发布指南「文档写作规范」对 README 内容的要求因此由本文档承担——**不要因为指南列了它们就把它们加回 README**。

本插件是**双半边**插件：`src/index.ts` 跑在宿主 Node 进程里，`src/client.ts` 是浏览器侧由 ModuleLoader 加载的普通脚本。两半边不能互相 `import`，所有跨半边的身份字符串都靠**逐字一致**维持（见实现要点 1）。

> 发布、验证、环境陷阱的权威文档是本工作区根目录的 `PLUGIN_RELEASE_GUIDE.md`。本文档只写本插件特有的内容，通用流程直接引它。

## 仓库结构

| 路径 | 说明 |
|---|---|
| `src/index.ts` | 宿主半边全部实现：设置 schema、`llm/stream` 路由跟踪、`fetch` 包装与请求改写 |
| `src/client.ts` | 浏览器半边：设置卡片 + 输入栏控件（纯脚本，无 `import`/`export`） |
| `lib/index.js` | 宿主编译产物，**必须提交**（路线 A） |
| `lib/client.js` | 浏览器编译产物，**必须提交** |
| `lib/types/index.d.ts` | 宿主类型声明，**必须提交** |
| `lib/types/client.d.ts` | 浏览器类型声明，**必须提交** |
| `test/index.test.mjs` | 宿主半边（9 项）：schema 归一化、请求改写、路由解析、fetch 包装与还原、模块契约 |
| `test/client.test.mjs` | 浏览器半边（11 项）：**真正执行** `lib/client.js`，含卡片挂载与未 ready 分支、session 默认模型 fallback 与无 session 分支 |
| `cordis.patch.yml` | profile 层插入声明（`- insert:` 形式） |
| `tsconfig.json` | 宿主半边配置（Node，无 DOM） |
| `tsconfig.client.json` | 浏览器半边配置（DOM，无 Node 类型） |
| `pnpm-lock.yaml` | 一并提交；`package.json` 的依赖声明改动会让它跟着变（见发布纪律） |

## 本地开发与构建

```powershell
pnpm install --no-frozen-lockfile
pnpm run typecheck   # 两份 tsconfig 都要过
pnpm run build       # src/index.ts → lib/index.js，src/client.ts → lib/client.js
pnpm test            # 先 build，再 node --test
```

**两份 tsconfig 不能合并。** 宿主半边 `lib: ["ES2022"]` + `types: ["node"]` 且不含 DOM；浏览器半边 `lib: ["ES2022", "DOM"]` + `types: []`。合并的代价是 `window` / `document` 会被当成宿主侧可用的全局量，而这类误用只会在运行时炸。

`pnpm test` 不是可选项：`tsc` 只做类型检查与转译，漂移检查只看 git 状态，**没有任何一步执行过产物**。测试直接 `import` 编译产物（`../lib/index.js` / `../lib/client.js`），所以「模块在 import 时抛错」不可能一路绿灯。`test` 脚本写作 `"pnpm run build && node --test"`，两点都不能省：`node --test` 不带参数才会递归发现全部测试文件，串上构建才能保证跑的是当前源码编译出的产物。

**改完 `src/` 必须重新 build 并提交 `lib/`**：

```powershell
pnpm run build
git status --porcelain   # 必须为空；有输出说明产物没跟上源码
```

## 开发挂载：让 DSH 加载你改的代码

用目录连接点把插件挂进 profile 的 `node_modules`，改完 build 再重启即可，不必每次重新安装：

```powershell
$dshHome = $env:DSH_HOME; if (-not $dshHome) { $dshHome = "$env:USERPROFILE\.dsh" }
$prof = "$dshHome\profiles\web"
[System.IO.Directory]::CreateDirectory("$prof\node_modules\@zhourenke") | Out-Null
New-Item -ItemType Junction -Path "$prof\node_modules\@zhourenke\dsh-reasoning-mode" -Target $PWD
```

核对连接点指向的就是本工作区（只看 `Junction` 不够，`Target` 也要对）：

```powershell
Get-Item "$prof\node_modules\@zhourenke\dsh-reasoning-mode" -Force | Select-Object LinkType, Target
```

**连接点会绕过 profile 里已提升的依赖**：Node 按 realpath 解析后沿工作区路径向上找 `node_modules`，所以插件目录里必须自己 `pnpm install` 一份，否则启动时报 `Cannot find package '@deepseek-ai/schemastery'`。

**改动生效方式分三档**：

| 改了什么 | 生效方式 |
|---|---|
| `src/index.ts`（宿主） | `pnpm run build` + **重启 DSH** |
| `src/client.ts`（浏览器） | `pnpm run build` + 重启 + **刷新页面**（bundle 在插件激活时被快照） |
| `~/.dsh/settings.yaml` 配置 | **热重载**，不需要重启也不需要刷新 |

## 配置落点

本插件的用户配置只有一个落点——`<harness home>/settings.yaml` 里的顶层键 `reasoning-mode`，由宿主半边 `ctx.settings.register(SETTINGS_NAMESPACE, Config)` 注册，卡片与输入栏控件都经设置服务读写它。

包内的 `cordis.patch.yml` 只负责把插件**插进 profile 层**，不带 `config`：

```yaml
- insert:
    - id: reasoning-mode          # 必须与 src/index.ts 导出的 name 一致
      name: '@zhourenke/dsh-reasoning-mode'
```

⚠️ **同一个文件名在 profile 目录下还有第二份**（`<profile>/cordis.patch.yml`），那份是用户的**覆盖**层，用 `- id: reasoning-mode` 直挂（**不带 `insert`**）；在那里写 `insert` 不会报错，而是静默追加第二个实例。README 里给用户看的片段是 `settings.yaml` 的 namespace，不涉及这个陷阱，但改 README 或排查「插件出现两次」时要记得两者的区别。

## 实现要点（为什么这样做）

### 1. 跨半边的身份字面量必须逐字一致

两半边没有共享模块，下面这些字符串是**协议**，改一处就必须改另一处：

| 字面量 | 宿主侧 | 浏览器侧 |
|---|---|---|
| 设置 namespace | `SETTINGS_NAMESPACE = 'reasoning-mode'` | `const NS = 'reasoning-mode'`（同时是 `settings.plugin.item` 的 `key` 与 `locale` 命名空间） |
| 路由键分隔符 | `routeKey()` 里的 `\u0000` | `keyOf()` 里的同一个字符 |
| 模式取值 | `'standard' \| 'pro'` | 同名联合类型 |
| 摘要取值 | `'auto' \| 'concise' \| 'detailed'` | 同名联合类型 |
| 亲和头 | `x-client-request-id` → `session_id` | （不由浏览器侧读取） |

`\u0000` 而不是 `:` 或 `/`：model id 里可以出现任何可见分隔符，`provider/model` 这种拼法会在含 `/` 的 id 上撞键。

### 2. 宿主 `inject` 只列真正读取的服务

`export const inject = ['settings']`。事件订阅**不经过服务**：监听 `llm/stream` 不需要 inject `llm`，官方 `dsh-repeat-tool-reminder` 一个宿主 inject 都不声明也在同一个事件上监听。多列一个名字的代价是插件永远等不到那个服务就绪（缺一个就永不激活），这是最容易写错又最难察觉的一类。

### 3. 模块增强导入不能删

```ts
import type {} from '@deepseek-ai/dsh-llm'       // 载入 Events['llm/stream']
import type {} from '@deepseek-ai/dsh-settings'  // 载入 Context.settings
```

删掉任意一条，`ctx.on('llm/stream', …)` 或 `ctx.settings` 会在完全无关的位置报类型错误。它们是 `import type {}`，不产生运行时依赖，所以既不能删，也不进 `dependencies`；对应包按宿主提供的包放进 `peerDependencies`。

### 4. 请求准入有五道守卫，任何一道不过就原样转发

```
POST + 路径以 /responses 结尾
→ content-encoding 缺省或 identity（压缩体不解析）
→ content-type 缺省或含 json
→ 请求体是 JSON 对象且带字符串 model
→ 路由可确定且该路由有勾选
```

包装器**先解析后决定**：只要中间任何一步抛错或拿不到值，都走 `original.call(this, input, init)` 而不是半途重建请求。宁可放过，不可改坏。

### 5. 路由解析靠 `llm/stream` 注册 + 会话亲和

`fetch` 那一层只看得到 URL、header 和 body，看不到「这次请求属于哪个 provider」。所以宿主在 `llm/stream` 上把 `{ sessionId, provider, model }` 注册进 `createRequestTracker()`，流结束（含异常与提前退出）时用 `finally` 注销：

```ts
return (async function* () {
  try { for await (const chunk of stream) yield chunk } finally { remove() }
})()
```

改写时用 `x-client-request-id`（回退 `session_id`）从 body 里取回会话归属，再按 `model` 过滤候选。**只在会话内过滤是不够的**：同一会话里连续两步可能换过模型，所以 model 与 sessionId 两个条件都要用。

### 6. 歧义时不猜，并且只报一次

只有在**拿不到会话归属**且同一 model 对应多个不同 provider 时才判歧义（`ambiguousWithoutAffinity`），此时跳过改写并打一条 warn。日志按 `model + 候选集合` 去重（`reportedAmbiguities`），否则每个请求刷一行。

### 7. fetch 包装必须幂等且可还原

`globalThis.fetch` 是全局单例，插件重载可能装第二次。用 `Symbol.for('deepseek-harness.reasoning-mode.fetch-state')` 记住当前包装器：安装前先 `previous?.restore()`，并把自己写进 `host[FETCH_STATE_KEY]`；`ctx.effect(() => installFetchWrapper(...))` 的返回值就是还原函数，插件卸载时把 `fetch` 换回原函数（且只在「当前还是我」时才换）。

### 8. Request 重建：保留选项，丢掉过期的 content-length

`new Request(input, { ...inheritedRequestInit(request), ...init, headers, body })`：`cache`/`credentials`/`integrity`/`keepalive`/`mode`/`redirect`/`referrer`/`referrerPolicy`/`signal`/`duplex`/`priority` 等逐项继承，header 合并 input 与 init 后**删掉 `content-length`**（body 长度已变，留着会被运行时拒绝或截断）。`Request` 构造器不存在、或构造抛错时返回 `undefined`，调用方回退原请求。

### 9. `applyReasoningBody` 只写两个字段

```ts
{ ...body, reasoning: { ...existing, mode, summary } }
```

`reasoning` 下的其它键（例如 adapter 设的 `effort`）原样保留；body 顶层其它键也一个不动。插件不拥有 `reasoning` 对象，只拥有其中两个字段。

**与 DSH 自带 `reasoningEffort` 的区别（写文档时最容易混的一处）**：DSH 的 LLM 层有自己的推理档位概念——`GenerateOptions.reasoningEffort` / `LlmModelReasoningInfo`，由 adapter 声明每个模型有哪些档位（`@deepseek-ai/dsh-llm` 的 `types.d.ts`）。那是 **DSH 侧的调用参数**，由 DSH 的模型选择器与 adapter 决定怎么落到请求体里；本插件不读也不写它，只在最终 `fetch` 边界上补 Responses 的 `reasoning.mode` / `reasoning.summary`。两者会同时出现在同一个请求体里，互不覆盖（插件只改自己那两个键）。README 面向使用者时要把这条说清楚，否则「我已经有推理档位了，为什么还要这个插件」会成为第一个疑问。

### 10. 设置 schema 的 transform 必须自包含

`Config` 是 `z.transform(..., callback, true)`，而 Settings 会把 `callback` **序列化成字符串**、在浏览器里重新水合执行（`Config.toJSON()` 里能看到）。所以回调里**不能引用任何模块级 helper**（`normalizeModels` 之类），所有逻辑必须写在回调内部；`test/index.test.mjs` 用 `new Function` 复现了这条水合路径，删掉自包含性会当场失败。

回调同时做三件事：丢弃非字符串/空的 `provider`/`model`、按精确键去重、把缺失或非法的 `mode`/`summary` 归一化成 `standard`/`auto`。旧版本写进 `settings.yaml` 的 `defaultMode`/`defaultSummary` 等字段在这里被静默丢弃。

### 11. 客户端卡片是三态：draft / saved / effective

- `draftModels`：卡片正在编辑的**暂存**集合（初始为快照的副本）。
- `savedModels`：当前快照的集合（每次渲染重新 `copyModels`）。
- `selected`：`draftModels` 的键集合，决定复选框勾选状态。

点**保存**才 `scope.set('models', draftModels)`；点**放弃更改**把 draft 重置回 saved。宿主推送新快照时，只有**不脏**（`!dirty`）才覆盖 draft——否则用户正在编辑的内容会被外部更新冲掉。

### 12. 「不可用」分组必须基于 effective 而不是 draft

```ts
const effective = new Map(saved ∪ draft)   // 见 src/client.ts 的 Keep saved routes… 注释
```

取消勾选时条目仍留在 `effective` 里，所以它继续显示在目录位置（而不是掉进「已保存但当前不可用」），直到保存真正把它移除。若改用 draft 计算，取消勾选的瞬间条目会跳到不可用分组，看起来像「已删除」，与 Subagent 卡片的行为不一致。

### 13. 勾选新路由写死 `standard`/`auto`；重勾保留原值

`toggle()` 添加条目时用 `savedByKey.get(key) ?? { …, mode: 'standard', summary: 'auto' }`：目录里从没出现过的路由使用硬编码默认值，而**曾经保存过**的路由从 `savedModels` 取回原值。设置界面因此不需要「新增模型默认值」这类配置项——用户明确要求过不要它。

### 14. 输入栏控件按当前 session 路由出现；新 session 用目录默认值兜底

控件从官方 session 标准源拿到 `sessionId`，再通过 `props.useProjection('modelSelection')` 取 `next ?? lastUsed`。已有 projection 路由始终优先；新 session 如果 projection 还是 `{ next: null, lastUsed: null }`，就调用插件已注入的 `remote.session.modelCatalog()`，用目录的 `default` 作为临时当前路由。只有这个路由已经在 `models` 里勾选时控件才渲染；目录请求完成前仍然返回 `null`。选中菜单项直接 `scope.set('models', next)`（没有暂存态、没有保存按钮），所以它和卡片的交互模型不同，不要试图统一。

没有 `sessionId` 时代表当前还没有可寻址的 session（通常是未选择工作区的空 composer）：控件直接返回 `null`，**不请求模型目录**。这条分支不能用"目录默认值"硬凑出一个路由，否则会把没有目标 session 的 UI 状态误显示成可配置路由。

### 15. 菜单几何照抄官方

`conversation.input.right` 槽里的控件按官方嵌套菜单写：根面板两行 `rm-menu-cell`（左侧标签、右侧当前值、行尾 chevron），子面板若干 `rm-menu-option`（选中项右侧打勾）。关键尺寸：cell `height: 40px`、option `min-height: 38px`、菜单圆角 `20px`、`--dsw-elevation-prominent`、`z-index: 1100`。**没有标题行，也没有返回行**——用户明确要求过与官方一致，子面板靠 Escape / 点击外部回到根面板。

### 16. 文案只有一个落点，README 是第二落点

所有用户可见文案在 `src/client.ts` 的 `zh` / `en` 字典里，经 `locale.register(NS, { zh, en })` 注册；宿主警告是英文（进日志）。改文案时记得 README(zh/en) 里的对应描述也要跟着改——两处不会自动同步。README 里出现的界面用语（如「已保存但当前不可用」「保存」）必须与字典逐字一致。

## 客户端半边的降级状态

用户侧的护栏原先写在 README 里，现在集中在这里（文案与 `src/client.ts` 的 `zh`/`en` 字典逐字对应）：

| 状态 | 判据 | 卡片 | 输入栏控件 |
|---|---|---|---|
| 快照未就绪 | `settingsScope` 快照拿不到值 | 返回 `null`，不产出任何元素 | 不渲染 |
| 只读 | `snapshot.writable === false` | 顶部显示「设置当前为只读。」，保存按钮禁用 | **不做只读判断**：菜单照常可点，`scope.set` 被拒后由 `.catch(() => {})` 静默吞掉 |
| 目录加载失败 | `catalogError !== null` | 显示「模型目录加载失败；已保存的选择不会被自动删除。」+ 具体错误 + **重试** | 已有 projection 路由照常显示；新 session 没有目录默认路由时不渲染 |
| 目录为空 | `catalog.length === 0` 且 `effective.size === 0` | 显示「当前没有可用的模型目录。」 | 已有 projection 路由照常显示；新 session 没有目录默认路由时不渲染 |
| 目录加载中 | `catalog === null` 且无错误 | 显示「正在加载模型目录…」 | 新 session 在目录默认路由返回前不渲染；已有 projection 路由不依赖目录，照常显示 |
| 没有可寻址 session | `props.sessionId === undefined` | 不适用 | 不渲染，也不请求目录 |
| 有未保存改动 | `dirty` | 标题旁显示「未保存」，保存可点 | 不适用（控件即时写盘） |
| 保存失败 | 写盘 promise 被拒 | 显示「保存失败，请重试。」 | 写盘被拒时静默 |

两处有意的不对称，改代码前先想清楚再动：

- **只读时控件仍可点**：卡片会拦住保存，控件不会。界面在只读档下本来就少见，付出的是「点了没反应」的观感；要改就在 `update()` 前面加 `writable` 判断并给出与卡片一致的提示，而不是让菜单整个消失。
- **控件写盘失败静默**：`.catch(() => {})` 只保证 `busy` 复位，没有错误提示。它的写入是「选中即生效」的乐观交互，失败时用户看到的是菜单选了但值没变（订阅会推回旧值）。

## 测试要点

| 文件 | 覆盖 |
|---|---|
| `test/index.test.mjs` | `Config.toJSON()` 的水合与归一化（含旧字段丢弃）、`applyReasoningBody` 保留其它字段、`isResponsesRequest`、`resolveRouteCandidate` 的歧义规则、`apply()` 装 fetch 包装并在卸载后还原、原生 `Request` 体重建与 `content-length` 移除、并发同 model 路由的亲和选择、stream 结束后的还原、模块契约（`name`/`inject`/`apply`） |
| `test/client.test.mjs` | 槽注册与 `inject` 面、官方菜单结构（静态断言源码与产物）、models-only 契约（无 `defaultMode`/`defaultSummary`/`scope.mutate`/`<select>`）、**挂载一次卡片并断言注入面被转交**、未 ready 时返回 `null` 且不产出元素、**新 session 使用目录默认路由、无 session 不请求目录**、样式只注入一次、缺服务时 apply 惰性、与兄弟插件 bundle 可拼接 |

两条纪律：

- **mock 必须来自实测的宿主契约。** `test/client.test.mjs` 顶部的注释块记录了槽所有者、注册形状、`settingsScope` 快照字段的来源（对应包与文件），改 mock 前先回去读那些声明。
- **断言「注入面被转交」，而不只是断言 `inject()` 返回了什么。** 官方槽的 owner props 是空的（`children?: never`），卡片唯一的输入就是 `inject()` 面，所以测试要真的调用一次 `render({})` 并用返回的 props 执行卡片组件。

## 发布纪律

按 `PLUGIN_RELEASE_GUIDE.md`「提交前验证清单」跑，本插件相关的判据：

```powershell
pnpm install --no-frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm test
git status --porcelain            # 构建后必须为空

git ls-files cordis.patch.yml lib/index.js lib/types/index.d.ts lib/client.js lib/types/client.d.ts

# 载荷：8 个文件（README.md 与 README.en.md 都由 README* 自动包含）
pnpm pack --dry-run
```

- **`files` 只列必须发布的产物**：`lib/index.js`、`lib/client.js`、`lib/types/**/*.d.ts`、`cordis.patch.yml`。`README.md`、`README.en.md`、`package.json` 属于自动包含集，列进去是空操作条目；`DEVELOPMENT.md` **两边都不沾**（既不被 `files` 匹配，也不在自动包含集），所以它只留在仓库里，不进安装载荷——README 里因此不要链接它（对载荷读者是死链）。
- **改了 README 就要同步另一份，并做结构对账**：`README.md`（中文）与 `README.en.md`（英文）的章节数、表格数与表头列数必须 1:1，命令里的包名与路径逐字一致；再扫一遍兄弟插件的专有名词（`<summary>` 标签、`reasoning-summary`、注入上下文提示等），它们会在照搬结构时被一起搬进来。

```powershell
# 结构对账：两份的 h2 数、表格行数、代码围栏数必须相等
foreach ($f in 'README.md','README.en.md') {
  $l = Get-Content $f -Encoding utf8
  "{0,-16} h2={1} table-rows={2} fences={3}" -f $f,
    @($l | Where-Object { $_ -match '^## ' }).Count,
    @($l | Where-Object { $_ -match '^\|' }).Count,
    @($l | Where-Object { $_ -match '^```' }).Count
}
```
- **载荷断言要看全部行**，不要按前缀过滤（`README.md`、`package.json`、`LICENSE` 与 `lib/` 不共享前缀，过滤会把判断「多一个」的依据滤掉）。
- **产物与源码同一个提交**；只改 `src/` 不提交 `lib/` 会让从 git 安装的人跑到旧代码。
- 提交信息用 `-F <文件>` 写（本环境 `git commit -m` 里的反斜杠、引号、`$` 会被 PowerShell 改写）。

## 已知陷阱（本仓库踩过的）

- **正则做「旧字段残留」扫描时要加词边界**：`/draftMode/` 会命中 `draftModels`，把正确的代码判成残留。当前用的是 `\bdefaultMode\b|…|\bdraftMode\b|…`。
- **`pnpm pack --dry-run --json` 退出 1 且没有输出**（pnpm 的 `pack` 不认 `--json`）；要机器可读结果用 `npm pack --dry-run --json`，两者对同一份 `files` 点出的文件集相同。
- **`npm pack` 认 cwd 不认 `--prefix`**：检查另一个目录要先 `Push-Location` 过去。
- **本环境的 PowerShell 是 5.1**：没有 `&&`、三元、`??`；`Get-Content` 对无 BOM 的 UTF-8 默认按 ANSI 解码（连行数都会少），读文件一律带 `-Encoding utf8`；`Set-Content -Encoding UTF8` 在本环境**会写入 BOM**，需要无 BOM 的 UTF-8 时用 `[System.IO.File]::WriteAllText`。
- **成功命令也会吐像错误的 stderr**：`pnpm run typecheck` 把脚本行打到 stderr，PowerShell 会包装成 `NativeCommandError`；判据是退出码，不是这段输出。
- **`git diff` 的 LF→CRLF 警告是正常的**，`git diff --check` 才是判空白的。

## 与工作区其它插件的关系

- **只读约束**：`dsh-reasoning-summary` 与 `dsh-reasoning-level` 不是本插件的代码。前者是设置卡片与菜单结构的参考实现，后者是运行中的第三方插件——**不要改动它们的源码或安装副本**。
- 本插件与 `dsh-reasoning-summary` 同时启用没有冲突：两者动作在不同层（本插件改 Responses 请求体的 `reasoning` 字段，对方管会话消息注入），`test/client.test.mjs` 里有一条把两个 bundle 拼在一起求值的回归测试，防止模块级标识符互相污染。
- 用户主目录的 `~/.dsh/settings.yaml` 是**用户资产**：调试时只读、只哈希核对，不要用工具写它；验证配置行为请走设置服务或临时 profile。

## 运行时依赖与版本

| 包 | 角色 | 声明位置 |
|---|---|---|
| `@deepseek-ai/schemastery` | 唯一被真正 import 的值依赖（`z`） | `dependencies` |
| `@deepseek-ai/cordis` | 上下文与插件框架（`Context` 类型） | `peerDependencies`（optional） |
| `@deepseek-ai/dsh-settings` | `ctx.settings` 增强 + 设置注册 | `peerDependencies`（optional） |
| `@deepseek-ai/dsh-llm` | `llm/stream` 事件名增强 | `peerDependencies`（optional） |
| `typescript`、`@types/node` | 工具链 | `devDependencies` |

宿主包在 `devDependencies` 里**钉死到 `0.1.5-rc.1`**（`cordis` 钉 `4.0.2`）：连接点安装时插件解析到的是自己 `node_modules` 里的副本，写范围会让人对着与线上不同的宿主做类型检查。基线版本：**DSH v0.1.5-rc.1**，Node 25.8.1，pnpm 11.21.0。

## 许可证

MIT
