# @zhourenke/dsh-reasoning-mode

Configures the `reasoning.mode` and `reasoning.summary` fields of OpenAI Responses requests for explicitly enabled provider/model routes.

The Host half registers the independent `reasoning-mode` settings namespace and wraps the final Host `fetch` boundary. It associates a request with the exact `provider/model` observed by the `llm/stream` waterfall through the Responses session-affinity header. When several active routes could explain the same request, the wrapper leaves the request unchanged.

The Web half contributes a Subagent-style card under Settings > Plugins > Plugin configuration and a compact Standard/Pro plus summary-level menu in the composer's right-side `conversation.input.right` slot. The control sits after the model selector and before the context meter, uses the model selector's trigger/menu geometry, and renders both values with the reasoning-level typography. Its root rows follow the official selector layout: labels stay on the left, current values are right-aligned in tertiary text, and the chevrons use the same tertiary treatment. Selecting a row opens a flat option list without a title or back row; Escape returns to the root menu or closes it. Composer changes update the selected route's persistent settings.

Defaults are disabled: an empty `models` list changes no requests. Existing `reasoning` fields, including adapter-owned `effort`, are retained.
