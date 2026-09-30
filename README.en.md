**English** | [中文](README.md)

# @zhourenke/dsh-reasoning-mode

**Set the reasoning mode and summary level of Responses requests for chosen provider/model routes.**

DSH has its own adapter-provided `reasoningEffort` (the effort of each model), but the Responses body fields `reasoning.mode` (Standard / Pro) and `reasoning.summary` (Auto / Concise / Detailed) have no per-route entry point; this plugin adds one: it rewrites **only the routes you check** and forwards every other request untouched.

## What it solves

- **Per-route reasoning strength**: routes stay independent even when the same model appears under several providers.
- **Adjustable summary level**: `Auto` lets the model decide, `Concise` / `Detailed` force it shorter or longer.
- **Removable at any time**: it installs as a profile layer and never modifies DSH itself; clearing the checks turns it off completely.

## Prerequisites

GPT models that speak the OpenAI Responses protocol. Models on Chat Completions, or any other model that does not support this option, are unaffected.

## Installation

```powershell
dsh plugin --profile web add "github:zhourenke/dsh-reasoning-mode"
```

After installing, **restart DSH and refresh the page** (the host half is loaded when the process starts, and the browser half snapshots its bundle when the plugin activates). The plugin's configuration page then lives behind the **Plugins** tab at the top of the left workspace sidebar: open `@zhourenke/dsh-reasoning-mode` and click **Configure** on the `reasoning-mode` row under **Components**. (That interface moved out of the settings page in 0.2.0.)

Uninstall:

```powershell
dsh plugin --profile web remove @zhourenke/dsh-reasoning-mode
```

## Quick start

1. Open the **Plugins** tab at the top of the left workspace sidebar, enter `@zhourenke/dsh-reasoning-mode`, click **Configure** on the `reasoning-mode` row under **Components**, check the `provider/model` routes this plugin should rewrite, and click **Save**.
2. Open a conversation and switch the model to one of the checked routes in the model selector.
3. Open the label on the right of the composer: **reasoning mode** (Standard / Pro) fills the upper half of the card and **summary level** (Auto / Concise / Detailed) the lower half. The current values carry the check, and a click applies at once (there is no save button).

A newly checked route starts at `Standard` + `Auto`; unchecking and checking it again keeps the values you had set.

Saving applies immediately and **needs no restart**: this plugin's configuration lives in the profile patch layer, which is hot-reloaded.

## Configuration

The configuration lives in the **web profile's patch layer**, `<harness home>/profiles/web/cordis.patch.yml`, attached to the `reasoning-mode` row:

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

| Field | Type | Default | Meaning |
|---|---|---|:---:|---|
| `models` | array | `[]` | Routes to rewrite; each item is `{ provider, model, mode, summary }`. **An empty list is the only off switch**. |
| `models[].provider` | string | none | Provider id, character-for-character identical to the catalog. |
| `models[].model` | string | none | Model id, likewise exact. |
| `models[].mode` | `standard` \| `pro` | `standard` | Written to `reasoning.mode`. |
| `models[].summary` | `auto` \| `concise` \| `detailed` | `auto` | Written to `reasoning.summary`. |

- `provider` and `model` must match **together**; the same model under another provider does not hit that route.
- A missing or invalid `mode` / `summary` is normalized back to `standard` / `auto` when read and never fails loading; identical `provider`+`model` duplicates are removed.
- An entry with a mistyped id raises no error; it simply never applies (checking boxes in the configuration page avoids typos).
- Saved routes that are absent from the catalog stay listed under "saved but currently unavailable"; manual unchecking and saving removes them.

## Compatibility

Tested with **DSH v0.2.0-rc.2** (2026-09).

## License

MIT
