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
import z from '@deepseek-ai/schemastery';
export const name = 'reasoning-mode';
const ModeSchema = z.union([z.const('standard'), z.const('pro')]);
const SummarySchema = z.union([z.const('auto'), z.const('concise'), z.const('detailed')]);
const ModelSettingsSchema = z.object({
    provider: z.string().min(1).required(),
    model: z.string().min(1).required(),
    mode: ModeSchema.default('standard'),
    summary: SummarySchema.default('auto'),
});
function routeKey(route) {
    return `${route.provider}\u0000${route.model}`;
}
/**
 * The profile entry's configuration. `models` is volatile, so the loader hands
 * `apply` one stable reference and updates its value in place when the settings
 * page writes; the running plugin therefore reads the live list rather than a
 * value captured once at apply time.
 */
export const Config = z.object({
    models: z.array(ModelSettingsSchema).default([]).volatile(),
});
/**
 * Normalize a stored route list: drop entries that name no provider or model,
 * collapse repeated exact routes, and coerce an unusable enum back to its default.
 */
export function normalizeModels(value) {
    const models = [];
    const seen = new Set();
    for (const model of Array.isArray(value) ? value : []) {
        if (!isRecord(model))
            continue;
        const { provider, model: id } = model;
        if (typeof provider !== 'string' || typeof id !== 'string' || !provider || !id)
            continue;
        const key = routeKey({ provider, model: id });
        if (seen.has(key))
            continue;
        seen.add(key);
        models.push({
            provider,
            model: id,
            mode: model.mode === 'pro' ? 'pro' : 'standard',
            summary: model.summary === 'concise' || model.summary === 'detailed' ? model.summary : 'auto',
        });
    }
    return models;
}
function settingsByRoute(models) {
    const result = new Map();
    for (const model of models ?? []) {
        result.set(routeKey(model), { mode: model.mode, summary: model.summary });
    }
    return result;
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Apply only the plugin-owned reasoning fields and retain every other field. */
export function applyReasoningBody(body, selection) {
    const existing = isRecord(body.reasoning) ? body.reasoning : {};
    return {
        ...body,
        reasoning: {
            ...existing,
            mode: selection.mode,
            summary: selection.summary,
        },
    };
}
/**
 * The distinct routes observed for `model`, in first-seen order. Routes that
 * differ only by provider stay separate — whether that is ambiguous depends on
 * whether request affinity narrowed the set first, which the caller knows and
 * this function does not.
 */
export function sameModelRoutes(candidates, model) {
    const distinct = new Map();
    for (const candidate of candidates) {
        if (candidate.model !== model)
            continue;
        distinct.set(routeKey(candidate), candidate);
    }
    return [...distinct.values()];
}
function requestUrl(input) {
    if (typeof input === 'string')
        return input;
    if (input !== null && typeof input === 'object' && typeof input.url === 'string') {
        return input.url;
    }
    return undefined;
}
function requestMethod(input, init) {
    if (isRecord(init) && typeof init.method === 'string')
        return init.method.toUpperCase();
    if (input !== null && typeof input === 'object' && typeof input.method === 'string') {
        return input.method.toUpperCase();
    }
    return 'GET';
}
function headerValue(headers, wanted) {
    if (headers !== null && typeof headers === 'object') {
        const getter = headers.get;
        if (typeof getter === 'function') {
            try {
                const value = getter.call(headers, wanted);
                if (typeof value === 'string' && value)
                    return value;
            }
            catch {
                return undefined;
            }
        }
        if (Array.isArray(headers)) {
            for (const entry of headers) {
                if (!Array.isArray(entry) || entry.length < 2)
                    continue;
                if (String(entry[0]).toLowerCase() === wanted)
                    return String(entry[1]);
            }
            return undefined;
        }
        for (const [key, value] of Object.entries(headers)) {
            if (key.toLowerCase() === wanted && typeof value === 'string' && value)
                return value;
        }
    }
    return undefined;
}
function requestHeader(input, init, name) {
    const initHeaders = isRecord(init) ? init.headers : undefined;
    return headerValue(initHeaders, name) ?? (input !== null && typeof input === 'object'
        ? headerValue(input.headers, name)
        : undefined);
}
export function isResponsesRequest(url, method) {
    if (method !== 'POST')
        return false;
    try {
        return /\/responses\/?$/.test(new URL(url).pathname);
    }
    catch {
        return /\/responses\/?(?:\?.*)?$/.test(url);
    }
}
const decodeText = new TextDecoder();
/** The body text of a fetch request, for the two shapes this boundary can see. */
function decodeBody(value) {
    if (typeof value === 'string')
        return value;
    if (value instanceof Uint8Array)
        return decodeText.decode(value);
    if (value instanceof ArrayBuffer)
        return decodeText.decode(new Uint8Array(value));
    return undefined;
}
function addHeaderEntries(target, headers) {
    if (headers === null || typeof headers !== 'object')
        return;
    const objectHeaders = headers;
    if (typeof objectHeaders.forEach === 'function' && !Array.isArray(headers)) {
        objectHeaders.forEach((value, key) => {
            if (typeof key === 'string' && typeof value === 'string')
                target.set(key.toLowerCase(), value);
        });
        return;
    }
    if (Array.isArray(headers)) {
        for (const entry of headers) {
            if (!Array.isArray(entry) || entry.length < 2)
                continue;
            const key = String(entry[0]).toLowerCase();
            target.set(key, String(entry[1]));
        }
        return;
    }
    for (const [key, value] of Object.entries(headers)) {
        if (typeof value === 'string')
            target.set(key.toLowerCase(), value);
    }
}
function effectiveHeaders(input, init) {
    const result = new Map();
    if (input !== null && typeof input === 'object') {
        addHeaderEntries(result, input.headers);
    }
    if (isRecord(init))
        addHeaderEntries(result, init.headers);
    result.delete('content-length');
    return Object.fromEntries(result);
}
/**
 * The body text of the request, or `undefined` when this boundary cannot read
 * it. A `Request` whose body was already consumed makes `clone()` throw and a
 * decoded body can throw too, so this may REJECT: the caller treats any error
 * from here as "not our request" and forwards it untouched, and catching the
 * same failure inside as well would only be a second catch for one job.
 */
async function requestBody(input, init) {
    if (isRecord(init) && init.body !== undefined)
        return decodeBody(init.body);
    if (input === null || typeof input !== 'object')
        return undefined;
    const request = input;
    if (typeof request.clone !== 'function')
        return undefined;
    const clone = request.clone();
    if (typeof clone.text !== 'function')
        return undefined;
    return await clone.text();
}
function inheritedRequestInit(request) {
    const result = {};
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
    ]) {
        const value = request[field];
        if (value !== undefined)
            result[field] = value;
    }
    return result;
}
function rebuildRequestInput(input, init, body) {
    const initRecord = isRecord(init) ? init : {};
    if (input !== null && typeof input === 'object') {
        const request = input;
        const RequestConstructor = globalThis.Request;
        if (typeof RequestConstructor !== 'function')
            return undefined;
        try {
            return {
                input: new RequestConstructor(input, {
                    ...inheritedRequestInit(request),
                    ...initRecord,
                    headers: effectiveHeaders(input, init),
                    body,
                }),
            };
        }
        catch {
            return undefined;
        }
    }
    if (!isRecord(init))
        return undefined;
    return { input, init: { ...initRecord, headers: effectiveHeaders(input, init), body } };
}
/**
 * Remembers the routes of the LLM streams that are in flight, so the fetch
 * boundary can tell which provider a request belongs to. It deliberately says
 * nothing about the configuration: the boundary re-reads the live settings per
 * request, so a configured-route filter here would be a second gate on the same
 * map — one that could never change the outcome, since the caller looks the
 * selection up again and forwards the request when it is absent.
 */
function createRequestTracker() {
    let nextId = 0;
    const active = new Map();
    return {
        add(route) {
            const item = { ...route, id: ++nextId };
            active.set(item.id, item);
            return () => active.delete(item.id);
        },
        resolve(sessionId, model) {
            const observed = sessionId === undefined
                ? [...active.values()]
                : [...active.values()].filter((item) => item.sessionId === sessionId);
            const candidates = sameModelRoutes(observed, model);
            const ambiguousWithoutAffinity = sessionId === undefined && candidates.length > 1;
            const route = ambiguousWithoutAffinity || candidates.length !== 1 ? undefined : candidates[0];
            return { route, ambiguousWithoutAffinity, candidates };
        },
    };
}
const FETCH_STATE_KEY = Symbol.for('deepseek-harness.reasoning-mode.fetch-state');
function installFetchWrapper(tracker, getSettings, reportAmbiguous) {
    const host = globalThis;
    const previous = host[FETCH_STATE_KEY];
    previous?.restore();
    const original = host.fetch;
    if (typeof original !== 'function')
        return () => { };
    const wrapper = async function (input, init) {
        const url = requestUrl(input);
        if (url === undefined || !isResponsesRequest(url, requestMethod(input, init))) {
            return original.call(this, input, init);
        }
        const contentEncoding = requestHeader(input, init, 'content-encoding');
        if (contentEncoding !== undefined && contentEncoding.toLowerCase() !== 'identity') {
            return original.call(this, input, init);
        }
        const contentType = requestHeader(input, init, 'content-type');
        if (contentType !== undefined && !contentType.toLowerCase().includes('json')) {
            return original.call(this, input, init);
        }
        let text;
        try {
            text = await requestBody(input, init);
        }
        catch {
            return original.call(this, input, init);
        }
        if (text === undefined)
            return original.call(this, input, init);
        let body;
        try {
            body = JSON.parse(text);
        }
        catch {
            return original.call(this, input, init);
        }
        // Type narrowing, not a behaviour gate: a body without a string `model` can
        // never match an active route, so the lookup below would find nothing and
        // forward the request anyway. This is what type-checks the `model` passed on.
        if (!isRecord(body) || typeof body.model !== 'string') {
            return original.call(this, input, init);
        }
        // pi-ai names the session-affinity header by format (`openai-responses.js`
        // near `sessionAffinityFormat`): the OpenAI format sends `session_id` and
        // `x-client-request-id`, OpenRouter's sends `x-session-id` alone. Accepting
        // all three keeps the association working when a route uses either format;
        // a value that matches no active request simply resolves to no route.
        const affinity = requestHeader(input, init, 'x-client-request-id')
            ?? requestHeader(input, init, 'session_id')
            ?? requestHeader(input, init, 'x-session-id');
        const resolution = tracker.resolve(affinity, body.model);
        if (resolution.ambiguousWithoutAffinity) {
            reportAmbiguous(body.model, resolution.candidates);
            return original.call(this, input, init);
        }
        const route = resolution.route;
        if (route === undefined)
            return original.call(this, input, init);
        const selection = getSettings().get(routeKey(route));
        if (selection === undefined)
            return original.call(this, input, init);
        const nextBody = applyReasoningBody(body, selection);
        const rebuilt = rebuildRequestInput(input, init, JSON.stringify(nextBody));
        if (rebuilt === undefined)
            return original.call(this, input, init);
        return original.call(this, rebuilt.input, rebuilt.init);
    };
    host.fetch = wrapper;
    const state = {
        restore: () => {
            if (host.fetch === wrapper)
                host.fetch = original;
            if (host[FETCH_STATE_KEY] === state)
                delete host[FETCH_STATE_KEY];
        },
    };
    host[FETCH_STATE_KEY] = state;
    return () => {
        if (host[FETCH_STATE_KEY] === state)
            state.restore();
    };
}
export const inject = [];
export function apply(ctx, config) {
    // Read the volatile reference on every request: that is what makes a saved
    // edit effective without re-applying the plugin, and it replaces the
    // settings subscription this plugin used before the loader owned live config.
    const getSettings = () => settingsByRoute(normalizeModels(config.models.get()));
    const reportedAmbiguities = new Set();
    const reportAmbiguous = (model, candidates) => {
        const routes = [...candidates]
            .sort((left, right) => routeKey(left).localeCompare(routeKey(right)))
            .map((candidate) => `${candidate.provider}/${candidate.model}`);
        const ambiguityKey = `${model}\u0000${routes.join('\u0000')}`;
        if (reportedAmbiguities.has(ambiguityKey))
            return;
        reportedAmbiguities.add(ambiguityKey);
        ctx.logger?.warn(`reasoning-mode: skipped Responses rewrite because provider identity is ambiguous for model "${model}" across active routes: ${routes.join(', ')}; request affinity is required`);
    };
    const tracker = createRequestTracker();
    ctx.on('llm/stream', (options, next) => {
        if (options?.purpose !== undefined
            || typeof options?.sessionId !== 'string'
            || typeof options?.provider !== 'string'
            || typeof options?.model !== 'string') {
            return next();
        }
        const remove = tracker.add({
            sessionId: options.sessionId,
            provider: options.provider,
            model: options.model,
        });
        let stream;
        try {
            stream = next();
        }
        catch (error) {
            remove();
            throw error;
        }
        return (async function* () {
            try {
                for await (const chunk of stream)
                    yield chunk;
            }
            finally {
                remove();
            }
        })();
    }, { prepend: true });
    ctx.effect(() => installFetchWrapper(tracker, getSettings, reportAmbiguous), 'reasoning-mode: Responses fetch wrapper');
}
