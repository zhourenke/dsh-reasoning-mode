/**
 * Browser face for @zhourenke/dsh-reasoning-mode.
 *
 * Two seats, both owned by official DSH surfaces:
 *
 * - Our installed row's configuration page is `plugins.row.config`, dispatched
 *   by `<package name>#<row id>` and registered only while the Host serves the
 *   `reasoning-mode` namespace. The plugins page supplies the Host form —
 *   accepted values, the entry revision, and the revision-fenced write — and
 *   draws the frame, the save control, and the failure notice itself, so this
 *   component owns nothing but the catalog-driven route list. Changes are
 *   staged locally and committed with a single revision-fenced `models` write.
 * - Mode and summary are adjusted per route from the compact composer control in
 *   `conversation.input.right`, which reads and writes the same namespace live.
 *
 * The route list follows the sibling cards of the same surface: rows are
 * checkbox-only, and routes that vanished from the catalog stay listed in a
 * trailing "saved but currently unavailable" group until Save removes them.
 */
interface Window {
    __ModuleLoader__: {
        load(definition: {
            id: string;
            factory: (require: (id: string) => any) => any;
        }): void;
    };
}
