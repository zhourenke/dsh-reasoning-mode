/**
 * @zhourenke/dsh-reasoning-mode
 *
 * Configures the `reasoning.mode` and `reasoning.summary` fields of OpenAI
 * Responses requests for explicitly enabled provider/model routes. The host
 * half owns the durable route selection — the profile entry's own `models`
 * configuration, declared as a volatile schema so the running plugin reads the
 * live value the settings form wrote — and wraps the final Host `fetch`
 * boundary, associating each request with the exact provider/model observed
 * through Responses session affinity. The browser half (src/client.ts)
 * provides the configuration page of that row and the composer control in
 * `conversation.input.right`.
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'

export const name = 'reasoning-mode'

export type ReasoningMode = 'standard' | 'pro'
export type ReasoningSummary = 'auto' | 'concise' | 'detailed'

export interface ModelSettings {
  provider: string
  model: string
  mode: ReasoningMode
  summary: ReasoningSummary
}

export interface ReasoningSelection {
  mode: ReasoningMode
  summary: ReasoningSummary
}

export interface RequestRoute {
  provider: string
  model: string
}

const ModeSchema = z.union([z.const('standard'), z.const('pro')])
const SummarySchema = z.union([z.const('auto'), z.const('concise'), z.const('detailed')])
const ModelSettingsSchema = z.object({
  provider: z.string().min(1).required(),
  model: z.string().min(1).required(),
  mode: ModeSchema.default('standard'),
  summary: SummarySchema.default('auto'),
})

function routeKey(route: RequestRoute): string {
  return `${route.provider}\u0000${route.model}`
}

/**
 * The profile entry's configuration. `models` is volatile, so the loader hands
 * `apply` one stable reference and updates its value in place when the settings
 * page writes; the running plugin therefore reads the live list rather than a
 * value captured once at apply time.
 */
export const Config = z.object({
  models: z.array(ModelSettingsSchema).default([]).volatile(),
}) as unknown as ReturnType<typeof z.any>

/** The resolved shape the loader passes to {@link apply}. */
export interface PluginConfig {
  models: Volatile<ModelSettings[]>
}

/**
 * Normalize a stored route list: drop entries that name no provider or model,
 * collapse repeated exact routes, and coerce an unusable enum back to its default.
 */
export function normalizeModels(value: unknown): ModelSettings[] {
  const models: ModelSettings[] = []
  const seen = new Set<string>()
  for (const model of Array.isArray(value) ? value : []) {
    if (!isRecord(model)) continue
    const { provider, model: id } = model
    if (typeof provider !== 'string' || typeof id !== 'string' || !provider || !id) continue
    const key = routeKey({ provider, model: id })
    if (seen.has(key)) continue
    seen.add(key)
    models.push({
      provider,
      model: id,
      mode: model.mode === 'pro' ? 'pro' : 'standard',
      summary: model.summary === 'concise' || model.summary === 'detailed' ? model.summary : 'auto',
    })
  }
  return models
}

function settingsByRoute(models: readonly ModelSettings[] | undefined): Map<string, ReasoningSelection> {
  const result = new Map<string, ReasoningSelection>()
  for (const model of models ?? []) {
    result.set(routeKey(model), { mode: model.mode, summary: model.summary })
  }
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Apply only the plugin-owned reasoning fields and retain every other field. */
export function applyReasoningBody(
  body: Record<string, unknown>,
  selection: ReasoningSelection,
): Record<string, unknown> {
  const existing = isRecord(body.reasoning) ? body.reasoning : {}
  return {
    ...body,
    reasoning: {
      ...existing,
      mode: selection.mode,
      summary: selection.summary,
    },
  }
}

/**
 * The distinct routes observed for `model`, in first-seen order. Routes that
 * differ only by provider stay separate — whether that is ambiguous depends on
 * whether request affinity narrowed the set first, which the caller knows and
 * this function does not.
 */
export function sameModelRoutes(candidates: readonly RequestRoute[], model: string): RequestRoute[] {
  const distinct = new Map<string, RequestRoute>()
  for (const candidate of candidates) {
    if (candidate.model !== model) continue
    distinct.set(routeKey(candidate), candidate)
  }
  return [...distinct.values()]
}

function requestUrl(input: unknown): string | undefined {
  if (typeof input === 'string') return input
  if (input !== null && typeof input === 'object' && typeof (input as { url?: unknown }).url === 'string') {
    return (input as { url: string }).url
  }
  return undefined
}

function requestMethod(input: unknown, init: unknown): string {
  if (isRecord(init) && typeof init.method === 'string') return init.method.toUpperCase()
  if (input !== null && typeof input === 'object' && typeof (input as { method?: unknown }).method === 'string') {
    return (input as { method: string }).method.toUpperCase()
  }
  return 'GET'
}

function headerValue(headers: unknown, wanted: string): string | undefined {
  if (headers !== null && typeof headers === 'object') {
    const getter = (headers as { get?: unknown }).get
    if (typeof getter === 'function') {
      try {
        const value = (getter as (name: string) => unknown).call(headers, wanted)
        if (typeof value === 'string' && value) return value
      } catch {
        return undefined
      }
    }
    if (Array.isArray(headers)) {
      for (const entry of headers) {
        if (!Array.isArray(entry) || entry.length < 2) continue
        if (String(entry[0]).toLowerCase() === wanted) return String(entry[1])
      }
      return undefined
    }
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === wanted && typeof value === 'string' && value) return value
    }
  }
  return undefined
}

function requestHeader(input: unknown, init: unknown, name: string): string | undefined {
  const initHeaders = isRecord(init) ? init.headers : undefined
  return headerValue(initHeaders, name) ?? (
    input !== null && typeof input === 'object'
      ? headerValue((input as { headers?: unknown }).headers, name)
      : undefined
  )
}

export function isResponsesRequest(url: string, method: string): boolean {
  if (method !== 'POST') return false
  try {
    return /\/responses\/?$/.test(new URL(url).pathname)
  } catch {
    return /\/responses\/?(?:\?.*)?$/.test(url)
  }
}

interface RequestLike {
  readonly url?: unknown
  readonly method?: unknown
  readonly headers?: unknown
  readonly cache?: unknown
  readonly credentials?: unknown
  readonly integrity?: unknown
  readonly keepalive?: unknown
  readonly mode?: unknown
  readonly redirect?: unknown
  readonly referrer?: unknown
  readonly referrerPolicy?: unknown
  readonly signal?: unknown
  readonly duplex?: unknown
  readonly priority?: unknown
  readonly attributionReporting?: unknown
  readonly browsingTopics?: unknown
  clone?: () => RequestLike
  text?: () => Promise<string>
}

const decodeText = new TextDecoder()

/** The body text of a fetch request, for the two shapes this boundary can see. */
function decodeBody(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return decodeText.decode(value)
  if (value instanceof ArrayBuffer) return decodeText.decode(new Uint8Array(value))
  return undefined
}

function addHeaderEntries(target: Map<string, string>, headers: unknown): void {
  if (headers === null || typeof headers !== 'object') return
  const objectHeaders = headers as {
    forEach?: (callback: (value: unknown, key: unknown) => void) => void
  }
  if (typeof objectHeaders.forEach === 'function' && !Array.isArray(headers)) {
    objectHeaders.forEach((value, key) => {
      if (typeof key === 'string' && typeof value === 'string') target.set(key.toLowerCase(), value)
    })
    return
  }
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (!Array.isArray(entry) || entry.length < 2) continue
      const key = String(entry[0]).toLowerCase()
      target.set(key, String(entry[1]))
    }
    return
  }
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') target.set(key.toLowerCase(), value)
  }
}

function effectiveHeaders(input: unknown, init: unknown): Record<string, string> {
  const result = new Map<string, string>()
  if (input !== null && typeof input === 'object') {
    addHeaderEntries(result, (input as RequestLike).headers)
  }
  if (isRecord(init)) addHeaderEntries(result, init.headers)
  result.delete('content-length')
  return Object.fromEntries(result)
}

async function requestBody(input: unknown, init: unknown): Promise<string | undefined> {
  if (isRecord(init) && init.body !== undefined) return decodeBody(init.body)
  if (input === null || typeof input !== 'object') return undefined
  const request = input as RequestLike
  if (typeof request.clone !== 'function') return undefined
  try {
    const clone = request.clone()
    if (typeof clone.text !== 'function') return undefined
    return await clone.text()
  } catch {
    return undefined
  }
}

function inheritedRequestInit(request: RequestLike): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const field of [
    'cache',
    'credentials',
    'integrity',
    'keepalive',
    'mode',
    'redirect',
    'referrer',
    'referrerPolicy',
    'signal',
    'duplex',
    'priority',
    'attributionReporting',
    'browsingTopics',
  ] as const) {
    const value = request[field]
    if (value !== undefined) result[field] = value
  }
  return result
}

function rebuildRequestInput(input: unknown, init: unknown, body: string): {
  input: unknown
  init?: unknown
} | undefined {
  const initRecord = isRecord(init) ? init : {}
  if (input !== null && typeof input === 'object') {
    const request = input as RequestLike
    const RequestConstructor = (globalThis as unknown as {
      Request?: new (input: unknown, init?: unknown) => unknown
    }).Request
    if (typeof RequestConstructor !== 'function') return undefined
    try {
      return {
        input: new RequestConstructor(input, {
          ...inheritedRequestInit(request),
          ...initRecord,
          headers: effectiveHeaders(input, init),
          body,
        }),
      }
    } catch {
      return undefined
    }
  }
  if (!isRecord(init)) return undefined
  return { input, init: { ...initRecord, headers: effectiveHeaders(input, init), body } }
}

type FetchLike = (input: unknown, init?: unknown) => Promise<unknown>

type ActiveRequest = RequestRoute & {
  id: number
  sessionId: string
}

type RouteResolution = {
  route: RequestRoute | undefined
  ambiguousWithoutAffinity: boolean
  candidates: readonly RequestRoute[]
}

function createRequestTracker(getSettings: () => Map<string, ReasoningSelection>): {
  add(route: RequestRoute & { sessionId: string }): () => void
  resolve(sessionId: string | undefined, model: string): RouteResolution
} {
  let nextId = 0
  const active = new Map<number, ActiveRequest>()

  return {
    add(route) {
      const item: ActiveRequest = { ...route, id: ++nextId }
      active.set(item.id, item)
      return () => active.delete(item.id)
    },
    resolve(sessionId, model) {
      const observed = sessionId === undefined
        ? [...active.values()]
        : [...active.values()].filter((item) => item.sessionId === sessionId)
      const candidates = sameModelRoutes(observed, model)
      const ambiguousWithoutAffinity = sessionId === undefined && candidates.length > 1
      const only = candidates.length === 1 ? candidates[0] : undefined
      const route = only !== undefined && getSettings().has(routeKey(only)) ? only : undefined
      return { route, ambiguousWithoutAffinity, candidates }
    },
  }
}

const FETCH_STATE_KEY = Symbol.for('deepseek-harness.reasoning-mode.fetch-state')

interface FetchState {
  restore: () => void
}

function installFetchWrapper(
  tracker: ReturnType<typeof createRequestTracker>,
  getSettings: () => Map<string, ReasoningSelection>,
  reportAmbiguous: (model: string, candidates: readonly RequestRoute[]) => void,
): () => void {
  const host = globalThis as unknown as { fetch?: FetchLike; [key: symbol]: unknown }
  const previous = host[FETCH_STATE_KEY] as FetchState | undefined
  previous?.restore()

  const original = host.fetch
  if (typeof original !== 'function') return () => {}

  const wrapper: FetchLike = async function (this: unknown, input: unknown, init?: unknown): Promise<unknown> {
    const url = requestUrl(input)
    if (url === undefined || !isResponsesRequest(url, requestMethod(input, init))) {
      return original.call(this, input, init)
    }

    const contentEncoding = requestHeader(input, init, 'content-encoding')
    if (contentEncoding !== undefined && contentEncoding.toLowerCase() !== 'identity') {
      return original.call(this, input, init)
    }
    const contentType = requestHeader(input, init, 'content-type')
    if (contentType !== undefined && !contentType.toLowerCase().includes('json')) {
      return original.call(this, input, init)
    }

    let text: string | undefined
    try {
      text = await requestBody(input, init)
    } catch {
      return original.call(this, input, init)
    }
    if (text === undefined) return original.call(this, input, init)

    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return original.call(this, input, init)
    }
    if (!isRecord(body) || typeof body.model !== 'string') {
      return original.call(this, input, init)
    }

    // pi-ai names the session-affinity header by format (`openai-responses.js`
    // near `sessionAffinityFormat`): the OpenAI format sends `session_id` and
    // `x-client-request-id`, OpenRouter's sends `x-session-id` alone. Accepting
    // all three keeps the association working when a route uses either format;
    // a value that matches no active request simply resolves to no route.
    const affinity = requestHeader(input, init, 'x-client-request-id')
      ?? requestHeader(input, init, 'session_id')
      ?? requestHeader(input, init, 'x-session-id')
    const resolution = tracker.resolve(affinity, body.model)
    if (resolution.ambiguousWithoutAffinity) {
      reportAmbiguous(body.model, resolution.candidates)
      return original.call(this, input, init)
    }
    const route = resolution.route
    if (route === undefined) return original.call(this, input, init)
    const selection = getSettings().get(routeKey(route))
    if (selection === undefined) return original.call(this, input, init)

    const nextBody = applyReasoningBody(body, selection)
    const rebuilt = rebuildRequestInput(input, init, JSON.stringify(nextBody))
    if (rebuilt === undefined) return original.call(this, input, init)
    return original.call(this, rebuilt.input, rebuilt.init)
  }

  host.fetch = wrapper
  const state: FetchState = {
    restore: () => {
      if (host.fetch === wrapper) host.fetch = original
      if (host[FETCH_STATE_KEY] === state) delete host[FETCH_STATE_KEY]
    },
  }
  host[FETCH_STATE_KEY] = state
  return () => {
    if (host[FETCH_STATE_KEY] === state) state.restore()
  }
}

export const inject: string[] = []

export function apply(ctx: Context, config: PluginConfig): void {
  // Read the volatile reference on every request: that is what makes a saved
  // edit effective without re-applying the plugin, and it replaces the
  // settings subscription this plugin used before the loader owned live config.
  const getSettings = (): Map<string, ReasoningSelection> => settingsByRoute(normalizeModels(config.models.get()))

  const reportedAmbiguities = new Set<string>()
  const reportAmbiguous = (model: string, candidates: readonly RequestRoute[]) => {
    const routes = [...candidates]
      .sort((left, right) => routeKey(left).localeCompare(routeKey(right)))
      .map((candidate) => `${candidate.provider}/${candidate.model}`)
    const ambiguityKey = `${model}\u0000${routes.join('\u0000')}`
    if (reportedAmbiguities.has(ambiguityKey)) return
    reportedAmbiguities.add(ambiguityKey)
    ctx.logger?.warn(
      `reasoning-mode: skipped Responses rewrite because provider identity is ambiguous for model "${model}" across active routes: ${routes.join(', ')}; request affinity is required`,
    )
  }

  const tracker = createRequestTracker(getSettings)
  ctx.on('llm/stream', (options: any, next: () => AsyncIterable<any>) => {
    if (
      options?.purpose !== undefined
      || typeof options?.sessionId !== 'string'
      || typeof options?.provider !== 'string'
      || typeof options?.model !== 'string'
    ) {
      return next()
    }

    const remove = tracker.add({
      sessionId: options.sessionId,
      provider: options.provider,
      model: options.model,
    })
    let stream: AsyncIterable<any>
    try {
      stream = next()
    } catch (error) {
      remove()
      throw error
    }
    return (async function* (): AsyncIterable<any> {
      try {
        for await (const chunk of stream) yield chunk
      } finally {
        remove()
      }
    })()
  }, { prepend: true })

  ctx.effect(
    () => installFetchWrapper(tracker, getSettings, reportAmbiguous),
    'reasoning-mode: Responses fetch wrapper',
  )
}
