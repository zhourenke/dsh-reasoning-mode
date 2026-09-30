[English](README.en.md) | **中文**

# @zhourenke/dsh-reasoning-mode

**给选定的 provider/model 指定 Responses 请求的推理模式与摘要等级。**

DSH 自带 adapter 提供的 `reasoningEffort`（每个模型的推理档位），但 Responses 请求体里的 `reasoning.mode`（Standard / Pro）与 `reasoning.summary`（Auto / Concise / Detailed）没有逐路由入口；本插件补上这一层：**只改写你勾选的路由**，其它请求原样通过。

## 它解决什么问题

- **逐路由控制推理强度**：同一个 model 在不同 provider 下互不影响。
- **摘要等级可调**：`Auto` 交给模型自己判断，`Concise` / `Detailed` 强制要短或要长。
- **随时可卸**：作为 profile 层插入，不修改 DSH 本体；清空勾选即完全关闭。

## 前置条件

走 OpenAI Responses 协议的 GPT 模型。走 Chat Completions 的模型或其它不支持该配置项的模型不会生效。

## 安装

```powershell
dsh plugin --profile web add "github:zhourenke/dsh-reasoning-mode"
```

安装后需要**重启 DSH 并刷新页面**（宿主半边在进程启动时装载，浏览器半边在插件激活时取一次产物），然后在左侧工作区顶部的 **插件** 选项卡里找到 `@zhourenke/dsh-reasoning-mode`，在它页面的 **包含的组件** 列表中点 `reasoning-mode` 那一行的 **配置**，即可打开本插件的配置页。（0.2.0 起，插件的配置页只在这里；设置页里那一项已改名 **内置插件**，只列本部署自带的插件，没有本插件的入口。）

卸载：

```powershell
dsh plugin --profile web remove @zhourenke/dsh-reasoning-mode
```

## 快速上手

1. 打开左侧工作区顶部的 **插件** 选项卡，进入 `@zhourenke/dsh-reasoning-mode`，在 **包含的组件** 里点 `reasoning-mode` 行的 **配置**，在模型目录里勾选要让插件改写的 `provider/model`，点**保存**。
2. 打开一个会话，在模型选择器中把模型切到刚才勾选的路由。
3. 点开输入栏右侧出现的标签：卡片上半是 **推理模式**（Standard / Pro），下半是 **摘要等级**（Auto / Concise / Detailed）；当前取值带勾，点一下就生效（没有保存按钮）。

新勾选的路由默认 `Standard` + `Auto`；取消勾选再重新勾选会保留原来的值。

配置保存即生效，**不需要重启**：本插件的配置存在 profile 补丁层里，而补丁层是热重载的。

## 配置

配置的落点是 **web profile 的补丁层** `<harness home>/profiles/web/cordis.patch.yml`，挂在 `reasoning-mode` 这一行下面：

```yaml
- id: reasoning-mode
  name: '@zhourenke/dsh-reasoning-mode'
  config:
    models:
      - provider: <provider-id>
        model: <model-id>
        mode: pro
        summary: detailed
```

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|:---:|---|
| `models` | array | `[]` | 要改写的路由列表，每项为 `{ provider, model, mode, summary }`。**空列表是唯一的关闭状态**。 |
| `models[].provider` | string | 无 | provider id，必须与目录里的 id 逐字一致。 |
| `models[].model` | string | 无 | model id，同样逐字一致。 |
| `models[].mode` | `standard` \| `pro` | `standard` | 下发到 `reasoning.mode`。 |
| `models[].summary` | `auto` \| `concise` \| `detailed` | `auto` | 下发到 `reasoning.summary`。 |

- `provider` 与 `model` 必须**同时**匹配；同一个 model 挂在另一个 provider 下不会命中那条路由。
- 缺失或写错的 `mode` / `summary` 会在读取时归一化回 `standard` / `auto`，不会导致加载失败；完全相同的 `provider`+`model` 重复条目会被去重。
- id 写错的条目不会报错，只是不生效（在配置页里勾选就不会写错）。
- 目录里当前不存在的已保存路由会保留在「已保存但当前不可用」分组里，手动取消勾选并保存后会消失。

## 兼容性

在 **DSH v0.2.0-rc.2**（2026-09）下测试通过。

## 许可证

MIT
