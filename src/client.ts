interface Window {
  __ModuleLoader__: {
    load(definition: { id: string; factory: (require: (id: string) => any) => any }): void
  }
}

window.__ModuleLoader__.load({
  id: '@zhourenke/dsh-reasoning-mode',
  factory: (require) => {
    const NS = 'reasoning-mode'
    const React: any = require('react')
    const e = React.createElement
    const { useEffect, useLayoutEffect, useMemo, useRef, useState } = React
    const { IconChevronDownOutline14, IconChevronRightOutline14, IconCheckOutline16, Tag } = require('@deepseek-ai/dsh-client-ui-primitives')
    const ReactDOM: any = require('react-dom')

    type Mode = 'standard' | 'pro'
    type Summary = 'auto' | 'concise' | 'detailed'
    type Selection = { provider: string; model: string; mode: Mode; summary: Summary }
    type CatalogModel = { id: string; name?: string; description?: string }
    type CatalogGroup = { id: string; name?: string; models?: CatalogModel[] }
    type CatalogResponse = {
      ok: boolean
      value?: { groups?: CatalogGroup[] }
      error?: { code?: string; message?: string }
    }
    type SessionFace = { modelCatalog(): Promise<CatalogResponse> }
    type Snapshot = {
      status: string
      value?: { defaultMode?: Mode; defaultSummary?: Summary; models?: Selection[] }
      writable: boolean
    }
    type Scope = {
      getSnapshot(): Snapshot
      subscribe(listener: () => void): () => void
      mutate(ops: readonly { op: 'set'; path: readonly (string | number)[]; value: unknown }[]): Promise<void>
    }

    const zh: Record<string, string> = {
      title: '推理模式',
      description: '为选定模型设置 Standard 或 Pro 模式及摘要等级。',
      models: '启用模型',
      modelsHint: '只有勾选的 provider/model 会改变 Responses 请求；未出现在目录中的已保存路由仍会保留。',
      loading: '正在加载模型目录…',
      retry: '重试',
      selected: '已启用 {n} 个模型',
      unavailable: '当前不可用',
      unavailableGroup: '已保存但当前不可用',
      noModels: '当前没有可用的模型目录。',
      readOnly: '设置当前为只读。',
      save: '保存',
      saving: '保存中…',
      discard: '放弃更改',
      unsaved: '未保存',
      saveFailed: '保存失败，请重试。',
      expand: '展开',
      collapse: '收起',
      catalogFailed: '模型目录加载失败；已保存的选择不会被自动删除。',
      defaults: '新增模型默认值',
      mode: '模式',
      summary: '摘要等级',
      standard: 'Standard',
      pro: 'Pro',
      auto: 'Auto',
      concise: 'Concise',
      detailed: 'Detailed',
      modeLabel: '推理模式',
      summaryLabel: '摘要等级',
      menuLabel: '推理模式与摘要等级',
      routeHint: '主界面的当前模型控件会同步更新这里的路由设置。',
      unavailableRoute: '当前路由不可用',
    }
    const en: Record<string, string> = {
      title: 'Reasoning mode',
      description: 'Set Standard or Pro mode and summary level for selected models.',
      models: 'Enabled models',
      modelsHint: 'Only checked provider/model routes change Responses requests; saved routes remain when absent from the catalog.',
      loading: 'Loading model catalog…',
      retry: 'Retry',
      selected: '{n} model(s) enabled',
      unavailable: 'Currently unavailable',
      unavailableGroup: 'Saved but currently unavailable',
      noModels: 'No model catalog is currently available.',
      readOnly: 'Settings are read-only.',
      save: 'Save',
      saving: 'Saving…',
      discard: 'Discard changes',
      unsaved: 'Unsaved',
      saveFailed: 'Save failed; please try again.',
      expand: 'Expand',
      collapse: 'Collapse',
      catalogFailed: 'The model catalog could not be loaded; saved selections were not removed.',
      defaults: 'Defaults for new models',
      mode: 'Mode',
      summary: 'Summary level',
      standard: 'Standard',
      pro: 'Pro',
      auto: 'Auto',
      concise: 'Concise',
      detailed: 'Detailed',
      modeLabel: 'Reasoning mode',
      summaryLabel: 'Summary level',
      menuLabel: 'Reasoning mode and summary level',
      routeHint: 'The current model control in the composer updates this route setting too.',
      unavailableRoute: 'Route unavailable',
    }

    const css = `
      .rm-card { border: .5px solid var(--dsw-alias-border-l4); background: var(--dsw-alias-bg-layer-3); border-radius: 16px; list-style: none; transition: border-color .16s, background .16s; }
      .rm-card:hover { border-color: var(--dsw-alias-label-dimmed); }
      .rm-card-open { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-label-dimmed); }
      .rm-head { appearance: none; width: 100%; font: inherit; color: inherit; text-align: left; cursor: pointer; background: transparent; border: 0; border-radius: 12px; display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
      .rm-head:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
      .rm-heading { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
      .rm-name { color: var(--dsw-alias-label-primary); font-size: 15px; font-weight: 600; line-height: 1.4; }
      .rm-description { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 1.5; }
      .rm-pending { flex: none; }
      .rm-chevron { color: var(--dsw-alias-label-tertiary); flex: none; transition: transform .16s; }
      .rm-chevron-open { transform: rotate(180deg); }
      .rm-body { border-top: .5px solid var(--dsw-alias-border-l2); margin: 0 16px; padding-bottom: 8px; }
      .rm-readonly { color: var(--dsw-alias-label-tertiary); margin: 12px 0 0; font-size: 12px; line-height: 1.5; }
      .rm-field { display: grid; gap: 10px; padding: 12px 0; }
      .rm-field + .rm-field { border-top: .5px solid var(--dsw-alias-border-l2); }
      .rm-field-head { display: flex; align-items: center; gap: 8px; }
      .rm-field-label { min-width: 0; color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; line-height: 1.5; }
      .rm-count { color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-module-platform); border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 500; line-height: 17px; white-space: nowrap; margin-left: auto; }
      .rm-hint, .rm-notice { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.5; }
      .rm-catalog-error { color: var(--dsw-alias-label-error); display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 12px; line-height: 1.5; }
      .rm-catalog-error button { color: var(--dsw-alias-brand-primary); cursor: pointer; background: transparent; border: 0; padding: 0; font: inherit; }
      .rm-defaults { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .rm-select-wrap { min-width: 0; display: grid; gap: 5px; }
      .rm-select-label { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 1.4; }
      .rm-select { border: .5px solid var(--dsw-alias-border-l4); background: var(--dsw-alias-bg-layer-3); min-width: 0; height: 32px; color: var(--dsw-alias-label-primary); border-radius: 7px; padding: 0 8px; font: inherit; font-size: 12px; line-height: 1.5; }
      .rm-select:focus-visible { border-color: var(--dsw-alias-brand-primary); outline: none; }
      .rm-select:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
      .rm-models { border: .5px solid var(--dsw-alias-border-l4); border-radius: 8px; display: grid; gap: 6px; min-width: 0; max-height: 360px; margin: 0; padding: 10px; overflow: auto; }
      .rm-models legend { color: var(--dsw-alias-label-secondary); padding: 0 4px; font-size: 12px; }
      .rm-model-group { display: grid; gap: 6px; }
      .rm-model-group + .rm-model-group { border-top: .5px solid var(--dsw-alias-border-l3); margin-top: 4px; padding-top: 10px; }
      .rm-provider { color: var(--dsw-alias-label-tertiary); padding: 0 6px; font-size: 11px; font-weight: 500; }
      .rm-model { border-radius: 6px; display: grid; grid-template-columns: minmax(0, 1fr) 92px 100px; align-items: center; gap: 8px; min-width: 0; padding: 6px; }
      .rm-model:hover { background: var(--dsw-alias-bg-layer-4); }
      .rm-model-main { min-width: 0; display: flex; align-items: flex-start; gap: 8px; }
      .rm-model-main input { margin-top: 3px; flex: none; }
      .rm-model-copy { min-width: 0; }
      .rm-model-name, .rm-route { text-overflow: ellipsis; white-space: nowrap; display: block; overflow: hidden; }
      .rm-model-name { color: var(--dsw-alias-label-primary); font-size: 13px; }
      .rm-route { color: var(--dsw-alias-label-tertiary); margin-top: 2px; font-size: 11px; }
      .rm-unavailable { color: var(--dsw-alias-label-tertiary); grid-column: 1 / -1; padding-left: 24px; font-size: 11px; }
      .rm-footer { border-top: .5px solid var(--dsw-alias-border-l2); display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 0 4px; }
      .rm-failed { min-width: 0; color: var(--dsw-alias-label-error); flex: 1; margin: 0; font-size: 12px; line-height: 1.5; }
      .rm-discard, .rm-save { appearance: none; border: 1px solid transparent; border-radius: 8px; padding: 5px 14px; font: inherit; font-size: 13px; line-height: 1.5; cursor: pointer; }
      .rm-discard { border-color: var(--dsw-alias-border-l2); background: none; color: var(--dsw-alias-label-secondary); }
      .rm-discard:hover:not(:disabled) { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-dimmed); }
      .rm-save { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); }
      .rm-discard:disabled, .rm-save:disabled { opacity: .4; cursor: default; }
      .rm-discard:focus-visible, .rm-save:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
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
      .rm-control-menu { z-index: 1100; width: max-content; min-width: min(240px, calc(100vw - 32px)); max-width: min(420px, calc(100vw - 32px)); max-height: min(360px, calc(100vh - 96px)); color: var(--dsw-alias-label-primary); background: var(--dsw-specific-menu); --dsw-elevation-stroke-color: var(--dsw-alias-border-l1); --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2); border: 0; border-radius: 20px; box-shadow: var(--dsw-elevation-prominent); flex-direction: column; padding: 4px; display: flex; position: fixed; overflow: hidden; }
      .rm-menu-cell { appearance: none; box-sizing: border-box; width: auto; min-width: 100%; height: 40px; color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; background: transparent; border: 0; border-radius: 10px; outline: none; align-items: center; gap: 8px; padding: 0 10px; font: inherit; font-size: 14px; line-height: 22px; display: flex; }
      .rm-menu-cell:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
      .rm-menu-cell:focus-visible { box-shadow: 0 0 0 2px var(--dsw-alias-border-l3) inset; }
      .rm-menu-cell:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
      .rm-menu-cell-label { white-space: nowrap; flex: none; }
      .rm-menu-cell-value { text-overflow: ellipsis; white-space: nowrap; text-align: right; min-width: 0; color: var(--dsw-alias-label-tertiary); flex: auto; overflow: hidden; }
      .rm-menu-cell-chevron { color: var(--dsw-alias-label-tertiary); flex: none; }
      .rm-menu-option { appearance: none; box-sizing: border-box; width: auto; min-width: 100%; min-height: 38px; color: inherit; text-align: left; cursor: pointer; background: transparent; border: 0; border-radius: 10px; outline: none; align-items: center; gap: 8px; padding: 6px 8px; font: inherit; font-size: 13.3333px; line-height: normal; display: flex; }
      .rm-menu-option:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
      .rm-menu-option:focus-visible { box-shadow: 0 0 0 2px var(--dsw-alias-border-l3) inset; }
      .rm-menu-option:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
      .rm-menu-option-copy { flex-direction: column; flex: 1; min-width: 0; display: flex; }
      .rm-menu-option-label { color: inherit; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; line-height: 20px; overflow: hidden; }
      .rm-menu-check { color: var(--dsw-alias-label-primary); flex: 0 0 18px; place-items: center; display: grid; }
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

    function modeOf(value: unknown, fallback: Mode): Mode {
      return value === 'standard' || value === 'pro' ? value : fallback
    }

    function summaryOf(value: unknown, fallback: Summary): Summary {
      return value === 'auto' || value === 'concise' || value === 'detailed' ? value : fallback
    }

    function copyModels(value: any, fallbackMode: Mode, fallbackSummary: Summary): Selection[] {
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
          mode: modeOf(raw.mode, fallbackMode),
          summary: summaryOf(raw.summary, fallbackSummary),
        })
      }
      return result
    }

    function displayName(model: CatalogModel): string {
      return typeof model.name === 'string' && model.name !== model.id ? model.name : model.id
    }

    function ModelRow(props: any): any {
      const { item, providerName, modelName, available, checked, disabled, onToggle, onChange, t } = props
      const mode = item?.mode === 'standard' || item?.mode === 'pro' ? item.mode : 'standard'
      const summary = item?.summary === 'auto' || item?.summary === 'concise' || item?.summary === 'detailed' ? item.summary : 'auto'
      return e('div', { className: 'rm-model' },
        e('label', { className: 'rm-model-main' },
          e('input', { type: 'checkbox', checked, disabled, onChange: onToggle }),
          e('span', { className: 'rm-model-copy' },
            e('span', { className: 'rm-model-name' }, modelName),
            e('span', { className: 'rm-route' }, `${providerName} · ${item.provider}/${item.model}`),
          ),
        ),
        e('label', { className: 'rm-select-wrap' },
          e('span', { className: 'rm-select-label' }, t('mode')),
          e('select', { className: 'rm-select', value: mode, disabled: disabled || !checked, 'aria-label': `${t('mode')}: ${item.provider}/${item.model}`, onChange: (event: any) => onChange({ mode: event.target.value }) },
            e('option', { value: 'standard' }, t('standard')),
            e('option', { value: 'pro' }, t('pro')),
          ),
        ),
        e('label', { className: 'rm-select-wrap' },
          e('span', { className: 'rm-select-label' }, t('summary')),
          e('select', { className: 'rm-select', value: summary, disabled: disabled || !checked, 'aria-label': `${t('summary')}: ${item.provider}/${item.model}`, onChange: (event: any) => onChange({ summary: event.target.value }) },
            e('option', { value: 'auto' }, t('auto')),
            e('option', { value: 'concise' }, t('concise')),
            e('option', { value: 'detailed' }, t('detailed')),
          ),
        ),
        !available ? e('span', { className: 'rm-unavailable' }, t('unavailableRoute')) : null,
      )
    }

    function ReasoningModeCard(props: any): any {
      const translate = props.t as (key: string, params?: { n?: number }) => unknown
      const t = (key: string, ...args: any[]) => String(
        translate(key, args.length > 0 ? { n: args[0] } : undefined),
      ).replace(/\{n\}/g, String(args[0] ?? 0))
      const scope = props.scope as Scope
      const sessionFace = props.sessionFace as () => SessionFace | undefined
      const [revision, setRevision] = useState(0)
      const [open, setOpen] = useState(false)
      const [dirty, setDirty] = useState(false)
      const initial = scope.getSnapshot()
      const initialMode = modeOf(initial.value?.defaultMode, 'standard')
      const initialSummary = summaryOf(initial.value?.defaultSummary, 'auto')
      const [draftModels, setDraftModels] = useState(() => copyModels(initial.value, initialMode, initialSummary))
      const [draftMode, setDraftMode] = useState(initialMode) as [Mode, (value: Mode) => void]
      const [draftSummary, setDraftSummary] = useState(initialSummary) as [Summary, (value: Summary) => void]
      const [saving, setSaving] = useState(false)
      const [failed, setFailed] = useState(false)
      const [catalog, setCatalog] = useState(null) as [CatalogGroup[] | null, (value: CatalogGroup[] | null) => void]
      const [catalogError, setCatalogError] = useState(null) as [string | null, (value: string | null) => void]

      useEffect(() => scope.subscribe(() => setRevision((value: number) => value + 1)), [scope])
      const snapshot = scope.getSnapshot()
      const value = snapshot.value ?? { defaultMode: 'standard', defaultSummary: 'auto', models: [] }
      const savedMode = modeOf(value.defaultMode, 'standard')
      const savedSummary = summaryOf(value.defaultSummary, 'auto')
      useEffect(() => {
        if (!dirty && snapshot.value) {
          setDraftModels(copyModels(snapshot.value, savedMode, savedSummary))
          setDraftMode(savedMode)
          setDraftSummary(savedSummary)
          setFailed(false)
        }
      }, [revision, dirty, snapshot.value])

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

      useEffect(() => { void loadCatalog() }, [])
      useEffect(() => { if (open && catalogError !== null) void loadCatalog() }, [open])

      const savedModels = useMemo(() => copyModels(value, savedMode, savedSummary), [value, savedMode, savedSummary])
      const draftByKey = new Map(draftModels.map((item: Selection) => [keyOf(item), item]))
      const savedByKey = new Map(savedModels.map((item: Selection) => [keyOf(item), item]))
      const catalogKeys = useMemo(() => {
        if (!catalog) return null
        const result = new Set<string>()
        for (const group of catalog) for (const model of (group.models ?? [])) result.add(keyOf({ provider: group.id, model: model.id }))
        return result
      }, [catalog])
      const unavailable: Selection[] = []
      for (const item of savedModels) {
        if (catalogKeys !== null && catalogKeys.has(keyOf(item))) continue
        unavailable.push(item)
      }

      if (snapshot.status !== 'ready') return null

      const toggle = (item: { provider: string; model: string }) => {
        const key = keyOf(item)
        setDraftModels((current: Selection[]) => current.some((entry) => keyOf(entry) === key)
          ? current.filter((entry) => keyOf(entry) !== key)
          : [...current, { provider: item.provider, model: item.model, mode: draftMode, summary: draftSummary }])
        setDirty(true)
      }
      const updateModel = (item: { provider: string; model: string }, patch: Partial<Selection>) => {
        const key = keyOf(item)
        setDraftModels((current: Selection[]) => current.map((entry) => keyOf(entry) === key ? { ...entry, ...patch } : entry))
        setDirty(true)
      }
      const save = async () => {
        if (!snapshot.writable || saving) return
        setSaving(true)
        setFailed(false)
        try {
          await scope.mutate([
            { op: 'set', path: ['defaultMode'], value: draftMode },
            { op: 'set', path: ['defaultSummary'], value: draftSummary },
            { op: 'set', path: ['models'], value: draftModels },
          ])
          setDirty(false)
        } catch {
          setFailed(true)
        } finally {
          setSaving(false)
        }
      }
      const discard = () => {
        setDraftModels(savedModels)
        setDraftMode(savedMode)
        setDraftSummary(savedSummary)
        setDirty(false)
        setFailed(false)
      }
      const renderRow = (providerName: string, item: { provider: string; model: string }, available: boolean, modelName: string) => {
        const key = keyOf(item)
        const selected = draftByKey.get(key)
        const saved = savedByKey.get(key)
        const rowItem = selected ?? saved ?? { provider: item.provider, model: item.model, mode: draftMode, summary: draftSummary }
        return e(ModelRow, {
          key,
          item: rowItem,
          providerName,
          modelName,
          available,
          checked: selected !== undefined,
          disabled: !snapshot.writable || saving,
          onToggle: () => toggle(item),
          onChange: (patch: Partial<Selection>) => updateModel(item, patch),
          t,
        })
      }

      return e('li', { className: `rm-card ${open ? 'rm-card-open' : ''}` },
        e('button', {
          type: 'button', className: 'rm-head', 'aria-expanded': open,
          'aria-label': `${t(open ? 'collapse' : 'expand')}: ${t('title')}`,
          onClick: () => setOpen(!open),
        },
          e('span', { className: 'rm-heading' },
            e('span', { className: 'rm-name' }, t('title')),
            e('span', { className: 'rm-description' }, t('description')),
          ),
          dirty ? e(Tag, { tone: 'neutral', className: 'rm-pending' }, t('unsaved')) : null,
          e(IconChevronDownOutline14, { className: `rm-chevron ${open ? 'rm-chevron-open' : ''}` }),
        ),
        open ? e('div', { className: 'rm-body' },
          !snapshot.writable ? e('p', { className: 'rm-readonly', role: 'status' }, t('readOnly')) : null,
          e('div', { className: 'rm-field' },
            e('div', { className: 'rm-field-head' },
              e('span', { className: 'rm-field-label' }, t('defaults')),
            ),
            e('p', { className: 'rm-hint' }, t('routeHint')),
            e('div', { className: 'rm-defaults' },
              e('label', { className: 'rm-select-wrap' },
                e('span', { className: 'rm-select-label' }, t('mode')),
                e('select', { className: 'rm-select', value: draftMode, disabled: !snapshot.writable || saving, onChange: (event: any) => { setDraftMode(event.target.value); setDirty(true) } },
                  e('option', { value: 'standard' }, t('standard')),
                  e('option', { value: 'pro' }, t('pro')),
                ),
              ),
              e('label', { className: 'rm-select-wrap' },
                e('span', { className: 'rm-select-label' }, t('summary')),
                e('select', { className: 'rm-select', value: draftSummary, disabled: !snapshot.writable || saving, onChange: (event: any) => { setDraftSummary(event.target.value); setDirty(true) } },
                  e('option', { value: 'auto' }, t('auto')),
                  e('option', { value: 'concise' }, t('concise')),
                  e('option', { value: 'detailed' }, t('detailed')),
                ),
              ),
            ),
          ),
          e('div', { className: 'rm-field' },
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
            (catalog && catalog.length > 0) || unavailable.length > 0 ? e('fieldset', { className: 'rm-models' },
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
            catalog && catalog.length === 0 && unavailable.length === 0 ? e('p', { className: 'rm-notice' }, t('noModels')) : null,
          ),
          e('div', { className: 'rm-footer' },
            failed ? e('p', { className: 'rm-failed', role: 'status' }, t('saveFailed')) : null,
            e('button', { type: 'button', className: 'rm-discard', disabled: !dirty || saving, onClick: discard }, t('discard')),
            e('button', { type: 'button', className: 'rm-save', disabled: !dirty || saving || !snapshot.writable, onClick: () => { void save() } }, saving ? t('saving') : t('save')),
          ),
        ) : null,
      )
    }

    function routeFromProjection(projection: any): { provider: string; model: string } | undefined {
      const route = projection?.next ?? projection?.lastUsed
      if (typeof route?.provider !== 'string' || typeof route?.model !== 'string') return undefined
      return { provider: route.provider, model: route.model }
    }

    function ModeControl(props: any): any {
      const scope = props.scope as Scope
      const translate = props.t as (key: string) => unknown
      const t = (key: string) => String(translate(key))
      const [, setRevision] = useState(0)
      const [open, setOpen] = useState(false)
      const [pane, setPane] = useState('root')
      const [busy, setBusy] = useState(false)
      const rootRef = useRef(null)
      const triggerRef = useRef(null)
      const menuRef = useRef(null)
      const [menuPos, setMenuPos] = useState(null)
      const projection = typeof props.useProjection === 'function' ? props.useProjection('modelSelection') : undefined
      const route = routeFromProjection(projection)
      const snapshot = scope.getSnapshot()
      const models = copyModels(snapshot.value, modeOf(snapshot.value?.defaultMode, 'standard'), summaryOf(snapshot.value?.defaultSummary, 'auto'))
      const config = route === undefined ? undefined : models.find((item) => keyOf(item) === keyOf(route))
      const routeId = route === undefined ? '' : keyOf(route)
      const menuId = `reasoning-mode-menu-${routeId.replace(/[^A-Za-z0-9_-]/g, '-') || 'current'}`

      useEffect(() => scope.subscribe(() => setRevision((value: number) => value + 1)), [scope])
      useEffect(() => {
        setOpen(false)
        setPane('root')
      }, [routeId])
      useEffect(() => {
        if (!open || typeof document === 'undefined') return undefined
        const closeOutside = (event: any) => {
          if (rootRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return
          setOpen(false)
          setPane('root')
        }
        const onKeyDown = (event: any) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          if (pane !== 'root') setPane('root')
          else {
            setOpen(false)
            setPane('root')
          }
        }
        document.addEventListener('mousedown', closeOutside)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('mousedown', closeOutside)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open, pane])
      useLayoutEffect(() => {
        if (!open || typeof window === 'undefined') {
          setMenuPos(null)
          return undefined
        }
        const place = () => {
          const rect = triggerRef.current?.getBoundingClientRect()
          if (!rect) return
          const margin = 12
          const width = menuRef.current?.offsetWidth ?? 0
          const height = menuRef.current?.offsetHeight ?? 0
          let left = rect.right - width
          let top = rect.top - 8 - height
          if (width > 0) left = Math.min(Math.max(left, margin), window.innerWidth - width - margin)
          if (height > 0) top = Math.min(Math.max(top, margin), window.innerHeight - height - margin)
          setMenuPos({ left, top })
        }
        place()
        window.addEventListener('scroll', place, true)
        window.addEventListener('resize', place)
        return () => {
          window.removeEventListener('scroll', place, true)
          window.removeEventListener('resize', place)
        }
      }, [open, pane])

      if (config === undefined) return null

      const update = (patch: Partial<Selection>) => {
        if (busy) return
        const current = copyModels(scope.getSnapshot().value, modeOf(scope.getSnapshot().value?.defaultMode, 'standard'), summaryOf(scope.getSnapshot().value?.defaultSummary, 'auto'))
        const next = current.map((item) => keyOf(item) === routeId ? { ...item, ...patch } : item)
        setBusy(true)
        scope.mutate([{ op: 'set', path: ['models'], value: next }]).catch(() => {}).finally(() => setBusy(false))
      }
      const close = () => {
        setOpen(false)
        setPane('root')
      }
      const modeLabel = config.mode === 'standard' ? t('standard') : t('pro')
      const summaryLabel = config.summary === 'concise' ? t('concise') : config.summary === 'detailed' ? t('detailed') : t('auto')
      const option = (value: string, label: string, current: string, patch: Partial<Selection>) => e('button', {
        type: 'button', className: 'rm-menu-option', role: 'menuitemradio', 'aria-checked': current === value, disabled: busy,
        onClick: () => { update(patch); close() },
      },
        e('span', { className: 'rm-menu-option-copy' }, e('span', { className: 'rm-menu-option-label' }, label)),
        e('span', { className: 'rm-menu-check', 'aria-hidden': true }, current === value ? e(IconCheckOutline16, null) : null),
      )
      const cell = (label: string, value: string, nextPane: string) => e('button', {
        type: 'button', className: 'rm-menu-cell', role: 'menuitem', 'aria-haspopup': 'menu',
        onClick: () => setPane(nextPane),
      },
        e('span', { className: 'rm-menu-cell-label' }, label),
        e('span', { className: 'rm-menu-cell-value' }, value),
        e(IconChevronRightOutline14, { className: 'rm-menu-cell-chevron' }),
      )
      const menu = e('div', {
        ref: menuRef, id: menuId, className: 'rm-control-menu', style: menuPos ?? { visibility: 'hidden', left: 0, top: 0 },
        role: 'menu', 'aria-label': t('menuLabel'), 'aria-busy': busy,
      },
        pane === 'root' ? e(React.Fragment, null,
          cell(t('modeLabel'), modeLabel, 'mode'),
          cell(t('summaryLabel'), summaryLabel, 'summary'),
        ) : pane === 'mode' ? e(React.Fragment, null,
          option('standard', t('standard'), config.mode, { mode: 'standard' }),
          option('pro', t('pro'), config.mode, { mode: 'pro' }),
        ) : e(React.Fragment, null,
          option('auto', t('auto'), config.summary, { summary: 'auto' }),
          option('concise', t('concise'), config.summary, { summary: 'concise' }),
          option('detailed', t('detailed'), config.summary, { summary: 'detailed' }),
        ),
      )
      const menuNode = ReactDOM && typeof ReactDOM.createPortal === 'function' && typeof document !== 'undefined'
        ? ReactDOM.createPortal(menu, document.body)
        : menu

      return e('div', { className: 'rm-control-root', ref: rootRef },
        e('button', {
          ref: triggerRef,
          type: 'button', className: 'rm-control-trigger', disabled: props.locked || busy,
          'aria-label': `${t('modeLabel')}: ${modeLabel}; ${t('summaryLabel')}: ${summaryLabel}`,
          'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? menuId : undefined,
          title: `${modeLabel} · ${summaryLabel}`,
          onClick: () => { if (open) close(); else { setPane('root'); setOpen(true) } },
        },
          e('span', { className: 'rm-control-value' }, modeLabel),
          e('span', { className: 'rm-control-separator', 'aria-hidden': true }, '·'),
          e('span', { className: 'rm-control-value' }, summaryLabel),
          e(IconChevronDownOutline14, { className: `rm-control-chevron ${open ? 'rm-control-chevron-open' : ''}` }),
        ),
        open ? menuNode : null,
      )
    }

    function apply(ctx: any): void {
      if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="reasoning-mode"]')) {
        const style = document.createElement('style')
        style.dataset.pluginCss = 'reasoning-mode'
        style.textContent = css
        document.head.appendChild(style)
      }
      const slots = ctx.slots
      const settingsScope = ctx.settingsScope
      const locale = ctx.locale
      if (!slots || !settingsScope || !locale) return
      const scope = settingsScope.bind({ namespace: NS })
      const t = locale.bind(NS)
      const sessionFace = (): SessionFace | undefined => {
        const viaNamespace = typeof ctx.get === 'function' ? ctx.get('remote.session') : undefined
        if (viaNamespace !== undefined) return viaNamespace as SessionFace
        const remote = typeof ctx.get === 'function' ? ctx.get('remote') : ctx.remote
        return remote === undefined || remote === null ? undefined : remote.session as SessionFace
      }
      ctx.effect(() => locale.register(NS, { zh, en }), 'reasoning-mode: locale dictionaries')
      slots.inject('settings.plugin.item', () => slots.register({
        name: 'settings.plugin.item',
        key: NS,
        locale: NS,
        inject: () => ({ scope, sessionFace, t }),
      }, (props: any) => e(ReasoningModeCard, { ...props, scope, sessionFace, t })))
      slots.inject('conversation.input.right', () => slots.register({
        name: 'conversation.input.right',
        id: NS,
        order: 85,
        locale: NS,
      }, (props: any) => e(ModeControl, { ...props, scope, t })))
    }

    return { apply, inject: ['slots', 'settingsScope', 'locale', 'remote', 'remote.session'] }
  },
})
