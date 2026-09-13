/**
 * @zhourenke/dsh-reasoning-mode
 *
 * Configures the `reasoning.mode` and `reasoning.summary` fields of OpenAI
 * Responses requests for explicitly enabled provider/model routes. The host
 * half owns the durable model selection (a settings namespace limited to
 * `models`) and wraps the final Host `fetch` boundary, associating each
 * request with the exact provider/model observed through Responses session
 * affinity. The browser half (src/client.ts) provides the checkbox-only
 * settings card and the composer control in `conversation.input.right`.
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "reasoning-mode";
export declare const SETTINGS_NAMESPACE = "reasoning-mode";
export type ReasoningMode = 'standard' | 'pro';
export type ReasoningSummary = 'auto' | 'concise' | 'detailed';
export interface ModelSettings {
    provider: string;
    model: string;
    mode: ReasoningMode;
    summary: ReasoningSummary;
}
export interface ReasoningModeConfig {
    /** Presence in this list means the exact provider/model route is enabled. */
    models: ModelSettings[];
}
export interface ReasoningSelection {
    mode: ReasoningMode;
    summary: ReasoningSummary;
}
export interface RequestRoute {
    provider: string;
    model: string;
}
export declare function routeKey(route: RequestRoute): string;
export declare const Config: ReturnType<typeof z.any>;
/** Apply only the plugin-owned reasoning fields and retain every other field. */
export declare function applyReasoningBody(body: Record<string, unknown>, selection: ReasoningSelection): Record<string, unknown>;
/**
 * Return one route only when all active candidates agree on provider and model.
 * Different providers with the same model are deliberately ambiguous.
 */
export declare function resolveRouteCandidate(candidates: readonly RequestRoute[], model: string): RequestRoute | undefined;
declare function isResponsesRequest(url: string, method: string): boolean;
export declare const inject: string[];
export declare function apply(ctx: Context): void;
export { isResponsesRequest };
