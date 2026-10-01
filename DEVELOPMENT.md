# 开发注意事项（Development Notes）

面向维护者。使用者请看 [README.md](README.md)——那里只回答「能不能用、怎么调」：安装、上手三步与配置表。请求准入条件、跳过与只读时的行为、两处界面入口的交互差异、已知限制、实现内部细节与踩过的坑全部留在本文档。

README 是刻意精简的：上述四类内容曾经在 README 里，按要求移除后没有第二落点，发布指南「文档写作规范」对 README 内容的要求因此由本文档承担——**不要因为指南列了它们就把它们加回 README**。

本插件是**双半边**插件：`src/index.ts` 跑在宿主 Node 进程里，`src/client.ts` 是浏览器侧由 ModuleLoader 加载的普通脚本。两半边不能互相 `import`，所有跨半边的身份字符串都靠**逐字一致**维持（见实现要点 1）。

> 发布、验证、环境陷阱的权威文档是本工作区根目录的 `PLUGIN_RELEASE_GUIDE.md`。本文档只写本插件特有的内容，通用流程直接引它。

## 仓库结构

| 路径 | 说明 |
|---|---|
| `src/index.ts` | 宿主半边全部实现：设置 schema、`llm/stream` 路由跟踪、`fetch` 包装与请求改写 |
| `src/client.ts` | 浏览器半边：配置页（`plugins.row.config`）+ 输入栏控件（纯脚本，无 `import`/`export`） |
| `lib/index.js` | 宿主编译产物，**必须提交**（路线 A） |
| `lib/client.js` | 浏览器编译产物，**必须提交** |
| `lib/types/index.d.ts` | 宿主类型声明，**必须提交** |
| `lib/types/client.d.ts` | 浏览器类型声明，**必须提交** |
| `test/index.test.mjs` | 宿主半边（11 项）：schema 归一化、请求改写、路由解析、fetch 包装与还原、模块契约、清单契约（显示元数据） |
| `test/client.test.mjs` | 浏览器半边（16 项）：**真正执行** `lib/client.js`，含配置页挂载、摘要视图、带修订号的写入、未 ready / 无 form 分支、session 默认模型 fallback 与无 session 分支 |
| `cordis.patch.yml` | profile 层插入声明（`- insert:` 形式） |
| `icon.svg` | 插件列表的图标：顶层 `icon` 指向它，宿主直接读成内联 data URL（不经过代码） |
| `locale/en.json`、`locale/zh.json` | 插件列表的显示名与说明（`{"meta":{"title","description"}}`，**文件名即语言 id**）；同样是宿主直接读盘（见 §18） |
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
| `<profile>/cordis.patch.yml` 的 `config`（设置界面的写入目标） | **热重载**，不需要重启也不需要刷新 |

## 配置落点

本插件的用户配置只有一个落点——**profile 补丁层里 `reasoning-mode` 那一行的 `config`**，也就是 `~/.dsh/profiles/<profile>/cordis.patch.yml` 中：

```yaml
- id: reasoning-mode
  name: '@zhourenke/dsh-reasoning-mode'
  config:
    models: [...]
```

0.1.7 起 DSH 的设置界面不再有独立的 `settings.yaml`：每个插件的设置**就是这个 profile 条目自己的 `config`**，宿主侧由 loader 直接作为 `apply(ctx, config)` 的第二个参数交进来，浏览器侧经 `ctx.configForms` 读写同一个条目。因此：

- 宿主半边**不再注册任何设置**（没有 `ctx.settings.register`），只是声明 `Config` schema 并从 `config` 读；
- 设置界面的写入目标就是 profile 补丁层，而补丁层是 `patchReload: live`，所以**配置改动不需要重启**；
- 设置界面只能写 **volatile 字段**（见第 10 条）——写成非 volatile 会导致保存时抛错。

包内的 `cordis.patch.yml` 只负责把插件**插进 profile 层**，不带 `config`：

```yaml
- insert:
    - id: reasoning-mode          # 同时是设置条目的 id：浏览器侧 `configForms.get('reasoning-mode')` 按它取用
      name: '@zhourenke/dsh-reasoning-mode'
```

⚠️ **同一个文件名在 profile 目录下还有第二份**（`<profile>/cordis.patch.yml`），那份是用户的**覆盖**层，用 `- id: reasoning-mode` 直挂（**不带 `insert`**）；在那里写 `insert` 不会报错，而是静默追加第二个实例。README 里给用户看的片段正是这一层，所以这两份文件的区别必须一直记住。

**`id` 有三个消费者，改一处必须改全部**：profile 补丁层里作为覆盖锚点、`configForms` 里作为 namespace、`plugins.row.config` 里作为 `<包名>#<行 id>` 的后半段。`name` 导出与包内 patch 的 `id` 保持一致是为了诊断可读，不是协议。

## 实现要点（为什么这样做）

### 1. 跨半边的身份字面量必须逐字一致

两半边没有共享模块，下面这些字符串是**协议**，改一处就必须改另一处：

| 字面量 | 宿主侧 | 浏览器侧 |
|---|---|---|
| 配置条目 id | 包内 `cordis.patch.yml` 的 `id: reasoning-mode` | `const NS = 'reasoning-mode'`（同时是 `configForms` 的 namespace、`plugins.row.config` 的 `<包名>#<id>` 后半段与 `locale` 命名空间） |
| 路由键分隔符 | `routeKey()` 里的 `\u0000` | `keyOf()` 里的同一个字符 |
| 模式取值 | `'standard' \| 'pro'` | 同名联合类型 |
| 摘要取值 | `'auto' \| 'concise' \| 'detailed'` | 同名联合类型 |
| 亲和头 | `x-client-request-id` → `session_id` | （不由浏览器侧读取） |

`\u0000` 而不是 `:` 或 `/`：model id 里可以出现任何可见分隔符，`provider/model` 这种拼法会在含 `/` 的 id 上撞键。

### 2. 宿主 `inject` 只列真正读取的服务

`export const inject = []`。宿主半边**一个服务都不读**：它只订阅 `llm/stream`、包装 `ctx.fetch`，两者都不经过服务。事件订阅**不经过服务**：监听 `llm/stream` 不需要 inject `llm`，官方 `dsh-repeat-tool-reminder` 一个宿主 inject 都不声明也在同一个事件上监听。多列一个名字的代价是插件永远等不到那个服务就绪（缺一个就永不激活），这是最容易写错又最难察觉的一类。`ctx.fetch` 是 context 上的能力而不是服务，同样不列入。

### 3. 模块增强导入不能删

```ts
import type {} from '@deepseek-ai/dsh-llm'   // 载入 Events['llm/stream']
```

删掉这条，`ctx.on('llm/stream', …)` 会在完全无关的位置报类型错误。它是 `import type {}`，不产生运行时依赖，所以既不能删，也不进 `dependencies`；对应包按宿主提供的包放进 `peerDependencies`。浏览器半边是纯工厂脚本（只有 `interface Window` 与 `require`），没有 `import`，也就没有增强导入。

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

改写时用会话亲和头取回会话归属，再按 `model` 过滤候选。**头名按格式有两个**：pi-ai 的 `openai-responses.js` 在非 OpenRouter 格式下同时发 `session_id` 与 `x-client-request-id`，OpenRouter 格式只发 `x-session-id`（三个都接受，源码里的回退顺序如实现）。宿主确实把 `sessionId` 交给了 pi-ai（`dsh-llm-pi-ai/lib/index.js`：`...options.sessionId === void 0 ? {} : { sessionId: String(options.sessionId) }`），所以真实 DSH 流量里亲和头是**在的**——`ambiguousWithoutAffinity` 基本只会出现在没有亲和头的调用方（非 DSH 调用、或另行抑制了该头）。**只在会话内过滤是不够的**：同一会话里连续两步可能换过模型，所以 model 与 sessionId 两个条件都要用。

### 6. 歧义时不猜，并且只报一次

只有在**拿不到会话归属**且同一 model 对应多个不同 provider 时才判歧义（`ambiguousWithoutAffinity`），此时跳过改写并打一条 warn。日志按 `model + 候选集合` 去重（`reportedAmbiguities`），否则每个请求刷一行。亲和头存在但对不上任何在飞请求时，结果同样是「没有唯一候选」→不改写，但走的是**静默**分支（对不上不是身份歧义，没有可解释的内容可报）。

### 7. fetch 包装必须幂等且可还原

`globalThis.fetch` 是全局单例，插件重载可能装第二次。用 `Symbol.for('deepseek-harness.reasoning-mode.fetch-state')` 记住当前包装器：安装前先 `previous?.restore()`，并把自己写进 `host[FETCH_STATE_KEY]`；`ctx.effect(() => installFetchWrapper(...))` 的返回值就是还原函数，插件卸载时把 `fetch` 换回原函数（且只在「当前还是我」时才换）。

### 8. Request 重建：保留选项，丢掉过期的 content-length

`new Request(input, { ...inheritedRequestInit(request), ...init, headers, body })`：`cache`/`credentials`/`integrity`/`keepalive`/`mode`/`redirect`/`referrer`/`referrerPolicy`/`signal`/`duplex`/`priority` 等逐项继承，header 合并 input 与 init 后**删掉 `content-length`**（body 长度已变，留着会被运行时拒绝或截断）。`Request` 构造器不存在、或构造抛错时返回 `undefined`，调用方回退原请求。

### 9. `applyReasoningBody` 只写两个字段

```ts
{ ...body, reasoning: { ...existing, mode, summary } }
```

`reasoning` 下的其它键（例如 adapter 设的 `effort`）原样保留；body 顶层其它键也一个不动。插件不拥有 `reasoning` 对象，只拥有其中两个字段。

**也不判断模型支不支持推理**（用户实测的预期行为）：勾选了不接受 `reasoning` 的模型时，上游直接返回「不支持该参数」的报错。预筛需要在插件里复刻一份模型能力表（还要跟上目录变化），而报错本身已经精确指向那条路由——所以这里刻意不筛，把它当配置错误暴露出来。

**与 DSH 自带 `reasoningEffort` 的区别（写文档时最容易混的一处）**：DSH 的 LLM 层有自己的推理档位概念——`GenerateOptions.reasoningEffort` / `LlmModelReasoningInfo`，由 adapter 声明每个模型有哪些档位（`@deepseek-ai/dsh-llm` 的 `types.d.ts`）。那是 **DSH 侧的调用参数**，由 DSH 的模型选择器与 adapter 决定怎么落到请求体里；本插件不读也不写它，只在最终 `fetch` 边界上补 Responses 的 `reasoning.mode` / `reasoning.summary`。两者会同时出现在同一个请求体里，互不覆盖（插件只改自己那两个键）。README 面向使用者时要把这条说清楚，否则「我已经有推理档位了，为什么还要这个插件」会成为第一个疑问。

### 10. `models` 必须声明为 volatile，否则设置界面根本写不进去

```ts
export const Config = z.object({
  models: z.array(ModelSettingsSchema).default([]).volatile(),
}) as unknown as ReturnType<typeof z.any>
```

两个作用，缺一不可：

1. **让 loader 传进来的是一把「活的值」而不是快照。** `apply(ctx, config)` 拿到的是 `Volatile<ModelSettings[]>`（`{ get(): VolatileSnapshot<T> }`），loader 在设置写入后**就地更新**同一个引用，不重新 `apply`。所以宿主半边每次请求都 `config.models.get()`，而不是在 `apply` 时把列表抄进闭包——抄进去的写法在设置页保存后不会生效（而且不会有任何报错）。
2. **它是设置界面的写入许可。** 宿主侧的写路径（`dsh-settings` 的 `write(ns, …)`）先取 `volatileForm(schema)`，再对每个 path 检查 `isVolatilePath`：**schema 里没有 volatile 字段就抛 `Plugin entry "X" has no volatile fields`，写了非 volatile 的 path 就抛 `Config field "models" is not volatile`**。所以「配置页保存报错」的第一嫌疑不是表单，而是 schema 少写了 `.volatile()`。

`Config` 用 `as unknown as ReturnType<typeof z.any>` 是给 `apply` 的第二个参数一个可写的推导类型（官方插件同样这么写）；`Config.toJSON()` 里 volatile 记在字段自己的 ref 上：`{ type: 'array', meta: { default: [], volatile: true }, inner: … }`，`test/index.test.mjs` 按这个形状断言，删掉 `.volatile()` 会当场失败。

### 11. 归一化在读取时做，不再塞进 schema transform

0.1.7 的设置值不再被序列化到浏览器里水合执行，所以**没有「transform 必须自包含」这条约束**了。归一化搬到 `normalizeModels(value)`，由宿主半边在每次读取时调用（`settingsByRoute(normalizeModels(config.models.get()))`）：丢弃非字符串/空的 `provider`/`model`、按精确路由键去重、把缺失或非法的 `mode`/`summary` 归一化成 `standard`/`auto`。它现在是**普通导出函数**，测试可以直接调用，不必再用 `new Function` 复现水合路径；schema 只声明形状与默认值。

### 12. 配置页是官方表单的一个「字段组」，不是自绘卡片

`plugins.row.config` 的 owner（插件页）把 entry 渲染两次，并**只**传 `view` 与 `form`：

- `view: 'summary'`：行的单行说明，也是该行没有 description 时的兜底；本插件返回 `t('description')` 一行文本，**不读模型目录**（每行都发一次目录请求就浪费了）。
- `view: 'page'`：`form` 是宿主给的 `ConfigPageForm = { state, mutate }`。页面用 `state.value` 作为「已保存值」、`state.revision` 作为写入栅栏、`state.writable` 决定可编辑性，提交时一次 `mutate([{ op: 'set', path: ['models'], value: draftModels }], revision)`（返回布尔：是否被接受）。

**框架、保存按钮与失败提示都归官方 `SettingsForm`**（`dsh-client-ui-primitives`），本插件只传 labels 与 shell state（`available/writable/dirty/invalid/saving/failed`），把控件作为 children 交进去。自绘卡片头、展开/收起、`.rm-card` 那一套已经删除——那是重复造轮子，而且与官方页面的标题/面包屑/保存条冲突。

`draft / saved` 两个集合仍然保留：`draftModels` 是页面正在编辑的暂存集合（初始为 `form.state.value` 的副本），`savedModels` 每次渲染从 `form.state.value` 重算；只有**不脏**（`!dirty`）时外部更新才覆盖 draft，否则用户正在编辑的内容会被冲掉。

**座位选择的实测依据**（0.1.7 首测、0.2.0-rc.2 复核：整张客户端座位表以数据形式内置在 `dsh-cordis-client-runner/lib/client.js` 里，可直接读）：

- `plugins.row.config` 这条记录：`kind: 'keyed'`、`registerOptions` 只有 `key`（required）、**`occupants: []`、`keyDomain: "open: … none are taken yet"`**——这个座位目前没人占（0.2.0 复核逐字未变）。
- `plugins.item` 的 `occupants` 已被官方伴随包占满、`keyDomain` 为空串，文档也写明它 "OCCUPIED by the official settings pages, one companion package per host-plane namespace"。**它仍然可用**（`formFor(item.id)` 与行页面是同一套机制），代价是把本插件的卡片塞进官方分组、与官方伴随包并列。0.2.0 的文档把这条结论写死了：*"a bundle's configuration belongs in `plugins.bundle.config` or `plugins.row.config` instead."*
- **0.2.0 新增 `plugins.bundle.config`**（`kind: 'keyed'`，按**包名**为键、渲染在 bundle 页面的描述与行列表之间、只有 `view: 'page'`）：它服务的是 bundle **自己**的配置。本插件的配置是**行条目的配置**（包内 patch 那行的 `config`，loader 直接交给 `apply(ctx, config)`），所以继续用 `plugins.row.config`——不要因为它存在就搬过去。
- 键的格式由官方构造函数 `rowConfigKey(bundle, rowId)` = `` `${bundle}#${rowId}` `` 决定（`bundle` 是包名，`rowId` 是包内 patch 声明的行 id），页面侧用它建 key、`configForm(rowId)` 取表单。
- **`form` 只在 `configForms.describe().namespaces` 里存在 `ns === 行 id` 时才有值**（`formFor(rowId)` 的第一行就是这个判断），所以「行 id = 条目 id = `configForms` namespace」三者必须一致——本插件三者都是 `reasoning-mode`。
- 注册选项里的 `locale` **就是**props 上 `t` 的来源：渲染器对每个 entry 读出它的 `locale`，再拼 kit（`dsh-client-ui-renderer/lib/client.js`：`if (entry.locale !== void 0) { … kit["t"] = localeSeat(face, entry.locale) }`），而 `localeSeat(face, ns)` 就是 `face.bind(ns)` 按 locale revision 缓存的包装（`locale` 服务的文档也写明两者"同一 key domain"）。**locale face 缺失时渲染器直接抛 `SlotAssemblyError`**，所以不存在"座位可能没给 `t`"这种情况——本插件因此**不再自己 `locale.bind(NS)`**（那会遮盖同一个 prop 的同名值），两个座位各自声明 `locale: NS`、组件直接读 `props.t`。`test/client.test.mjs` 的桩按渲染器的规则拼 kit（声明了 `locale` 才给 `t`），并有一条断言钉住"源码里不许出现 `locale.bind`"。
- 给座位加**别的** props 还有一条路：注册选项 `inject`（`register({ name, inject: () => ({ … }) }, Component)`，渲染器 `runInject` 会把返回值并进 kit，官方 `dsh-client-ui-directory-picker-browse` 就这么传 `listDirectory` 与 `t`）。**本插件不用它**：座位数据集里 `inject` 没有被声明成注册选项（我们两个座位的 `registerOptions` 只有 `id`/`order`/`label` 与 `key`），它的入参还随座位种类变化（keyed 传键、chain 传 actions），而这些 props 是本插件自己的闭包、不是官方已提供的能力——用 `{ …props, sessionFace }` 展开是同一件事的更简形式。
- `slots.inject(slot, () => slots.register({…}, render))` 这个嵌套写法就是官方数据集里给出的范例，其返回值即 `whileServed` 需要的 disposer。

### 13. 「不可用」分组必须基于 effective 而不是 draft

```ts
const effective = new Map(saved ∪ draft)   // 见 src/client.ts 的 Keep saved routes… 注释
```

取消勾选时条目仍留在 `effective` 里，所以它继续显示在目录位置（而不是掉进「已保存但当前不可用」），直到保存真正把它移除。若改用 draft 计算，取消勾选的瞬间条目会跳到不可用分组，看起来像「已删除」，与官方同类配置页的行为不一致。

### 14. 勾选新路由写死 `standard`/`auto`；重勾保留原值

`toggle()` 添加条目时用 `savedByKey.get(key) ?? { …, mode: 'standard', summary: 'auto' }`：目录里从没出现过的路由使用硬编码默认值，而**曾经保存过**的路由从 `savedModels` 取回原值。设置界面因此不需要「新增模型默认值」这类配置项——用户明确要求过不要它。

### 15. 输入栏控件按当前 session 路由出现；新 session 用目录默认值兜底

控件从官方 session 标准源拿到 `sessionId`，再通过 `props.useProjection('modelSelection')` 取 `next ?? lastUsed`。已有 projection 路由始终优先；新 session 如果 projection 还是 `{ next: null, lastUsed: null }`，就调用插件已注入的 `remote.session.modelCatalog()`，用目录的 `default` 作为临时当前路由。只有这个路由已经在 `models` 里勾选时控件才渲染；目录请求完成前仍然返回 `null`。选中菜单项直接 `scope.set('models', next)`（没有暂存态、没有保存按钮），所以它和配置页的交互模型不同，不要试图统一。

没有 `sessionId` 时代表当前还没有可寻址的 session（通常是未选择工作区的空 composer）：控件直接返回 `null`，**不请求模型目录**。这条分支不能用"目录默认值"硬凑出一个路由，否则会把没有目标 session 的 UI 状态误显示成可配置路由。

### 16. 输入栏菜单整套交给官方 `Menu` 原语，且只用一张平面卡片

`conversation.input.right` 槽里的控件不自绘菜单。官方 primitives 导出了 `Menu`（+ `MenuItemButton`、`MenuSurface`），它原生支持本控件需要的全部行为：`anchor` 就地渲染触发器、`items` 数据行、`{ type: 'label' }` 分组标题、`{ type: 'separator' }` 细分隔线、`selectedId`/`selectedIds` 的选中勾、`side`/`align`/`portal` 的定位与传送、`onClose` 覆盖点击外部与 Escape、以及行间的方向键走位与选择后焦点回到触发器。所以下面这些**全部删掉了**，不要再写回来：

- `.rm-menu-cell*` / `.rm-menu-option*` / `.rm-menu-check` / `.rm-cell*` / `.rm-option*` 那一整套样式（含 `height: 40px`、`min-height: 38px`、圆角 `20px`、`--dsw-elevation-prominent`、`z-index: 1100`）；
- 手动 `document.addEventListener('mousedown'/'keydown')`、`pane` 状态与 Escape 回退逻辑；
- `useLayoutEffect` 里的 `place()`（12px 边距、`getBoundingClientRect`、scroll/resize 监听）与 `ReactDOM.createPortal`——`portal: true` 就是同一套定位，官方那份连 `MARGIN = 12` 都与我们原先抄的一致。

留给本插件的是**数据**：两条 `{ type: 'label' }` 标题（`label:mode` / `label:summary`）、五条选项行（`mode:*` / `summary:*`）、中间一条 `{ type: 'separator' }`。`onSelect` 收到选项 id 后写一次 `models`（`CHOICES` 表把 id 映射成 patch；标题、分隔线与未知 id 不写——原语也不会为标题和分隔线调 `onSelect`）。**勾也交回原语**：`selectedIds: [mode:<当前>, summary:<当前>]` 加上默认的 `selection: 'check'` 就是两个互相独立分组的选中标记，插件不再产出任何勾的 DOM。CSS 只剩卡片宽度（`rm-control-menu`，经 `listClassName` 落到 portal 出去的卡片上）。

**0.2.0-rc.2 修正：当初选的 `submenu` 嵌套卡片在本控件上永远不可能被看见。** 原语的 `.submenu` 是 `Menu.module.css` 里的 `position: absolute; bottom: -4px; left: calc(100% + 10px)`——恒定向**右**展开。本控件是 composer 最右侧的控件，而 `Menu.tsx` 的 `place()` 把卡片钳在距视口右缘 12px 处（`MARGIN = 12`），所以第二级只能落在屏幕外；我们自己的 `.rm-control-menu` 还额外写了 `overflow: hidden`，等于再裁一刀。用户报的「菜单能打开、但选不了推理模式和摘要等级」就是这个：**不是状态 bug，是第二级从一开始就不可达**。原语对「一个菜单里有多个互相独立的选项组」给出的形状本来就是 `selectedIds`（`Menu.d.ts`：*rows shown as selected when a menu contains independent option groups*），平面卡片是这条路径的正解。**不要再给 `rm-control-menu` 加 `overflow` 或 `max-height`**：原语用 `scrollable` 类自己接管高度预算，我们一裁剪，将来任何嵌套内容都会被切掉。

触发器仍是我们画的，但**测量值与颜色逐 token 抄官方模型位**（`dsh-client-ui-model-selection/lib/client.js` 的 css：`.trigger` = `font-weight:400` / `color:label-secondary` / `border-radius:var(--dsw-radius-sm)` / `max-width:min(360px,45cqw)` / `height:28px` / `padding:0 4px 0 8px`，focus ring 用 `var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))`；`.triggerEffort` = `label-caption` + `flex-shrink:1000`；`.chevron` = `label-caption` + 开启时 `rotate(180deg)`）。原先这里是 `font-weight:500` + 两段都用 `label-caption` + `border-radius:24px`，所以看上去比官方那颗更粗、两个值同色；官方那颗是「主值 `label-secondary`、副值 `label-caption`」的两段式。**行内不再用 `·` 分隔**（官方不画这个字符，只在 `title`/`aria-label` 里用 `·` 拼接），两个值靠 4px gap 与颜色深浅分开。写入在途时触发器用 `StateDot state="ongoing"` 顶掉箭头并置 `aria-busy`，与官方模型位一致。

`--dsh-composer-model-text-display` / `--dsh-composer-model-icon-display` 这两个变量**故意不接**：官方 `dsh-client-ui-conversation/README.md` 写的是控制栏在「展开的控件无法排在同一行」时**为模型位**（for the model seat）设置它们，默认值 `block`/`none`；套到本控件上等于自己扩大契约范围，而且会让本控件在窄宽度下只剩一个箭头。

### 17. 用户可见文案有两个落点，README 是第三处

**界面里的文案**在 `src/client.ts` 的 `zh` / `en` 字典里，经 `locale.register(NS, { zh, en })` 注册；宿主警告是英文（进日志）。**插件列表里的名称与说明**是另一套机制、另一份文件——`locale/<语言>.json` 的 `meta`（见 §18），由宿主在**装载之前**直接读盘，`locale.register` 影响不到它。改文案时记得 README(zh/en) 里的对应描述也要跟着改——三处不会自动同步。README 里出现的界面用语（如「已保存但当前不可用」「保存」）必须与字典逐字一致。

### 18. 插件列表的显示元数据由包内文件决定，运行时测试覆盖不到

插件的名称、说明与图标**不经过代码执行**：宿主在装载前读包内文件（`readPluginMeta(specifier, parentURL)`）。三条契约缺一条的失败方式各不相同：

| 元数据 | 落点 | 写错会怎样 |
|---|---|---|
| 名称与说明 | `locale/<语言>.json` 的 `{"meta":{"title","description"}}`，**文件名就是语言 id**（`en.json` / `zh.json`；重复 id 抛错） | **空值或非字符串会让整次读取抛错**，宿主捕获后返回 `{ error }`——名称、说明与图标**一起丢** |
| 图标 | 顶层 `icon` 字段：相对路径，SVG/PNG/JPEG/WebP，≤256 KiB，realpath 后必须仍在包目录内 | 只降级成「没有图标」，文字照旧 |
| 两者可达 | `exports` 补 `"./locale/*.json": "./locale/*.json"`（`locale` 走 `exports` 解析），`files` 补 `icon.svg` 与 `locale/*.json` | 解析/打包阶段就取不到：两者都不在 `files` 的自动包含集里 |

当前值：`title` = 「推理模式与摘要等级」/ "Reasoning Mode & Summary"，说明见 `locale/zh.json`；图标是两条带滑块的轨道，与工作区其它插件同一套 24×24 描边风格（`#4F7CFF` 主色 + `#8A94A6` 副色、`fill="none"`）。字典只写 `meta`——宿主只读这两个键。

**为什么单列一条**：这条路径完全不执行插件代码，所以 `apply` 的用例全绿、界面一切正常，插件列表里照样可能没有名字。**判据必须是宿主自己的函数**，不是"文件在不在"：

```powershell
# $dsh = 宿主的 @deepseek-ai 目录；parentURL 必须是"插件实际解析得到的那棵树"的基址
# （连接点安装时就是 profile 的 package.json）。给错目录会返回 undefined 而不是报错——只看"有没有抛错"会假绿，
# 要断言返回值里真的有 title / description / icon
$dshU = $dsh -replace '\\','/'
node -e "import('file:///$dshU/dsh-app-boot/lib/index.js').then(async b => { const p = require('path'), u = require('url'); const parent = u.pathToFileURL(p.join(process.env.USERPROFILE, '.dsh/profiles/web/package.json')).href; const name = JSON.parse(require('fs').readFileSync('$cwdU/package.json','utf8')).name; console.log(JSON.stringify(b.readPluginMeta(name, parent))); })"
```

`test/index.test.mjs` 有一条清单契约用例把前两行钉住（`icon` 字段、`exports` 子路径、`files` 条目、每份字典的 `meta.title` / `meta.description` 非空），但它**只能证明文件写对了，证明不了宿主读得到**——后者只能靠上面这条命令。

## 客户端半边的降级状态

用户侧的护栏原先写在 README 里，现在集中在这里（文案与 `src/client.ts` 的 `zh`/`en` 字典逐字对应）：

| 状态 | 判据 | 配置页 | 输入栏控件 |
|---|---|---|---|
| 未就绪 | `form.state.status !== 'ready'`（或 owner 没给 form） | 返回 `null`，不产出任何元素 | 不渲染 |
| 只读 | `form.state.writable === false` | labels 交官方表单，由它显示「设置当前为只读。」并禁用保存 | **不做只读判断**：菜单照常可点，写盘被拒只在控制台留一行警告，界面没有任何提示 |
| 目录加载失败 | `catalogError !== null` | 显示「模型目录加载失败；已保存的选择不会被自动删除。」+ 具体错误 + **重试** | 已有 projection 路由照常显示；新 session 没有目录默认路由时不渲染 |
| 目录为空 | `catalog.length === 0` 且 `effective.size === 0` | 显示「当前没有可用的模型目录。」 | 已有 projection 路由照常显示；新 session 没有目录默认路由时不渲染 |
| 目录加载中 | `catalog === null` 且无错误 | 显示「正在加载模型目录…」 | 新 session 在目录默认路由返回前不渲染；已有 projection 路由不依赖目录，照常显示 |
| 没有可寻址 session | `props.sessionId === undefined` | 不适用 | 不渲染，也不请求目录 |
| 有未保存改动 | `dirty` | shell state 交官方表单（它自己画未保存状态），保存可点 | 不适用（控件即时写盘） |
| 保存失败 | `mutate` 返回 `false` 或抛错 | shell state 的 `failed` 交官方表单，由它显示「保存失败，请重试。」 | 写盘被拒时只写 console 警告（`the Host refused the composer write…`） |

两处有意的不对称，改代码前先想清楚再动：

- **只读时控件仍可点**：配置页会把只读交官方表单拦住保存，控件不会。界面在只读档下本来就少见，付出的是「点了没反应」的观感；要改就在 `update()` 前面加 `writable` 判断并给出与配置页一致的提示，而不是让菜单整个消失。
- **控件写盘失败只有控制台记录**：`update()` 里是 `scope.set('models', next).then(…, …).finally(() => setBusy(false))`——写被拒时打一条 `console.warn`，并且**无论成败都复位 `busy`**。不要写成裸的 `.catch(() => {})`：那只兜得住 rejected promise，而这个 promise 一旦走成 pending 就永远不落，触发器会一直 `disabled`、看起来像"菜单坏了"。界面仍然没有提示：它的写入是"选中即生效"的乐观交互，失败时用户看到的是菜单选了但值没变（订阅会推回旧值）。要补提示就接官方 `Toast`，不要在这里自己画。

## 测试要点

| 文件 | 覆盖 |
|---|---|
| `test/index.test.mjs` | `Config.toJSON()` 里 `models` 的 volatile 标记与字段形状、`normalizeModels` 的归一化、`applyReasoningBody` 保留其它字段、`isResponsesRequest`、`sameModelRoutes` 的去重与「同 model 不同 provider 保持分开」（"恰好一个候选才解析出路由"由下面的端到端用例证明）、`apply()` 装 fetch 包装并在卸载后还原、原生 `Request` 体重建与 `content-length` 移除、并发同 model 路由的亲和选择、stream 结束后的还原、模块契约（`name`/`inject`/`apply`）、**volatile 的活性（改 `config.models` 后下一请求即生效）** |
| `test/client.test.mjs` | `plugins.row.config` 注册（key、`whileServed` 门禁）与 `inject` 面、**输入栏控件渲染出的就是官方 `Menu`：一张平面卡片（两条 `label` + 五个选项行 + 一条 `separator`）、`selectedIds` 两项、触发器恰好三段子节点（值 / 摘要 / 箭头，无自绘分隔符）**、写入只认选项行 id（标题、分隔线、未知 id 都不写）、**在途写入时触发器换成官方 `StateDot` 并置 `aria-busy` 与 `disabled`、落定后换回箭头**、不再自实现菜单的缺席断言（无 `rm-menu*`、`rm-cell*`、`rm-option*`、`submenu`、`createPortal`、`ReactDOM`、`mousedown`、`getBoundingClientRect`）、触发器样式与官方逐 token 对齐（`font-weight:400`、`label-secondary`、`radius-sm`、`min(360px,45cqw)`、focus ring）且卡片不再自设 `overflow`、死规则与死 key（`rm-readonly`、`menuLabel`）已删、models-only 契约（无 `defaultMode`/`defaultSummary`/`scope.mutate`/自绘卡片样式）、**挂载一次配置页并断言注入面被转交、且不会自带 scope**、未 ready / 无 form 时返回 `null`、**摘要视图只出一行文本且不读目录**、**暂存后一次带修订号的写入**、**计数以参数交给官方翻译器（`{n}` 由官方插值，插件不再自己 `replace`；桩记录每次调用的 params）**、**新 session 使用目录默认路由、无 session 不请求目录**、样式只注入一次、缺服务时 apply 惰性、与兄弟插件 bundle 可拼接 |

两条纪律：

- **mock 必须来自实测的宿主契约。** `test/client.test.mjs` 顶部的注释块记录了槽所有者、注册形状、`ConfigPageForm` 与 `ConfigFormSnapshot` 字段的来源（对应包与文件），改 mock 前先回去读那些声明。
- **断言「注入面被转交」，而不只是断言 `inject()` 返回了什么。** owner props 只有 `view` 与 `form`，页面唯一的额外输入就是 `inject()` 面，所以测试要真的调用一次 `render({ view: 'page', form })` 并用返回的 props 执行页面组件；同时也断言页面**没有**自己塞一个 `scope` 进去。

## 发布纪律

按 `PLUGIN_RELEASE_GUIDE.md`「提交前验证清单」跑，本插件相关的判据：

```powershell
pnpm install --no-frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm test
git status --porcelain            # 构建后必须为空

git ls-files cordis.patch.yml icon.svg locale/en.json locale/zh.json lib/index.js lib/types/index.d.ts lib/client.js lib/types/client.d.ts
# 声明过的入口（含 `icon`）与 `files` 的每一条都必须真的出现在载荷里——发布指南「提交前验证清单」有一段把这两个方向都变成会 throw 的断言

# 载荷：12 个文件（README.md 与 README.en.md 都由 README* 自动包含）
pnpm pack --dry-run
```

- **`files` 只列不会被自动包含的产物**：`lib/index.js`、`lib/client.js`、`lib/types/**/*.d.ts`、`cordis.patch.yml`、`icon.svg`、`locale/*.json`。`README.md`、`README.en.md`、`package.json`、`LICENSE` 与 `main` 指向的文件属于自动包含集，列进去是空操作条目；**`icon.svg` 与 `locale/*.json` 恰恰不在自动包含集里**，漏掉它们插件列表就只剩一个名字（见 §18）。`DEVELOPMENT.md` **两边都不沾**（既不被 `files` 匹配，也不在自动包含集），所以它只留在仓库里，不进安装载荷——README 里因此不要链接它（对载荷读者是死链）。
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

- **「启动报不兼容」不等于本插件被闸门拦下，闸门放行也不等于 API 兼容。** 闸门（`evaluatePluginCompatibility`）只比 `@deepseek-ai/dsh-*` 名字的 peer 范围，且用 `includePrerelease: true`——旧写法 `^0.1.5-rc.1` 在 `0.1.7-rc.2` 下**照样通过**。真正把 0.1.5 版插件打死的是 API 消失（`ctx.settings.register`、`ctx.settingsScope`、`settings.plugin.item`、数字后缀的图标名），这些一个都不会出现在闸门输出里。看到宿主打印某插件 incompatible 时，先确认那条警告里的包名是不是本插件。
- **图标名从数字后缀改成了尺寸名后缀。** `IconChevronDownOutline14` / `IconCheckOutline16` 在 0.1.7 的 `dsh-client-ui-primitives` 里**不存在**，`require()` 拿到 `undefined`，要到 React 渲染时才以 `Element type is invalid` 崩掉——症状出现在渲染期而不是加载期。现在按描边粗细分 `…OutlineRegular`（1px）与 `…OutlineMedium`（1.3px）。
- **正则做「旧字段残留」扫描时要加词边界**：`/draftMode/` 会命中 `draftModels`，把正确的代码判成残留。当前用的是 `\bdefaultMode\b|…|\bdraftMode\b|…`。
- **`pnpm pack --dry-run --json` 退出 1 且没有输出**（pnpm 的 `pack` 不认 `--json`）；要机器可读结果用 `npm pack --dry-run --json`，两者对同一份 `files` 点出的文件集相同。
- **`npm pack` 认 cwd 不认 `--prefix`**：检查另一个目录要先 `Push-Location` 过去。
- **本环境的 PowerShell 是 5.1**：没有 `&&`、三元、`??`；`Get-Content` 对无 BOM 的 UTF-8 默认按 ANSI 解码（连行数都会少），读文件一律带 `-Encoding utf8`；`Set-Content -Encoding UTF8` 在本环境**会写入 BOM**，需要无 BOM 的 UTF-8 时用 `[System.IO.File]::WriteAllText`。
- **成功命令也会吐像错误的 stderr**：`pnpm run typecheck` 把脚本行打到 stderr，PowerShell 会包装成 `NativeCommandError`；判据是退出码，不是这段输出。
- **`git diff` 的 LF→CRLF 警告是正常的**，`git diff --check` 才是判空白的。
- **profile 的 `package.json` 里塞一个解析不了的 spec 会连累所有插件的更新。** 本机 web profile 被手动加过 `"@zhourenke/dsh-reasoning-mode": "*"`（当时的目的是让插件管理器的清单显示本插件）。后果是 `pnpm update` 一律以退出码 1 失败：profile 的 `pnpm-lock.yaml` 的 importer 里**根本没有这一条**（只有 `@wxg-prc-cpg/browser-skill-dsh-plugin`、`dsh-lan-access`、`dsh-webui-mobile`），pnpm 于是必须先去 registry 解析 `*`，解析失败就在动其它依赖之前中断——所以症状是"更新**别的**插件也失败"。而依赖行并不是它可见的原因：`dsh-plugin-manager` 的 `listBundles()` 是把 `manifest.dsh.profile.bundles`、`manifest.dependencies` 与安装锚点的 `dependencies` **取并集**之后逐个解析包清单的（`lib/index.js` 的 `names = [...new Set([...selected, ...dependencies, ...Object.keys(installation.dependencies ?? {})])]`），所以本插件只要在 `dsh.profile.bundles` 里就会被列出。真要留成依赖就用不需要 registry 的 spec：`"link:C:/Users/ParkGarden/DSH_Workspace/CreatePlugin/dsh-reasoning-mode"`——profile 的 lockfile 设了 `excludeLinksFromLockfile: false`，`link:` 会被正常记录，本地目录直接生效。另外 `node_modules/@zhourenke/dsh-reasoning-mode` 是指向本仓库的 junction，这才是模块解析的落点。

## 全量清理记录（冗余逻辑与死代码）

按"全量检查，清理冗余逻辑和死代码"逐行过了一遍两个半边、两个测试文件、清单与 CSS。**删掉的**：

| 位置 | 冗余形态 | 处置 |
| --- | --- | --- |
| `src/index.ts` | `distinctCandidates()` 与 `resolveRouteCandidate()` 是同一个「按 model 过滤 + 按路由键去重」的循环，而 `resolve()` 先调前者、再把**已经去重的结果**交给后者又去重一遍 | 合成一个 `sameModelRoutes()` 返回集合，「恰好一个候选才算解析出路由」在 tracker 内联为 `candidates.length === 1`，每次请求只扫一遍 |
| `src/index.ts` | `interface DecodedBody { text: string }` 只是给字符串套了层壳（4 处 `.text`） | `decodeBody()` / `requestBody()` 直接返回 `string \| undefined`；`TextDecoder` 提到模块级复用 |
| `src/index.ts` | `isResponsesRequest` 声明处不导出、文件末尾另写一条 `export { isResponsesRequest }`，与其余 helper 的 `export function` 不一致 | 行内 `export function`，删掉末尾那条导出语句 |
| `src/index.ts` | `routeKey()` 带 `export` 但模块外无人消费（测试也不 import） | 去掉 `export`。导出面的判据：**只导出测试真正 import 的名字**（`normalizeModels` / `applyReasoningBody` / `isResponsesRequest` / `sameModelRoutes` 各有用例） |
| `src/client.ts` | 组件自己再插值一遍：`String(translate(key, { n })).replace(/\{n\}/g, …)` | 删掉 `.replace`。官方翻译器本身就填占位符（`dsh-client-locale/lib/client.js`：`template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match)`），且原来那条回退分支永不触发（`selected` 是唯一带 `{n}` 的 key，调用时必带数字） |
| `test/client.test.mjs` | 两个 React 桩都提供 `useLayoutEffect` / `useRef`，而插件只用 `useEffect` / `useMemo` / `useState` | 删掉这两个死桩：将来真用到会在测试里当场炸出来，比静默存在有用 |

**查到但故意保留的**（都属于"看着像残留、其实有据"，写在这里免得下一个人再查一遍）：

- `x-client-request-id` 不是自造的名字：pi-ai 的 `openai-responses.js` 在非 OpenRouter 格式下**同时**发 `session_id` 与 `x-client-request-id`。清单里补上了 OpenRouter 格式的 `x-session-id`——此前缺失，那类 provider 上亲和查找会永远落空（不是死代码，是漏了一个分支）。
- `headerValue()` 的三个分支（`get()` / `[[k, v]]` / 普通对象）与包装器里的 `content-encoding`、`content-type`、`typeof original !== 'function'` 守卫都可达：它们守的是**全局 fetch 边界**——任何调用方都可能递 `Headers`、数组、字节体或 gzip 体，不是只服务 pi-ai。
- `.rm-control-root` 的 `order: 1` 与 `:has()` 块里那条 `order: 1` 值相同：前者是官方 hash 类名变化后仍然生效的兜底，后者是当前构建下的整行排序。已在 CSS 注释里写明"两处都是 1，故意的"，不再是可疑重复。
- `dsh.client.inject` 六项全部保留，逐条有消费方：`dsh-client-ui-primitives` 是 `require` 的直接依赖（官方有 7 个包同样把它列进去），`dsh-client-ui-conversation` 与 `dsh-client-ui-plugin-manager` 分别是 `conversation.input.right` 与 `plugins.row.config` 两个座位的所有者（把 `dsh-client-ui-conversation` 列进 inject 的官方包约 20 个），其余三项提供 `locale` / `configForms` / `remote` 服务。
- 宿主半边空的 `inject: string[] = []` 保留：它是模块契约的一部分，`test/index.test.mjs` 用 `assert.deepEqual(inject, [])` 钉着。

## 与工作区其它插件的关系

- **只读约束**：`dsh-reasoning-summary` 与 `dsh-reasoning-level` 不是本插件的代码。前者是配置页与菜单结构的参考实现，后者是运行中的第三方插件——**不要改动它们的源码或安装副本**。
- 本插件与 `dsh-reasoning-summary` 同时启用没有冲突：两者动作在不同层（本插件改 Responses 请求体的 `reasoning` 字段，对方管会话消息注入），`test/client.test.mjs` 里有一条把两个 bundle 拼在一起求值的回归测试，防止模块级标识符互相污染。
- 用户主目录的 `~/.dsh/profiles/web/cordis.patch.yml` 是**用户资产**：调试时只读、只哈希核对，不要用工具写它；验证配置行为请走设置界面或临时 profile。（0.1.7 起 `~/.dsh/settings.yaml` 已废弃，宿主的 `importLegacyDocument` 只负责一次性迁移。）

## 运行时依赖与版本

| 包 | 角色 | 声明位置 |
|---|---|---|
| `@deepseek-ai/schemastery` | 唯一被真正 import 的值依赖（`z`，含 `.volatile()`） | `dependencies`（`~3.18.4`） |
| `@deepseek-ai/cordis` | 上下文与插件框架（`Context` / `Volatile` 类型） | `peerDependencies`（optional） |
| `@deepseek-ai/dsh-llm` | `llm/stream` 事件名增强 | `peerDependencies`（optional） |
| `@deepseek-ai/dsh-client-ui-primitives` | 浏览器半边 `require()` 的唯一官方包（图标 + `Menu` + `SettingsForm`） | `devDependencies` |
| `@deepseek-ai/dsh-client-ui-plugin-manager`、`…-ui-settings` | 配置页槽契约与 `ConfigPageForm` 的**类型出处**（浏览器半边是 `any`，靠人工对照 `.d.ts`） | `devDependencies` |
| `typescript`、`@types/node` | 工具链 | `devDependencies` |

宿主包在 `devDependencies` 里**钉死到 `0.2.0-rc.2`**（`cordis` 钉 `4.0.4`）：连接点安装时插件解析到的是自己 `node_modules` 里的副本，写范围会让人对着与线上不同的宿主做类型检查与测试。`dsh-llm` 这条尤其不能省——宿主半边有一句 `import type {} from '@deepseek-ai/dsh-llm'`，它取的是该包声明的事件表（`llm/stream`），版本旧了就会对着退役的事件签名做类型检查。`schemastery` 用 `~3.18.4`（官方插件的写法）：**它对运行时有实质影响**——`3.18.2` 没有 `.volatile()`，插件会在 `apply` 时抛 `TypeError`，而宿主与 loader 用的是 `3.18.4`。基线版本：**DSH v0.2.0-rc.2**，Node 25.8.1，pnpm 11.21.0。

## 兼容性与准入闸门

`peerDependencies` 写的是**意图声明**，不是兼容性证明：宿主的装载闸门只统计名字为 `@deepseek-ai/dsh-*` 的 peer，按 `semver.satisfies(runtime, range, { includePrerelease: true })` 判定（`@deepseek-ai/cordis` 走自己的版本线，不在闸门内）。`includePrerelease` 让这条闸门比普通 semver 宽松得多——0.1.5 时代的 `^0.1.5-rc.1` 在 `0.1.7-rc.2` 下照样通过。**但宽松只覆盖 patch：它照样拦跨 minor。** 0.1.7 → 0.2.0 正好跨了 minor，于是 `^0.1.7-rc.2` 当场被拦：

```
runtime = 0.2.0-rc.2
peer dsh-llm = ^0.1.7-rc.2 -> 冲突: {"name":"@zhourenke/dsh-reasoning-mode","version":"0.1.0",
  "runtimeVersion":"0.2.0-rc.2","peers":{"@deepseek-ai/dsh-llm":"^0.1.7-rc.2"},"exempted":false}
peer dsh-llm = ^0.2.0-rc.2 -> 兼容
```

（两行都是把本包 `package.json` 直接喂给 `@deepseek-ai/dsh-app-boot` 的 `evaluatePluginCompatibility()` 得到的，用的是装载时真正调用的那个函数。日志里那个 `"version":"0.1.0"` 是那次实验当时的号，**保留原样不改**——本包自己的 `version` 不参与判定，闸门只按 `@deepseek-ai/dsh-*` 的 peer 范围判；当前发布号见 `package.json`。）所以：

- **跨 minor 升级后第一件要改的就是这条范围**：本轮的"启动报不兼容"只有这一个成因，改完即通过；插件代码与宿主 API 一处没坏（见「DSH 0.2.0-rc.2 复核记录」）。
- **`incompatible-version` 只说明范围没跟上宿主，不能当成"插件不兼容"的判据**——反过来闸门放行也不等于 API 兼容。真正的断裂（0.1.5 → 0.1.7 那一轮）全是 **API 消失**：`ctx.settings.register`、`ctx.settingsScope`、`settings.plugin.item`、`settings.yaml`、数字后缀图标名。这些不产生任何闸门输出，只能靠逐条核对契约发现。
- 排查别人报"启动说不兼容"时，**先看警告里的包名**。本机 web profile 的历史日志里被点名过一次的是 `@michengai/dsh-archive-manager@0.1.44`（peer 是一个不含 `0.1.7-rc.2` 的精确版本并集）。profile 的豁免表（`readProfileCompatibility(dir)`）也要一起看：有豁免就会静默放行，`exempted: false` 才是真的按范围判定。
- 写 `^<当前宿主版本>` 会放行同 minor 的正式版与后续预发布（`^0.2.0-rc.2` → 放行 `0.2.0`、`0.2.1-rc.1`，拦 `0.1.7-rc.2` 与 `0.3.0-rc.1`）。要更严就写精确版本，代价是每次宿主升级都会被拦下。
- **检查方法**：`evaluatePluginCompatibility(manifest, exemptions?, runtimeVersion?)` 就是装载时真正调用的函数，直接拿本包的 `package.json` 调它，比人眼比范围可靠（含 `includePrerelease` 的宽松度，也含豁免表）。

## DSH 0.2.0-rc.2 复核记录（设置 / UI 域）

按工作区 `PLUGIN_RELEASE_GUIDE.md` 第 7 节那份 14 步清单逐条跑过（0.1.7-rc.2 → 0.2.0-rc.2）。**结论：只有 peer 范围一处要改，代码与契约一处没坏。** 逐条证据：

**未变（重跑即可确认）**

- **座位与槽**：`conversation.input.right` 仍是 `kind: 'list'` / `scope: 'session'` / `registerOptions: [id(required), order, label]`、`occupants: []`、`replaceRisk: 'none'`，仍由 `dsh-client-ui-conversation` 的 `renderSlot("conversation.input.right", {})` 渲染；`plugins.row.config` 仍是 `kind: 'keyed'`、只收 `key`、`occupants: []`、`keyDomain` 仍是 "open: … none are taken yet"；`rowConfigKey` / `formFor` 的判据（`ns === 行 id`）逐字未变。
- **表单契约**：`formFor(id)` 返回的仍是 `{ state: form.getSnapshot(), mutate(ops, revision) }`。座位文档里的类型名换成了 **`ConfigPageForm`**（0.1.7 的文档写的是 `ConfigForm`），但**形状一字未变**——`ConfigForm` 类本身仍有 `getSnapshot()/subscribe()/set()/unset()/mutate(ops, expectedRevision?)`，快照字段仍是 `status/value/base/user/revision/writable/mode`；`configForms.whileServed(namespaces, register)` 语义不变。
- **原语**：`Menu` 的 props（含 `items` 里 `{type:'label'}` / `{type:'separator'}` 的判别式、`selectedId`/`selectedIds`、`selection: 'check'`）、`MARGIN = 12`、`SettingsForm` 的 `{state:{available,dirty,invalid,saving,writable,failed}, labels, children, onSave, onDiscard}`、`IconChevronDownOutlineRegular` / `IconCheckOutlineRegular` / `IconChevronRightOutlineRegular` / `StateDot` 全部原样；数字后缀图标名依旧不存在。
- **服务**：`configForms` / `slots` / `locale` / `remote` / `remote.session` 都还在；`modelCatalog` RPC 仍在 `@deepseek-ai/dsh-api-remotes`（`method: "modelCatalog"`）；`modelSelection` 投影仍是 `{lastUsed, next}`（每个元素多了可选的 `reasoningEffort`，我们忽略）；`locale.register(ns, dicts)` 与 `locale.bind(ns)` 签名不变。
- **宿主半边**：`llm/stream` 仍是 waterfall（`dsh-llm/lib/index.js` 里 `this.ctx.waterfall(this, "llm/stream", options, …)`），事件表里也是唯一与请求相关的那个；`Volatile` 仍从 cordis 导出、`Config` 仍是 `export const Config`；`schemastery` 仍是 `~3.18.4` 单副本（宿主全部包声明唯一范围，本包 `pnpm why` 只有一份）；`cordis` 仍是 `4.0.4`。
- **排序依赖的官方哈希类名**：本插件 CSS 里那两条 `:has()` 规则挂的 `uV2eYG_trailing` / `uV2eYG_primary` 在 0.2.0 的 `dsh-client-ui-conversation` 里**哈希未变**（CSS-module 哈希按内容生成，源码没动就不动）。这类依赖失效的症状是**控件顺序错乱而不是报错**，所以每次升级都要按名字重取一次。
- **清单**：`dsh.bundle.patch` / `dsh.client.platform` / `dsh.client.inject` 的字段形状与官方伴随包（`dsh-client-ui-settings-web-search`）逐字一致，六个被 inject 的包在 0.2.0 全部存在。**当时对 `readPluginMeta()` 的核对只做到"读得出 title 与 description"就收工**——那其实是 `package.json` 的 `name` / `description` 回退值，不是本地化元数据，而且本包根本没有图标资源（卡片走官方默认插画）；此后补上了 `locale/{en,zh}.json` 与 `icon.svg`，现在返回的是 `{ "title": {"en","zh"}, "description": {"en","zh"}, "icon": "data:image/svg+xml;base64,…" }`（判据与失败模式见 §18）。profile 的豁免表为空（`exemptions = {}`），所以闸门结果是真的。

**变了 / 新增的**

- **`plugins.bundle.config`**（新座位，见 §12 的座位依据）：服务 bundle 自己的配置，本插件不用。
- **`plugins.item` 的文档现在写死了归属**：bundle 的配置应落在 `plugins.bundle.config` 或 `plugins.row.config`，等于把我们上一轮的座位选择变成了官方明文。
- **reasoning effort 变成一等能力**：适配器在模型信息里自报 `reasoning: { efforts: [{id,name,description}], defaultEffort }`，`resolveCallWithInfo` 会**在发起 I/O 之前拒绝**模型不支持的显式 effort；pi-ai 侧还有 profile 的 `reasoningEfforts` 字典 → `thinkingLevelMap` 映射。**本插件不实现 effort（那会是重复造轮子），菜单里只有官方没有入口的 `mode` 与 `summary` 两项。**
- **本轮真正剥离掉的一处重复：自备译函数。** 上一版两个座位都在 `apply` 里 `locale.bind(NS)`、再把 `t` 展开进组件 props；渲染器源码显示声明了 `locale:` 的 entry 本来就会拿到 `kit.t = localeSeat(face, ns)`（即 `face.bind(ns)` 的缓存包装），locale face 缺失时它还要**抛 `SlotAssemblyError`**——所以这是同一个 prop 上的第二条路径。现在源码里不出现 `locale.bind`，组件读座位给的 `props.t`，测试桩按渲染器规则拼 kit 并用断言把这条钉住（见 §12 的座位依据）。
- **插件的界面入口换了地方（用户可见，README 必须跟着改）。** 0.1.7 里配置页在设置页的"插件"入口下，0.2.0 把它改成**左侧工作区顶部的「插件」选项卡**：`dsh-client-ui-plugin-manager` 现在把面板注册进 `sidebar.panellist`（`{ id: PANEL_ID, order: 0, label: () => t("panel"), locale: NS }`），页面主体进 `main`。**座位与派发机制一点没变**——行详情页仍是官方 `RowDetail` 渲染 `renderSlot("plugins.row.config", { view: "page", form })`，行的"配置"按钮仍以 `ledger.rows.has(rowConfigKey(pkg.name, row.rowId))` 为显示条件（我们的注册在 `whileServed` 生效后才存在，所以**注册没起来时用户看到的是一个没有入口的行**）。插件代码因此不用改，要改的是 README 里"去哪儿点"那句：**插件选项卡 → `@zhourenke/dsh-reasoning-mode` 包页面 → 「包含的组件」列表 → `reasoning-mode` 行的「配置」**（官方文案 `configureRow: "配置 {name}"`，列表标题 `partsLabel: "包含的组件"`，返回键 `backToPackage`）。**措辞别写过头**：设置页里那一项并没有消失，而是改名成了**「内置插件」**——`dsh-client-ui-settings-plugins` 仍然注册 `settings.section`（id 仍是 `plugins`、order 15、`nav: "内置插件"` / `"Built-in plugins"`），内容变成"本部署自带插件"的只读清单加各 feature 注册进 `settings.plugins.tab` 的标签页。那个包的注释把分工写死了：*"The configuration pages of the host-plane plugins live in their own companion packages, which register into the Plugins page; this section owns the Settings navigation entry and the tab chrome only."* 所以 README 必须说"配置页搬到了插件页"，而不是"设置里没有插件入口了"——用户按后者去找会以为插件坏了。
- **输入栏菜单的第二级从"永远看不见"改成一张平面卡片（用户可见）。** 上一版把两个分组放进了原语的 `submenu` 嵌套卡片，而那条路径恒向右展开、本控件又在 composer 最右侧，所以第二级从未被渲染到屏幕内（我们自己写的 `overflow: hidden` 又叠了一刀）——这正是用户报的"无法选择推理模式和摘要等级"的成因。现在两个分组是同一张卡片里的 `label` + 选项行，勾由 `selectedIds` 交原语画（详见 §16）。同一轮还对齐了触发器的字重/颜色/圆角（官方 `font-weight:400` + `label-secondary`/`label-caption` 两段式，原先是 500 且两段同色），并在写入在途时换成官方 `StateDot`。

**判过但不采用的官方件（"不重复造轮子"的另一面：也不为了显得在融合而硬接）**

| 官方件 | 为什么不用 |
|---|---|
| `Pill` | 确实能画输入栏那种胶囊，但**没有任何官方包在用它**（全树 0 处调用），没有"官方 chip + Menu"的现成范式可抄；而本插件的触发按钮还承担 composer trailing 行的布局约束（`max-width: 132px`、`order` 规则、`cqw` 单位、依赖官方 `_trailing` 类名做 `:has()`），换成 `Pill` 只剩视觉收益、风险却是不可见的布局回归 |
| `SettingsFormModel` + `settingsTextField/NumberField`、`SettingsValueField`、`SettingsSecretField` | 这一族**只对"用户键入的文本草稿"建模**：`stage(field, {text, clear})` → `spec.parse(text)` → `plan()` 生成 ops，`shell()` 产出的正是 `SettingsForm` 要的六个布尔。本插件的配置页编辑的是**结构化数组**（逐行的 provider/model/mode/summary + 增删），套进去只能把整份数组序列化成一段文本再解析，属于为了用官方件而牺牲交互。官方件已经承担的那半边（表单外壳、保存按钮、失败提示）我们确实用了 |
| `SegmentedControl` / `SegmentedTabs` | 会占掉输入栏宽度，而且本控件是"两个维度各自取值"的菜单，不是一组互斥 tab |

**最"不正统"的一处：全局 fetch 包装的前提链条**（每次升级都要重跑）

宿主半边唯一的写入通道是包装 `globalThis.fetch`，匹配 URL 以 `/responses` 结尾的 JSON 请求，再按 `body.model` + 会话亲和头解析路由。0.2.0 里这条链的每一环都复核过：

1. `/responses` 这个 wire 现在由 **`dsh-llm-pi-ai`** 经外部库 `@earendil-works/pi-ai@0.87.1` 发起（`openai-responses` API）；
2. pi-ai 是**调用时**取全局 fetch（`(options?.fetch ?? globalThis.fetch)(url, …)`），不是模块加载时捕获——所以运行中替换 `globalThis.fetch` 依然有效；
3. `dsh-llm-pi-ai` 传给 pi-ai 的 options 只有 `apiKey` / `headers` / `signal`，**没有 `fetch`**，所以不会被旁路。

这三条任何一条变了（例如宿主开始传自己的 `fetch`，或 pi-ai 改成模块级捕获、或换库），症状都是**静默失效**——请求照发、只是 `reasoning` 字段没被改写，没有任何报错。Dsh 也没有提供请求改写缝隙：`dsh-llm` 的服务面只有 `registerAdapter` / `listModels` / `resolveModelInfo` / `resolveCallConfig` / `prepareCall` / `stream` 等，waterfall 事件只有 `llm/stream`、`tools/*`、`internal/*` 与 `llm/adapters-updated`。**升级后要按上面三条重新验证一次**，这是本插件最脆的一环。

## 许可证

MIT
