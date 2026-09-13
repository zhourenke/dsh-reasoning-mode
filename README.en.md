**English** | [中文](README.md)

# @zhourenke/dsh-reasoning-mode

**Set the reasoning mode and summary level of Responses requests for chosen provider/model routes.**

DSH has its own adapter-provided `reasoningEffort` (the selectable effort per model), but the Responses body fields `reasoning.mode` (Standard / Pro) and `reasoning.summary` (Auto / Concise / Detailed) have no per-route entry point. This plugin adds one: it rewrites **only the routes you check** and forwards every other request untouched.

## What it solves

- **Per-route reasoning strength**: the same model under different providers does not affect the others.
- **Adjustable summary level**: `Auto` lets the model decide, `Concise` / `Detailed` force it shorter or longer.
- **Removable at any time**: it installs as a profile layer and never modifies DSH itself; clearing the checks turns it off completely.

## Prerequisites

GPT models that speak the OpenAI Responses protocol. Models on Chat Completions, or any other model that does not support this option, are unaffected.

## Installation

```powershell
dsh plugin --profile web add "github:zhourenke/dsh-reasoning-mode"
```

After installing, **restart DSH and refresh the page**: the plugin's selection label then appears to the right of the model selector, and its settings card appears under **Settings → Plugins → Reasoning mode**.

Uninstall:

```powershell
dsh plugin --profile web remove @zhourenke/dsh-reasoning-mode
```

## Quick start

1. Open **Settings → Plugins → Reasoning mode**, check the `provider/model` routes this plugin should rewrite, and click **Save**.
2. Open a conversation and switch the model to one of the checked routes in the model selector.
3. Pick the **reasoning mode** and the **summary level** you want in the label that appears on the right.

A newly checked route starts at `Standard` + `Auto`; unchecking and checking it again keeps the values you had set.

You can also edit `~/.dsh/settings.yaml` directly:

```yaml
# ~/.dsh/settings.yaml
reasoning-mode:
  models:
    - provider: <provider-id>
      model: <model-id>
      mode: pro
      summary: detailed
```

An entry with a mistyped id raises no error, it simply never applies (checking boxes in the settings card avoids typos).

Configuration applies as soon as it is saved.

## Configuration

The plugin owns exactly one top-level key in `~/.dsh/settings.yaml`, `reasoning-mode`:

| Field | Type | Default | Meaning |
|---|---|:---:|---|
| `models` | array | `[]` | Routes to rewrite; each item is `{ provider, model, mode, summary }`. **An empty list is the only off switch**. |
| `models[].provider` | string | none | Provider id, character-for-character identical to the catalog. |
| `models[].model` | string | none | Model id, likewise exact. |
| `models[].mode` | `standard` \| `pro` | `standard` | Written to `reasoning.mode`. |
| `models[].summary` | `auto` \| `concise` \| `detailed` | `auto` | Written to `reasoning.summary`. |

- `provider` and `model` must match **together**; the same model under another provider does not hit that route.
- A missing or invalid `mode` / `summary` is normalized back to `standard` / `auto` when read and never fails loading; identical `provider`+`model` duplicates are removed.
- Saved routes that are absent from the catalog stay listed under "saved but currently unavailable"; manual unchecking and saving removes them.

## Compatibility

Tested with **DSH v0.1.5-rc.1** (2026-09).

## License

MIT
