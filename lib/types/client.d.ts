/**
 * Browser face for @zhourenke/dsh-reasoning-mode.
 *
 * The settings card uses the configurable-plugin slot owned by DSH's official
 * settings surface: it stages changes locally and writes only on Save, while
 * the model catalog is read live from the host API. The card chrome and the
 * model list follow the sibling cards in the same settings page —
 * `PluginCard` and `SubagentModelSelectionCard` (`dsh-client-ui-settings-
 * plugins`) — so rows are checkbox-only and routes that vanished from the
 * catalog stay listed in a trailing "saved but currently unavailable" group
 * until Save removes them. Mode and summary are adjusted per route only from
 * the compact composer control in `conversation.input.right`.
 */
interface Window {
    __ModuleLoader__: {
        load(definition: {
            id: string;
            factory: (require: (id: string) => any) => any;
        }): void;
    };
}
