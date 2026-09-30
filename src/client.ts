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
    load(definition: { id: string; factory: (require: (id: string) => any) => any }): void
  }
}

window.__ModuleLoader__.load({
  id: '@zhourenke/dsh-reasoning-mode',
  factory: (require) => {
    const NS = 'reasoning-mode'
    /** Installed package name: the plugins page keys our row's page by `<package>#<row id>`. */
    const PACKAGE_NAME = '@zhourenke/dsh-reasoning-mode'
    const React: any = require('react')
    const e = React.createElement
    const { useEffect, useMemo, useState } = React
    const {
      IconCheckOutlineRegular,
      IconChevronDownOutlineRegular,
      IconChevronRightOutlineRegular,
      Menu,
      SettingsForm,
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    type Mode = 'standard' | 'pro'
    type Summary = 'auto' | 'concise' | 'detailed'
    type Route = { provider: string; model: string }
    type Selection = { provider: string; model: string; mode: Mode; summary: Summary }
    type CatalogModel = { id: string; name?: string; description?: string }
    type CatalogGroup = { id: string; name?: string; models?: CatalogModel[] }
    type CatalogResponse = {
      ok: boolean
      value?: { default: { provider: string; model: string }; groups?: CatalogGroup[] }
      error?: { code?: string; message?: string }
    }
    type SessionFace = { modelCatalog(): Promise<CatalogResponse> }
    type Snapshot = {
      status: string
      value?: { models?: Selection[] }
      writable: boolean
    }
    type Scope = {
      getSnapshot(): Snapshot
      subscribe(listener: () => void): () => void
      set(field: string, value: unknown): Promise<void>
    }
    /** The Host form the plugins page hands to our row's configuration page. */
    type ConfigPageForm = {
      state: Snapshot & { revision?: number }
      mutate(
        ops: ReadonlyArray<{ op: 'set'; path: readonly string[]; value: unknown }>,
        expectedRevision?: number,
      ): Promise<boolean>
    }

    const zh: Record<string, string> = {
      description: '为选定模型设置 Standard 或 Pro 模式及摘要等级。',
      models: '启用模型',
      modelsHint: '只有勾选的 provider/model 会改变 Responses 请求；未出现在目录中的已保存路由仍会保留。',
      loading: '正在加载模型目录…',
      retry: '重试',
      selected: '已选择 {n} 个模型',
      unavailable: '当前不可用',
      unavailableGroup: '已保存但当前不可用',
      noModels: '当前没有可用的模型目录。',
      readOnly: '设置当前为只读。',
      formUnavailable: '当前配置不可用。',
      save: '保存',
      saving: '保存中…',
      saveFailed: '保存失败，请重试。',
      catalogFailed: '模型目录加载失败；已保存的选择不会被自动删除。',
      standard: 'Standard',
      pro: 'Pro',
      auto: 'Auto',
      concise: 'Concise',
      detailed: 'Detailed',
      modeLabel: '推理模式',
      summaryLabel: '摘要等级',
      menuLabel: '推理模式与摘要等级',
    }
    const en: Record<string, string> = {
      description: 'Set Standard or Pro mode and summary level for selected models.',
      models: 'Enabled models',
      modelsHint: 'Only checked provider/model routes change Responses requests; saved routes remain when absent from the catalog.',
      loading: 'Loading model catalog…',
      retry: 'Retry',
      selected: '{n} model(s) selected',
      unavailable: 'Currently unavailable',
      unavailableGroup: 'Saved but currently unavailable',
      noModels: 'No model catalog is currently available.',
      readOnly: 'Settings are read-only.',
      formUnavailable: 'This configuration is not available.',
      save: 'Save',
      saving: 'Saving…',
      saveFailed: 'Save failed; please try again.',
      catalogFailed: 'The model catalog could not be loaded; saved selections were not removed.',
      standard: 'Standard',
      pro: 'Pro',
      auto: 'Auto',
      concise: 'Concise',
      detailed: 'Detailed',
      modeLabel: 'Reasoning mode',
      summaryLabel: 'Summary level',
      menuLabel: 'Reasoning mode and summary level',
    }

    const css = `
      .rm-readonly { color: var(--dsw-alias-label-tertiary); margin: 12px 0 0; font-size: 12px; line-height: 1.5; }
      .rm-field { display: grid; gap: 10px; padding: 12px 0; }
      .rm-field-head { display: flex; align-items: center; gap: 8px; }
      .rm-field-label { min-width: 0; color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; line-height: 1.5; }
      .rm-count { color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-module-platform); border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 500; line-height: 17px; white-space: nowrap; margin-left: auto; }
      .rm-hint, .rm-notice { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.5; }
      .rm-catalog-error { color: var(--dsw-alias-label-error); display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 12px; line-height: 1.5; }
      .rm-catalog-error button { color: var(--dsw-alias-brand-primary); cursor: pointer; background: transparent; border: 0; padding: 0; font: inherit; }
      .rm-models { border: .5px solid var(--dsw-alias-border-l4); border-radius: 8px; display: grid; gap: 6px; min-width: 0; max-height: 280px; margin: 0; padding: 10px; overflow: auto; }
      .rm-models legend { color: var(--dsw-alias-label-secondary); padding: 0 4px; font-size: 12px; }
      .rm-model-group { display: grid; gap: 6px; }
      .rm-model-group + .rm-model-group { border-top: .5px solid var(--dsw-alias-border-l3); margin-top: 4px; padding-top: 10px; }
      .rm-provider { color: var(--dsw-alias-label-tertiary); padding: 0 6px; font-size: 11px; font-weight: 500; }
      .rm-model { cursor: pointer; border-radius: 6px; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; min-width: 0; padding: 6px; display: grid; }
      .rm-model:hover { background: var(--dsw-alias-bg-layer-4); }
      .rm-model > input { margin: 0; }
      .rm-model-name, .rm-route { text-overflow: ellipsis; white-space: nowrap; display: block; overflow: hidden; }
      .rm-model-name { color: var(--dsw-alias-label-primary); font-size: 13px; }
      .rm-route { color: var(--dsw-alias-label-tertiary); margin-top: 2px; font-size: 11px; }
      .rm-unavailable { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
      .rm-control-root { min-width: 0; position: relative; display: inline-flex; order: 1; }
      /* The right slot is rendered before the model seat; keep this ordering local to this plugin. */
      .uV2eYG_trailing:has(.rm-control-root) > [data-slot='conversation.input.model'] { order: 0; }
      .uV2eYG_trailing:has(.rm-control-root) > .rm-control-root { order: 1; }
      .uV2eYG_trailing:has(.rm-control-root) > span:has(> button[aria-haspopup='dialog']) { order: 2; }
      .uV2eYG_trailing:has(.rm-control-root) > .uV2eYG_primary { order: 3; }
      .rm-control-trigger { appearance: none; min-width: 0; max-width: min(180px, 45cqw); height: 28px; color: var(--dsw-alias-label-caption); cursor: pointer; background: transparent; border: 0; border-radius: 24px; outline: none; align-items: center; gap: 4px; padding: 0 4px 0 8px; font: inherit; font-size: 13px; font-weight: 500; line-height: 20px; display: flex; }
      .rm-control-trigger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
      .rm-control-trigger:focus-visible { box-shadow: 0 0 0 2px var(--dsw-alias-border-l3); }
      .rm-control-trigger:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
      .rm-control-value { min-width: 0; color: var(--dsw-alias-label-caption); text-overflow: ellipsis; white-space: nowrap; flex-shrink: 1000; overflow: hidden; font-size: 13px; font-weight: 500; line-height: 20px; }
      .rm-control-separator { color: var(--dsw-alias-label-caption); flex: none; font-size: 13px; font-weight: 500; line-height: 20px; }
      .rm-control-chevron { color: var(--dsw-alias-label-caption); flex: none; transition: transform .12s; }
      .rm-control-chevron-open { transform: rotate(180deg); }
      /* Only the card's measurements are ours; its material, radius, elevation,
         rows, hover/focus fills and check glyph all come from the official Menu. */
      .rm-control-menu { width: max-content; min-width: min(240px, calc(100vw - 32px)); max-width: min(420px, calc(100vw - 32px)); max-height: min(360px, calc(100vh - 96px)); overflow: hidden; }
      .rm-cell { align-items: center; gap: 8px; width: 100%; min-width: 0; display: flex; }
      .rm-cell-label { white-space: nowrap; flex: none; }
      .rm-cell-value { text-overflow: ellipsis; white-space: nowrap; min-width: 0; color: var(--dsw-alias-label-tertiary); margin-left: auto; overflow: hidden; }
      .rm-cell-chevron { color: var(--dsw-alias-label-tertiary); flex: none; }
      .rm-option { align-items: center; gap: 8px; width: 100%; min-width: 0; display: flex; }
      .rm-option-label { text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; overflow: hidden; }
      .rm-option-check { color: var(--dsw-alias-label-primary); flex: 0 0 18px; place-items: center; display: grid; }
      @media (max-width: 620px) {
        .uV2eYG_trailing:has(.rm-control-root) > .rm-control-root { max-width: 132px; }
        .rm-control-trigger { max-width: 132px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .rm-control-chevron { transition: none; }
      }
    `

    function keyOf(item: { provider: string; model: string }): string {
      return `${item.provider}\u0000${item.model}`
    }

    const DEFAULT_MODE: Mode = 'standard'
    const DEFAULT_SUMMARY: Summary = 'auto'

    function modeOf(value: unknown): Mode {
      return value === 'standard' || value === 'pro' ? value : DEFAULT_MODE
    }

    function summaryOf(value: unknown): Summary {
      return value === 'auto' || value === 'concise' || value === 'detailed' ? value : DEFAULT_SUMMARY
    }

    function copyModels(value: any): Selection[] {
      if (!Array.isArray(value?.models)) return []
      const result: Selection[] = []
      const seen = new Set<string>()
      for (const raw of value.models) {
        if (typeof raw?.provider !== 'string' || typeof raw?.model !== 'string' || !raw.provider || !raw.model) continue
        const item = { provider: raw.provider, model: raw.model }
        const key = keyOf(item)
        if (seen.has(key)) continue
        seen.add(key)
        result.push({
          ...item,
          mode: modeOf(raw.mode),
          summary: summaryOf(raw.summary),
        })
      }
      return result
    }

    function displayName(model: CatalogModel): string {
      return typeof model.name === 'string' && model.name !== model.id ? model.name : model.id
    }

    function ModelRow(props: any): any {
      const { item, providerName, modelName, available, checked, disabled, onToggle, t } = props
      return e('label', { className: 'rm-model' },
        e('input', { type: 'checkbox', checked, disabled, onChange: onToggle }),
        e('span', null,
          e('span', { className: 'rm-model-name' }, modelName),
          e('span', { className: 'rm-route' }, `${providerName} · ${item.provider}/${item.model}`),
        ),
        !available ? e('span', { className: 'rm-unavailable' }, t('unavailable')) : null,
      )
    }

    /**
     * One row's configuration page. The plugins page renders this entry twice:
     * once as the row's one-liner (`view: 'summary'`, no form) and once, when the
     * row is opened, as the page body, where the owner supplies the Host form —
     * the accepted values, the entry revision, and the revision-fenced write. The
     * page frame, its save control, and its failure notice are the official
     * settings form's; this component owns the catalog-driven route list only.
     */
    function ReasoningModeCard(props: any): any {
      const translate = props.t as (key: string, params?: { n?: number }) => unknown
      const t = (key: string, ...args: any[]) => String(
        translate(key, args.length > 0 ? { n: args[0] } : undefined),
      ).replace(/\{n\}/g, String(args[0] ?? 0))
      const form = props.form as ConfigPageForm | undefined
      const sessionFace = props.sessionFace as () => SessionFace | undefined
      const [dirty, setDirty] = useState(false)
      const [saving, setSaving] = useState(false)
      const [failed, setFailed] = useState(false)
      const [draftModels, setDraftModels] = useState(() => copyModels(form?.state.value)) as [Selection[], (value: any) => void]
      const [catalog, setCatalog] = useState(null) as [CatalogGroup[] | null, (value: CatalogGroup[] | null) => void]
      const [catalogError, setCatalogError] = useState(null) as [string | null, (value: string | null) => void]

      // The plugins page mounts both views as separate entries, so every hook
      // runs in both and opening a row can never change the hook order.
      const isPage = props.view === 'page' && form !== undefined
      const revision = form?.state.revision
      const value = form?.state.value ?? { models: [] }

      useEffect(() => {
        if (!isPage || dirty) return
        setDraftModels(copyModels(form?.state.value))
        setFailed(false)
      }, [isPage, revision, dirty, value])

      const loadCatalog = async () => {
        setCatalogError(null)
        try {
          const face = typeof sessionFace === 'function' ? sessionFace() : undefined
          if (!face || typeof face.modelCatalog !== 'function') throw new Error('host remote.session namespace is unavailable')
          const response = await face.modelCatalog()
          if (!response || typeof response.ok !== 'boolean') throw new Error('host model catalog answered an unknown shape')
          if (!response.ok) throw new Error(response.error?.message ?? response.error?.code ?? 'host refused the model catalog request')
          const groups = response.value?.groups
          if (!Array.isArray(groups)) throw new Error('host model catalog carried no provider groups')
          setCatalog(groups.filter((group: any) => typeof group?.id === 'string').map((group: any) => ({
            id: group.id,
            name: typeof group.name === 'string' ? group.name : group.id,
            models: Array.isArray(group.models) ? group.models.filter((model: any) => typeof model?.id === 'string') : [],
          })))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`[reasoning-mode] model catalog load failed: ${message}`)
          setCatalogError(message)
          setCatalog(null)
        }
      }

      useEffect(() => { if (isPage) void loadCatalog() }, [isPage])

      const savedModels = useMemo(() => copyModels(value), [value])
      const savedByKey = new Map(savedModels.map((item: Selection) => [keyOf(item), item]))
      const selected = new Set(draftModels.map(keyOf))
      const catalogKeys = useMemo(() => {
        if (!catalog) return null
        const result = new Set<string>()
        for (const group of catalog) for (const model of (group.models ?? [])) result.add(keyOf({ provider: group.id, model: model.id }))
        return result
      }, [catalog])

      // Keep saved routes in the staged candidate set until Save commits an uncheck.
      const effective = new Map<string, Selection>()
      for (const item of savedModels) effective.set(keyOf(item), item)
      for (const item of draftModels) effective.set(keyOf(item), item)
      const unavailable: Selection[] = []
      for (const item of effective.values()) {
        if (catalogKeys !== null && catalogKeys.has(keyOf(item))) continue
        unavailable.push(item)
      }

      // The summary entry is the row's one-liner; only the page entry has a form.
      if (props.view !== 'page') return e('span', null, t('description'))
      if (form === undefined || form.state.status !== 'ready') return null

      const writable = form.state.writable
      const toggle = (item: { provider: string; model: string }) => {
        const key = keyOf(item)
        setDraftModels((current: Selection[]) => current.some((entry) => keyOf(entry) === key)
          ? current.filter((entry) => keyOf(entry) !== key)
          : [...current, savedByKey.get(key) ?? {
            provider: item.provider,
            model: item.model,
            mode: DEFAULT_MODE,
            summary: DEFAULT_SUMMARY,
          }])
        setDirty(true)
      }
      const save = async () => {
        if (!writable || saving) return
        setSaving(true)
        setFailed(false)
        let accepted = false
        try {
          // One revision-fenced write for the whole list, fenced by the revision
          // the drafts were staged against.
          accepted = await form.mutate([{ op: 'set', path: ['models'], value: draftModels }], revision)
        } catch {
          accepted = false
        }
        if (accepted) setDirty(false)
        else setFailed(true)
        setSaving(false)
      }
      const discard = () => {
        setDraftModels(savedModels)
        setDirty(false)
        setFailed(false)
      }
      const renderRow = (providerName: string, item: { provider: string; model: string }, available: boolean, modelName: string) => e(ModelRow, {
        key: keyOf(item),
        item,
        providerName,
        modelName,
        available,
        checked: selected.has(keyOf(item)),
        disabled: !writable || saving,
        onToggle: () => toggle(item),
        t,
      })

      const controls = e('div', { className: 'rm-field' },
        e('div', { className: 'rm-field-head' },
          e('span', { className: 'rm-field-label' }, t('models')),
          e('span', { className: 'rm-count' }, t('selected', draftModels.length)),
        ),
        e('p', { className: 'rm-hint' }, t('modelsHint')),
        catalogError !== null ? e('div', { className: 'rm-catalog-error', role: 'alert' },
          e('span', null, `${t('catalogFailed')} (${catalogError})`),
          e('button', { type: 'button', disabled: saving, onClick: () => { void loadCatalog() } }, t('retry')),
        ) : null,
        catalog === null && catalogError === null ? e('p', { className: 'rm-notice', role: 'status' }, t('loading')) : null,
        (catalog && catalog.length > 0) || effective.size > 0 ? e('fieldset', { className: 'rm-models' },
          e('legend', null, t('models')),
          catalog?.map((group: CatalogGroup) => e('div', { className: 'rm-model-group', key: group.id },
            e('div', { className: 'rm-provider' }, group.name ?? group.id),
            (group.models ?? []).map((model: CatalogModel) => renderRow(group.name ?? group.id, { provider: group.id, model: model.id }, true, displayName(model))),
          )),
          unavailable.length > 0 ? e('div', { className: 'rm-model-group' },
            e('div', { className: 'rm-provider' }, t('unavailableGroup')),
            unavailable.map((item) => renderRow(item.provider, item, false, item.model)),
          ) : null,
        ) : null,
        catalog && catalog.length === 0 && effective.size === 0 ? e('p', { className: 'rm-notice' }, t('noModels')) : null,
      )

      return e(SettingsForm, {
        labels: {
          unavailable: t('formUnavailable'),
          readOnly: t('readOnly'),
          saveFailed: t('saveFailed'),
          save: t('save'),
          saving: t('saving'),
        },
        state: {
          available: form.state.status === 'ready',
          writable,
          dirty,
          invalid: false,
          saving,
          failed,
        },
        onSave: () => { void save() },
        onDiscard: discard,
      }, controls)
    }

    function routeFromProjection(projection: any): Route | undefined {
      const route = projection?.next ?? projection?.lastUsed
      if (typeof route?.provider !== 'string' || typeof route?.model !== 'string') return undefined
      return { provider: route.provider, model: route.model }
    }

    function routeFromCatalog(response: CatalogResponse): Route | undefined {
      const route = response.ok ? response.value?.default : undefined
      if (typeof route?.provider !== 'string' || typeof route?.model !== 'string') return undefined
      return { provider: route.provider, model: route.model }
    }

    /** The leaf rows, each carrying the patch it writes when selected. */
    const CHOICES: Record<string, Partial<Selection>> = {
      'mode:standard': { mode: 'standard' },
      'mode:pro': { mode: 'pro' },
      'summary:auto': { summary: 'auto' },
      'summary:concise': { summary: 'concise' },
      'summary:detailed': { summary: 'detailed' },
    }

    /**
     * The composer pill: the current route's mode and summary, each a cell of
     * two nested official Menu cards. Placement, the portal, outside click,
     * Escape, the arrow walk and the focus return all belong to the official
     * Menu primitive — this component owns only the values it reads and writes.
     */
    function ModeControl(props: any): any {
      const scope = props.scope as Scope
      const translate = props.t as (key: string) => unknown
      const t = (key: string) => String(translate(key))
      const [, setRevision] = useState(0)
      const [open, setOpen] = useState(false)
      const [busy, setBusy] = useState(false)
      const [catalogDefault, setCatalogDefault] = useState(undefined as { sessionId: string; route: Route } | undefined)
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined
      const sessionFace = props.sessionFace as (() => SessionFace | undefined) | undefined
      const projection = typeof props.useProjection === 'function' ? props.useProjection('modelSelection') : undefined
      const projectedRoute = routeFromProjection(projection)
      const fallbackRoute = sessionId !== undefined && catalogDefault?.sessionId === sessionId ? catalogDefault.route : undefined
      const route = sessionId === undefined ? undefined : projectedRoute ?? fallbackRoute
      const snapshot = scope.getSnapshot()
      const models = copyModels(snapshot.value)
      const config = route === undefined ? undefined : models.find((item) => keyOf(item) === keyOf(route))
      const routeId = route === undefined ? '' : keyOf(route)

      useEffect(() => scope.subscribe(() => setRevision((value: number) => value + 1)), [scope])
      useEffect(() => {
        if (projectedRoute !== undefined || sessionId === undefined) return undefined
        const face = typeof sessionFace === 'function' ? sessionFace() : undefined
        if (face === undefined || typeof face.modelCatalog !== 'function') return undefined
        let cancelled = false
        void face.modelCatalog().then((response) => {
          if (cancelled) return
          const route = routeFromCatalog(response)
          setCatalogDefault(route === undefined ? undefined : { sessionId, route })
        }, () => {
          if (!cancelled) setCatalogDefault(undefined)
        })
        return () => {
          cancelled = true
        }
      }, [projectedRoute?.provider, projectedRoute?.model, sessionId, sessionFace])
      useEffect(() => {
        setOpen(false)
      }, [routeId])

      if (config === undefined) return null

      const update = (id: string) => {
        const patch = CHOICES[id]
        if (patch === undefined || busy) return
        const current = copyModels(scope.getSnapshot().value)
        const next = current.map((item) => keyOf(item) === routeId ? { ...item, ...patch } : item)
        setOpen(false)
        setBusy(true)
        scope.set('models', next).catch(() => {}).finally(() => setBusy(false))
      }
      const modeLabel = config.mode === 'standard' ? t('standard') : t('pro')
      const summaryLabel = config.summary === 'concise' ? t('concise') : config.summary === 'detailed' ? t('detailed') : t('auto')
      /* The primitive draws the check for its primary rows; a nested row carries
         only icon, label and shortcut, so a leaf's own mark stays in its label. */
      const option = (value: string, label: string, current: string, group: string) => ({
        id: `${group}:${value}`,
        label: e('span', { className: 'rm-option' },
          e('span', { className: 'rm-option-label' }, label),
          e('span', { className: 'rm-option-check', 'aria-hidden': true }, current === value ? e(IconCheckOutlineRegular, null) : null),
        ),
      })
      const cell = (id: string, label: string, value: string, submenu: any[]) => ({
        id,
        label: e('span', { className: 'rm-cell' },
          e('span', { className: 'rm-cell-label' }, label),
          e('span', { className: 'rm-cell-value' }, value),
          e(IconChevronRightOutlineRegular, { className: 'rm-cell-chevron' }),
        ),
        submenu,
      })

      return e(Menu, {
        open,
        className: 'rm-control-root',
        listClassName: 'rm-control-menu',
        align: 'end',
        side: 'top',
        portal: true,
        items: [
          cell('cell:mode', t('modeLabel'), modeLabel, [
            option('standard', t('standard'), config.mode, 'mode'),
            option('pro', t('pro'), config.mode, 'mode'),
          ]),
          cell('cell:summary', t('summaryLabel'), summaryLabel, [
            option('auto', t('auto'), config.summary, 'summary'),
            option('concise', t('concise'), config.summary, 'summary'),
            option('detailed', t('detailed'), config.summary, 'summary'),
          ]),
        ],
        onSelect: update,
        onClose: () => setOpen(false),
        anchor: e('button', {
          type: 'button', className: 'rm-control-trigger', disabled: busy,
          'aria-label': `${t('modeLabel')}: ${modeLabel}; ${t('summaryLabel')}: ${summaryLabel}`,
          'aria-haspopup': 'menu', 'aria-expanded': open,
          title: `${modeLabel} \u00b7 ${summaryLabel}`,
          onClick: () => setOpen((value: boolean) => !value),
        },
          e('span', { className: 'rm-control-value' }, modeLabel),
          e('span', { className: 'rm-control-separator', 'aria-hidden': true }, '\u00b7'),
          e('span', { className: 'rm-control-value' }, summaryLabel),
          e(IconChevronDownOutlineRegular, { className: `rm-control-chevron ${open ? 'rm-control-chevron-open' : ''}` }),
        ),
      })
    }
    function apply(ctx: any): void {
      if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="reasoning-mode"]')) {
        const style = document.createElement('style')
        style.dataset.pluginCss = 'reasoning-mode'
        style.textContent = css
        document.head.appendChild(style)
      }
      const slots = ctx.slots
      const configForms = ctx.configForms
      const locale = ctx.locale
      if (!slots || !configForms || !locale) return
      const scope = configForms.get(NS)
      const sessionFace = (): SessionFace | undefined => {
        const viaNamespace = typeof ctx.get === 'function' ? ctx.get('remote.session') : undefined
        if (viaNamespace !== undefined) return viaNamespace as SessionFace
        const remote = typeof ctx.get === 'function' ? ctx.get('remote') : ctx.remote
        return remote === undefined || remote === null ? undefined : remote.session as SessionFace
      }
      ctx.effect(() => locale.register(NS, { zh, en }), 'reasoning-mode: locale dictionaries')
      // Both registrations declare `locale: NS`, which is what puts the
      // translator on their props: the renderer reads the entry's `locale` and
      // composes `kit.t = localeSeat(face, ns)` for it (and throws when no
      // locale face is installed, so there is no "the seat might not supply it"
      // case), with `localeSeat` being `face.bind(ns)` memoized per revision.
      // Binding our own translator here would shadow that identical prop.
      // Our row's configuration page. The plugins page dispatches
      // `plugins.row.config` by `<package name>#<row id>` and supplies the form,
      // so the page exists only while the Host serves this entry's namespace.
      ctx.effect(() => configForms.whileServed([NS], () => slots.inject('plugins.row.config', () => slots.register({
        name: 'plugins.row.config',
        key: `${PACKAGE_NAME}#${NS}`,
        locale: NS,
      }, (props: any) => e(ReasoningModeCard, { ...props, sessionFace })))), 'reasoning-mode: configuration page')
      slots.inject('conversation.input.right', () => slots.register({
        name: 'conversation.input.right',
        id: NS,
        order: 85,
        locale: NS,
      }, (props: any) => e(ModeControl, { ...props, scope, sessionFace })))
    }

    return { apply, inject: ['slots', 'configForms', 'locale', 'remote', 'remote.session'] }
  },
})
