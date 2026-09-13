**English** | [中文](README.md)

# @zhourenke/dsh-reasoning-mode

**Set the reasoning mode and summary level of Responses requests for chosen provider/model routes.**

Some routes speak the OpenAI Responses API (`POST …/responses`), whose body accepts `reasoning.mode` (Standard / Pro) and `reasoning.summary` (Auto / Concise / Detailed) to control how much the model reasons and whether it returns a thinking summary. DSH has its own adapter-provided `reasoningEffort` (the selectable effort per model), but it offers no per-route entry point for those two Responses fields; this plugin adds one: it rewrites **only the routes you check**, and leaves every other request untouched.

> ⚠️ **Weigh the tradeoff first:** `Pro` and `Detailed` usually mean longer reasoning and more tokens, `Concise` the opposite. The plugin only delivers the values you pick; the choice is yours.

## What it solves

- **Per-route reasoning strength**: when the same model sits under several providers, routes match on `provider` + `model` exactly and do not affect each other.
- **Adjustable summary level**: `Auto` lets the model decide, `Concise` / `Detailed` force it shorter or longer.
- **No collateral rewriting**: only `reasoning.mode` and `reasoning.summary` are written; every other field under `reasoning` (such as the adapter's own `effort`) is preserved.
- **Removable at any time**: it installs as a profile layer and never modifies DSH itself; clearing the checks turns it off completely.
- **Only the route it can identify**: when the provider behind a request cannot be determined, the plugin leaves the request alone instead of guessing.

## Prerequisites

- DSH **v0.1.5-rc.1** (2026-09 baseline).
- At least one provider route that speaks OpenAI Responses; routes that only speak Chat Completions are neither affected nor rewritten.

Confirm the plugin is installed as a profile layer:

```powershell
$dshHome = $env:DSH_HOME; if (-not $dshHome) { $dshHome = "$env:USERPROFILE\.dsh" }
Select-String -Path "$dshHome\profiles\web\package.json" -Pattern 'dsh-reasoning-mode'
```

Any output means it is installed as a profile layer (one entry in `dsh.profile.bundles`; a normal `dsh plugin add` install also adds one under `dependencies`, while a development junction mount only has the former).

## Installation

```powershell
dsh plugin --profile web add "github:zhourenke/dsh-reasoning-mode"
```

After installing, **restart DSH and refresh the page**; the card then appears under **Settings → Plugins → Reasoning mode**.

Uninstall:

```powershell
dsh plugin --profile web remove @zhourenke/dsh-reasoning-mode
```

## Quick start

1. Open **Settings → Plugins → Reasoning mode**, check the `provider/model` routes this plugin should rewrite, and click **Save**.
2. Open a conversation and switch the model to one of the checked routes; a control reading `Standard · Auto` appears next to the model selector in the composer.
3. Pick the **reasoning mode** and the **summary level** in that control; the choice applies immediately with no further save.

A newly checked route starts at `Standard` + `Auto`; unchecking a route and checking it again keeps the mode and summary level you had set.

You can also edit `~/.dsh/settings.yaml` directly (**overriding** the `reasoning-mode` namespace rather than adding another entry):

```yaml
# ~/.dsh/settings.yaml
reasoning-mode:
  models:
    - provider: <provider-id>
      model: <model-id>
      mode: pro
      summary: detailed
```

`provider` and `model` must match the ids in DSH character for character, and both must match; a mistyped entry does not raise an error, it simply never applies (checking boxes in the settings card avoids typos).

**Configuration applies as soon as it is saved — no restart and no page refresh.** Only installing or upgrading, which replaces the plugin's own code, needs a restart.

## Configuration

The plugin owns exactly one top-level key in `~/.dsh/settings.yaml`, `reasoning-mode`:

| Field | Type | Default | Meaning |
|---|---|:---:|---|
| `models` | array | `[]` | Routes to rewrite; each item is `{ provider, model, mode, summary }`. **An empty list is the only off switch**, and it is the default. |
| `models[].provider` | string | none | Provider id, character-for-character identical to the catalog. |
| `models[].model` | string | none | Model id, likewise exact. |
| `models[].mode` | `standard` \| `pro` | `standard` | Written to `reasoning.mode`. |
| `models[].summary` | `auto` \| `concise` \| `detailed` | `auto` | Written to `reasoning.summary`. |

- `provider` and `model` must match **together**; the same model under another provider does not hit that route.
- A missing or invalid `mode` / `summary` is normalized back to `standard` / `auto` when read and never fails loading; identical `provider`+`model` duplicates are removed.
- The settings card only touches this plugin's namespace and never DSH's general model settings.
- Saved routes that are absent from the catalog stay listed under "saved but currently unavailable" until you uncheck them and save.

## What it changes in a request

It applies only when all of the following hold; anything else is forwarded untouched:

| Condition | Value |
|---|---|
| Method | `POST` |
| Path | ends with `/responses` |
| `content-encoding` | absent or `identity` (compressed requests are not parsed) |
| `content-type` | absent or containing `json` |
| Body | a JSON object carrying a string `model` |

When those hold and the route is identified, the plugin writes your values into `reasoning.mode` and `reasoning.summary`, **keeping every other field under `reasoning`**, then rebuilds the request as-is (method, headers, cache, credentials, signal and the remaining request options are all preserved; only the stale `content-length` is dropped).

## When it stays out of the way

| Situation | What you see |
|---|---|
| The request's route is not checked | Nothing happens; the request passes through untouched |
| The same model sits under several providers and the provider cannot be determined | The request passes through untouched and the host log shows `reasoning-mode: skipped Responses rewrite because provider identity is ambiguous …` (reported once per combination) |
| The model catalog cannot be read | The card reports **The model catalog could not be loaded; saved selections were not removed.** with a **Retry** button; saved checks stay as they are |
| Settings are read-only | The card shows **Settings are read-only.** and the save button is disabled |
| `models` is empty | Fully off: no request is rewritten |

## The two entry points in the UI

**Settings card (Settings → Plugins → Reasoning mode)**: lists the live provider/model catalog in catalog order with one checkbox per row; edits stay local until you click **Save**, and **Discard changes** drops them. An **Unsaved** marker appears next to the card title while edits are pending.

**Composer control (right of the model selector)**: appears only while the current conversation's route is checked, and reads e.g. `Standard · Auto`. Opening it shows **Reasoning mode** (Standard / Pro) and **Summary level** (Auto / Concise / Detailed) submenus; picking a value writes the setting immediately, with no separate save. When the current route is not checked the control is absent — check it in the settings card first.

## Known limitations (as measured)

- **Responses requests only**: requests of other shapes, such as Chat Completions, are never rewritten.
- **Exactly two fields**: `reasoning.mode` and `reasoning.summary`; fields such as `reasoning.effort` belong to the adapter and are left alone.
- **Unparseable means untouched**: when the body is not JSON, is compressed, or carries no `model` field, the plugin skips the rewrite rather than risk rebuilding the request.
- **No guessing under ambiguity**: with several providers for one model and no session ownership information, the rewrite is skipped (real conversations carry that information, so this mostly affects non-conversation calls).
- **Installing and upgrading need a restart**: both halves load when the plugin activates, so code changes need a DSH restart plus a page refresh; configuration changes do not.
- **The settings card depends on the host's model catalog**: while the catalog is unavailable only saved routes are visible and no new route can be checked.

## Compatibility

Tested with **DSH v0.1.5-rc.1** (2026-09).

## License

MIT
