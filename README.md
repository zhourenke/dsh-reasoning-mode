[English](README.en.md) | **中文**

# @zhourenke/dsh-reasoning-mode

**给选定的 provider/model 指定 Responses 请求的推理模式与摘要等级。**

有些路由走 OpenAI Responses 接口（`POST …/responses`），请求体里可以带 `reasoning.mode`（Standard / Pro）和 `reasoning.summary`（Auto / Concise / Detailed），用来控制模型花多少推理、要不要回传思考摘要。DSH 自己有 adapter 提供的 `reasoningEffort`（每个模型可选的推理档位），但这两个 Responses 字段没有逐路由入口——本插件补上这一层：**只改写你勾选的路由**，其它请求一个字节都不动。

> ⚠️ **用之前先想清楚取舍：** `Pro` 与 `Detailed` 一般意味着更长的推理和更多的 token，`Concise` 反过来更省。插件只负责把你选的值下发到请求里，选哪个由你决定。

## 它解决什么问题

- **逐路由控制推理强度**：同一个 model 挂在不同 provider 下时按 `provider` + `model` 精确匹配，互不影响。
- **摘要等级可调**：`Auto` 交给模型自己判断，`Concise` / `Detailed` 强制要短或要长。
- **不越权改写**：只动 `reasoning.mode` 与 `reasoning.summary`，`reasoning` 下的其它字段（例如 adapter 自己设的 `effort`）原样保留。
- **随时可卸**：作为 profile 层插入，不修改 DSH 本体；清空勾选即完全关闭。
- **只影响你能看到的那条路由**：无法确定请求属于哪个 provider 时，插件选择不改写，而不是猜一个。

## 前置条件

- DSH **v0.1.5-rc.1**（2026-09 基线）。
- 至少一条走 OpenAI Responses 的 provider 路由；只走 Chat Completions 的路由不受影响，也不会被改写。

确认插件已经装进 profile 层：

```powershell
$dshHome = $env:DSH_HOME; if (-not $dshHome) { $dshHome = "$env:USERPROFILE\.dsh" }
Select-String -Path "$dshHome\profiles\web\package.json" -Pattern 'dsh-reasoning-mode'
```

有输出就说明已经装进 profile 层（`dsh.profile.bundles` 里一条；用 `dsh plugin add` 正常安装时 `dependencies` 里也会有一条，开发期用目录连接点挂载的则只有前者）。

## 安装

```powershell
dsh plugin --profile web add "github:zhourenke/dsh-reasoning-mode"
```

安装后需要**重启 DSH 并刷新页面**，然后在 **设置 → 插件 → 推理模式** 看到本插件的卡片。

卸载：

```powershell
dsh plugin --profile web remove @zhourenke/dsh-reasoning-mode
```

## 快速上手

1. 打开 **设置 → 插件 → 推理模式**，在模型目录里勾选要让插件改写的 `provider/model`，点**保存**。
2. 打开一个会话，把模型切到刚才勾选的路由；输入栏里模型选择器右侧会出现 `Standard · Auto` 这样的控件。
3. 在控件里选 **推理模式** 与 **摘要等级**，选完立即生效，不需要再点保存。

新勾选的路由默认是 `Standard` + `Auto`；把某条路由取消勾选再重新勾选，原来调好的模式与摘要等级会保留。

也可以直接编辑 `~/.dsh/settings.yaml`（这是**覆盖** `reasoning-mode` 这个 namespace，不是往别处再插一条）：

```yaml
# ~/.dsh/settings.yaml
reasoning-mode:
  models:
    - provider: <provider-id>
      model: <model-id>
      mode: pro
      summary: detailed
```

`provider` 与 `model` 必须与 DSH 里实际的 id 逐字一致，两个都要匹配；写错的条目不会报错，只是不生效（在设置卡片里勾选就不会写错）。

**配置保存即生效，不需要重启，也不需要刷新页面。** 需要重启的只有安装、升级这类改动本体代码的操作。

## 配置

`~/.dsh/settings.yaml` 里本插件只占一个顶层键 `reasoning-mode`：

| 字段 | 类型 | 默认 | 说明 |
|---|---|:---:|---|
| `models` | array | `[]` | 要改写的路由列表，每项为 `{ provider, model, mode, summary }`。**空列表是唯一的关闭状态**，也是默认值。 |
| `models[].provider` | string | 无 | provider id，必须与目录里的 id 逐字一致。 |
| `models[].model` | string | 无 | model id，同样逐字一致。 |
| `models[].mode` | `standard` \| `pro` | `standard` | 下发到 `reasoning.mode`。 |
| `models[].summary` | `auto` \| `concise` \| `detailed` | `auto` | 下发到 `reasoning.summary`。 |

- `provider` 与 `model` 必须**同时**匹配；同一个 model 挂在另一个 provider 下不会命中那条路由。
- 缺失或写错的 `mode` / `summary` 会在读取时归一化回 `standard` / `auto`，不会导致加载失败；完全相同的 `provider`+`model` 重复条目会被去重。
- 设置卡片只改本插件的 namespace，不影响 DSH 通用的模型设置。
- 目录里当前不存在的已保存路由会保留在「已保存但当前不可用」分组里，直到你手动取消勾选并保存。

## 它在请求里改什么

只在同时满足下列条件的请求上生效，其余一律原样转发：

| 条件 | 取值 |
|---|---|
| 方法 | `POST` |
| 路径 | 以 `/responses` 结尾 |
| `content-encoding` | 缺省或 `identity`（压缩过的请求不解析） |
| `content-type` | 缺省或包含 `json` |
| 请求体 | 是 JSON 对象，且带字符串 `model` |

满足条件且能确定路由时，插件把请求体里的 `reasoning.mode` 与 `reasoning.summary` 写成你配的值，**保留 `reasoning` 下的其它字段**，然后原样重建请求（方法、header、缓存、凭据、signal 等请求选项全部保留，只把过期的 `content-length` 去掉）。

## 什么时候会跳过（护栏）

| 情况 | 你会看到什么 |
|---|---|
| 请求的路由没被勾选 | 什么都不发生，请求原样通过 |
| 同一个 model 挂在多个 provider 下、又无法确定是哪一个 | 请求原样通过，宿主日志里出现一条 `reasoning-mode: skipped Responses rewrite because provider identity is ambiguous …` 警告（同一个组合只报一次） |
| 模型目录读不到 | 卡片提示 **模型目录加载失败；已保存的选择不会被自动删除。** 并给出**重试**按钮；已保存的勾选保持不动 |
| 设置当前只读 | 卡片顶部提示 **设置当前为只读。**，保存按钮不可用 |
| `models` 为空 | 完全关闭：没有任何请求会被改写 |

## 界面上的两处入口

**设置卡片（设置 → 插件 → 推理模式）**：按目录顺序列出实时 provider/model，每行一个复选框；改动先留在本地，点**保存**才写回设置，点**放弃更改**丢弃。未保存时卡片标题旁有**未保存**标记。

**输入栏控件（模型选择器右侧）**：只在当前会话的路由已被勾选时出现，显示形如 `Standard · Auto`。点开后依次是 **推理模式**（Standard / Pro）与 **摘要等级**（Auto / Concise / Detailed）两个子菜单，选中即写入设置，没有单独的保存按钮。当前路由没被勾选时这个控件不出现——先去设置卡片里把它勾上。

## 已知限制（实测确认）

- **只管 Responses 请求**：Chat Completions 或其它形状的请求不会被改写。
- **只写两个字段**：`reasoning.mode` 与 `reasoning.summary`；`reasoning.effort` 等字段由 adapter 决定，插件不碰。
- **无法解析就不改**：请求体不是 JSON、被压缩、或没有 `model` 字段时，插件放弃改写而不是冒险重建请求。
- **歧义时不猜**：同 model 多 provider 且缺少会话归属信息时跳过改写（正常会话里 DSH 会带上归属信息，所以这种情况主要出现在非会话调用上）。
- **安装与升级需要重启**：宿主半边与浏览器半边都在插件激活时载入，改完代码要重启 DSH 并刷新页面；配置改动不受此限。
- **设置卡片依赖宿主返回模型目录**：目录不可用时只能看到已保存路由，无法新勾选。

## 兼容性

在 **DSH v0.1.5-rc.1**（2026-09）下测试通过。

## 许可证

MIT
