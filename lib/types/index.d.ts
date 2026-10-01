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
import type { Context, Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "reasoning-mode";
export type ReasoningMode = 'standard' | 'pro';
export type ReasoningSummary = 'auto' | 'concise' | 'detailed';
export interface ModelSettings {
    provider: string;
    model: string;
    mode: ReasoningMode;
    summary: ReasoningSummary;
}
export interface ReasoningSelection {
    mode: ReasoningMode;
    summary: ReasoningSummary;
}
export interface RequestRoute {
    provider: string;
    model: string;
}
/**
 * The profile entry's configuration. `models` is volatile, so the loader hands
 * `apply` one stable reference and updates its value in place when the settings
 * page writes; the running plugin therefore reads the live list rather than a
 * value captured once at apply time.
 */
export declare const Config: ReturnType<typeof z.any>;
/** The resolved shape the loader passes to {@link apply}. */
export interface PluginConfig {
    models: Volatile<ModelSettings[]>;
}
/**
 * Normalize a stored route list: drop entries that name no provider or model,
 * collapse repeated exact routes, and coerce an unusable enum back to its default.
 */
export declare function normalizeModels(value: unknown): ModelSettings[];
/** Apply only the plugin-owned reasoning fields and retain every other field. */
export declare function applyReasoningBody(body: Record<string, unknown>, selection: ReasoningSelection): Record<string, unknown>;
/**
 * The distinct routes observed for `model`, in first-seen order. Routes that
 * differ only by provider stay separate — whether that is ambiguous depends on
 * whether request affinity narrowed the set first, which the caller knows and
 * this function does not.
 */
export declare function sameModelRoutes(candidates: readonly RequestRoute[], model: string): RequestRoute[];
export declare function isResponsesRequest(url: string, method: string): boolean;
export declare const inject: string[];
export declare function apply(ctx: Context, config: PluginConfig): void;
