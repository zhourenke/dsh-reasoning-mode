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

安装后需要**重启 DSH 并刷新页面**，然后在模型选择器右侧可以看到本插件的选择标签，在 **设置 → 插件 → 推理模式** 可以看到本插件的设置卡片。

卸载：

```powershell
dsh plugin --profile web remove @zhourenke/dsh-reasoning-mode
```

## 快速上手

1. 打开 **设置 → 插件 → 推理模式**，在模型目录里勾选要让插件改写的 `provider/model`，点**保存**。
2. 打开一个会话，在模型选择器中把模型切到刚才勾选的路由。
3. 在右侧出现的标签中选择想要的 **推理模式** 与 **摘要等级**。

新勾选的路由默认 `Standard` + `Auto`；取消勾选再重新勾选会保留原来的值。

也可以直接编辑 `~/.dsh/settings.yaml`：

```yaml
# ~/.dsh/settings.yaml
reasoning-mode:
  models:
    - provider: <provider-id>
      model: <model-id>
      mode: pro
      summary: detailed
```

id 写错的条目不会报错，只是不生效（在设置卡片里勾选就不会写错）。

配置保存即生效。

## 配置

`~/.dsh/settings.yaml` 里本插件只占一个顶层键 `reasoning-mode`：

| 字段 | 类型 | 默认 | 说明 |
|---|---|:---:|---|
| `models` | array | `[]` | 要改写的路由列表，每项为 `{ provider, model, mode, summary }`。**空列表是唯一的关闭状态**。 |
| `models[].provider` | string | 无 | provider id，必须与目录里的 id 逐字一致。 |
| `models[].model` | string | 无 | model id，同样逐字一致。 |
| `models[].mode` | `standard` \| `pro` | `standard` | 下发到 `reasoning.mode`。 |
| `models[].summary` | `auto` \| `concise` \| `detailed` | `auto` | 下发到 `reasoning.summary`。 |

- `provider` 与 `model` 必须**同时**匹配；同一个 model 挂在另一个 provider 下不会命中那条路由。
- 缺失或写错的 `mode` / `summary` 会在读取时归一化回 `standard` / `auto`，不会导致加载失败；完全相同的 `provider`+`model` 重复条目会被去重。
- 目录里当前不存在的已保存路由会保留在「已保存但当前不可用」分组里，手动取消勾选并保存后会消失。

## 兼容性

在 **DSH v0.1.5-rc.1**（2026-09）下测试通过。

## 许可证

MIT
