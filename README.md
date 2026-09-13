# @zhourenke/dsh-reasoning-mode

Configures the `reasoning.mode` and `reasoning.summary` fields of OpenAI Responses requests for explicitly enabled provider/model routes.

The Host half registers the independent `reasoning-mode` settings namespace and wraps the final Host `fetch` boundary. It associates a request with the exact `provider/model` observed by the `llm/stream` waterfall through Responses session affinity. When provider identity is ambiguous, the wrapper leaves the request unchanged. Existing `reasoning` fields, including adapter-owned `effort`, are retained.

## Settings

The settings value contains only enabled routes and their per-route values:

```yaml
reasoning-mode:
  models:
    - provider: cotton-codex-plus
      model: gpt-5.6-luna
      mode: pro
      summary: detailed
```

There are no global default controls. A newly checked route is stored with `standard` mode and `auto` summary. Existing per-route mode and summary values are preserved when a route is unchecked and checked again, and missing or invalid values normalize to those same fallbacks.

The Web half contributes a settings card that follows the Subagent model-selection behavior. It shows the live provider/model catalog in catalog order, uses checkbox-only rows, and keeps saved routes that are absent from the catalog in a trailing unavailable group until Save removes them. The card retains the model-selection notice that only checked `provider/model` routes change Responses requests.

Mode and summary changes are available only from the compact control in the composer's `conversation.input.right` slot. It appears after the model selector and before the context meter, and provides Standard/Pro and Auto/Concise/Detailed menus for the currently checked route. The menu follows the official nested-menu geometry and has no title or back row.

An empty `models` list changes no requests.
