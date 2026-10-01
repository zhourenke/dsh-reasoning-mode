import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

// ---------------------------------------------------------------------------
// The host contracts this file models, as measured from the installed
// 0.2.0-rc.2 packages. Keep the citations when editing: a mock that drifts from
// the real contract hides defects instead of catching them (a "false green" —
// see PLUGIN_RELEASE_GUIDE.md -> guide/verification-method.md "验证本身也会骗你").
//
// 1. Our row's configuration page is the seat `plugins.row.config`, declared by
//    the plugins page (not by our plugin, and not by the settings domain):
//      @deepseek-ai/dsh-client-ui-plugin-manager/lib/types/client/slot-contract.d.ts
//        'plugins.row.config': { kind: 'keyed'; scope: 'root';
//                                owner: PluginConfigViewProps }
//    It is keyed by `<package name>#<row id>` with the row id as the bundle's
//    patch declares it, so the key is
//    `@zhourenke/dsh-reasoning-mode#reasoning-mode`. The owner renders the entry
//    twice: `view: 'summary'` for the row's one-liner (also the fallback when the
//    row has no description) and `view: 'page'`, with the Host form, for the body
//    of the entry's own page. The page draws the title, icon, and crumb itself.
//
// 2. Registration shape: the page is registered only while the Host serves our
//    namespace, i.e. inside `ctx.configForms.whileServed([NS], …)` (the owner
//    passes no form to a page whose namespace it cannot serve), and the service
//    is read as `ctx.configForms.get(NS)`.
//
// 3. `ConfigPageForm` is the Host's write path for that entry
//    (same package, slot-contract.d.ts:150):
//      { state: ConfigFormSnapshot<Record<string, unknown>>,   // accepted values
//        mutate(ops, expectedRevision?): Promise<boolean> }    // revision-fenced
//    `ConfigFormSnapshot` comes from '@deepseek-ai/dsh-client-ui-settings/client'
//    and exposes { status: 'loading' | 'ready' | 'unavailable', value, base, user,
//    revision, writable, mode }. The page returns null unless status is 'ready',
//    so an unanswered Host renders nothing rather than an empty form, and it
//    commits the whole route list with one `set ['models']` write carrying the
//    revision it staged against.
//
// 4. The frame, the Save/Discard controls and the failure notice belong to the
//    official form primitive (`@deepseek-ai/dsh-client-ui-primitives`
//    SettingsForm), which the plugin feeds with its own labels
//    (unavailable / readOnly / saveFailed / save / saving) and shell state
//    (available / writable / dirty / invalid / saving / failed).
//
// 5. `remote.session.modelCatalog()` resolves the Host-generation model catalog
//    (`dsh-api-session-controller/lib/types/types.d.ts` ModelCatalog:
//    `default: ModelSelection` is the model used by unconfigured Sessions).
//    The official composer model seat renders `projected.next ??
//    catalog.value.default` (`dsh-client-ui-model-selection/lib/client.js`
//    ModelDirectory.syncInputs), which is why a new Session with an empty
//    projection still shows a model seat. The `{ ok, value, error }` wrapper
//    is the RPC result shape that `ModelCatalogDirectory.load()` checks
//    (`response.ok` before reading `response.value`).
//
// 6. `sessionId` and `useProjection` reach the slot from the built-in session
//    standard source (`dsh-client-ui-session/lib/client.js` BUILTIN_SOURCE:
//    `props: ['sessionId']`, `keyedHooks: ['projection']`), so
//    `conversation.input.right` occupants can read both even though the slot's
//    owner props are `{}`. `sessionId === undefined` is the no-Session inert
//    composer, which is why the fallback must not fire there.
//
// 7. The composer control is the official `Menu` primitive, driven as data:
//    `items` rows, `{ type: 'label' }` headings, `{ type: 'separator' }`
//    hairlines, `selectedIds` for independent option groups, and the primitive's
//    own trailing check (`Menu.d.ts`; `Menu.module.css` `.item` / `.itemIcon` /
//    `.itemLabel` / `.check` / `.label` / `.separator`). Its nested `submenu`
//    card is NOT used and must not be: it is `position: absolute; bottom: -4px;
//    left: calc(100% + 10px)` inside the parent card (`Menu.module.css`
//    `.submenu`), so from the composer's right-most control — whose card is
//    already clamped 12px from the viewport's right edge (`Menu.tsx` MARGIN) —
//    a second level can only ever render off the screen. Nested rows are also
//    the one place the primitive draws no check.
//
// 8. The trigger's measurements and colors are the official model seat's, the
//    control the composer actually puts on that line
//    (`dsh-client-ui-model-selection/lib/client.js` css: `.trigger` weight 400,
//    `label-secondary`, `radius-sm`, `min(360px, 45cqw)`, focus ring
//    `--dsw-focus-ring-color`; `.triggerEffort` `label-caption`; `.chevron`
//    `label-caption` plus the 180° open rotation). `StateDot state="ongoing"`
//    replaces that chevron while the seat's write is in flight.
//
// NOT modelled here: React's reconciler and full hook semantics (the default
// stub only invokes lazy state initializers and memo callbacks), the host's real
// slot registry, and the page that dispatches the slots. The focused tests below
// use a small state/effect runner only to model the rerenders that matter; it is
// not a replacement for React. This file proves the plugin's side of the
// contract; the Host's side is proven by the page appearing in a running
// deployment.
// ---------------------------------------------------------------------------

// The browser half is a plain script: it registers itself through
// `window.__ModuleLoader__.load(...)` at module scope, so the stub must exist
// before the module is evaluated. This is the only test that executes
// `lib/client.js`; the rest assert on its source and on the Host half.
const definitions = []
globalThis.window = { __ModuleLoader__: { load: (definition) => definitions.push(definition) } }
await import('../lib/client.js')

assert.equal(definitions.length, 1)
const definition = definitions[0]

/**
 * Build a factory `require` that satisfies the modules the browser half
 * imports. `elements` records every `createElement` call, which is how a test
 * observes what the page would render, and `primitives` is the stub the source
 * destructures, so a test can recognise the official form element.
 */
function makeRequire(options = {}) {
  const requested = []
  const elements = []
  const primitives = {
    // The official menu: this plugin hands it the rows and owns nothing else —
    // each row's fill, the group headings, the hairlines and the trailing check
    // are all the primitive's (`Menu.module.css`).
    Menu: () => null,
    SettingsForm: () => null,
    IconChevronDownOutlineRegular: () => ({}),
    StateDot: () => ({}),
  }
  const React = options.React ?? {
    createElement: (component, props, ...children) => {
      const element = { component, props, children }
      elements.push(element)
      return element
    },
    useEffect: () => {},
    useMemo: (fn) => fn(),
    // React invokes a function initial state lazily; the page relies on it to
    // copy the accepted selection out of the Host form.
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  }
  const require = (id) => {
    requested.push(id)
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    if (id === 'react-dom') return { createPortal: (node) => node }
    throw new Error(`unexpected dependency: ${id}`)
  }
  return { require, requested, elements, primitives }
}

/** A `ready` Host-form snapshot with no accepted model routes. */
function readyValue(value = { models: [] }, revision = 1) {
  return { status: 'ready', value, writable: true, revision }
}

/**
 * Minimal stand-in for the client services the browser half touches, shaped
 * after the measured contracts above. `options.form` overrides the Host form
 * the page owner would hand the row's page; `options.value` seeds the accepted
 * values of the default one.
 */
function makeCtx(options = {}) {
  const state = { injected: [], registered: [], locales: [], effects: 0, served: [], read: [], translations: [] }
  const writes = []
  const sets = []
  const form = options.form ?? {
    state: readyValue(options.value),
    mutate: async (ops, expectedRevision) => { writes.push({ ops, expectedRevision }); return true },
  }
  // The Host serves one object to both faces: the page reads `state` + `mutate`
  // (contract fact 3) while the composer control reads the live ConfigForm
  // surface (getSnapshot / subscribe / set) off the same namespace.
  const handle = Object.assign({
    getSnapshot: () => form.state,
    subscribe: () => () => {},
    set: options.set ?? (async (field, value) => { sets.push({ field, value }); return true }),
  }, form)
  // The renderer composes every entry's kit, and the translator is part of it:
  // an entry that declares `locale:` gets `kit.t = localeSeat(face, ns)` — the
  // same key domain as `face.bind(ns)`, memoized per locale revision — and the
  // renderer *throws* when no locale face is installed (contract fact 5 in
  // `dsh-client-ui-renderer/lib/client.js`). So the harness supplies it here and
  // the plugin must never bind its own translator.
  const localeFace = {
    // The official translator fills the template's `{name}` placeholders from
    // the params object (`dsh-client-locale/lib/client.js`:
    // `template.replace(/\{(\w+)\}/g, …)`). The harness echoes the key so that
    // assertions read `namespace:key`, and records every call so a test can
    // prove a parameter was passed rather than patched into the result here.
    bind: (namespace) => (key, params) => {
      state.translations.push({ key, params })
      return `${namespace}:${key}`
    },
    register(namespace, dictionaries) {
      state.locales.push({ namespace, dictionaries })
      return () => {}
    },
  }
  const ctx = {
    slots: {
      inject(name, callback) {
        state.injected.push(name)
        callback()
      },
      register(slotDefinition, render) {
        const kit = slotDefinition.locale === undefined
          ? render
          : (props) => render({ ...props, t: localeFace.bind(slotDefinition.locale) })
        state.registered.push({ slotDefinition, render: kit })
        return () => {}
      },
    },
    configForms: {
      get: (namespace) => {
        state.read.push(namespace)
        return handle
      },
      whileServed: (namespaces, callback) => {
        state.served.push(...namespaces)
        return callback()
      },
    },
    locale: localeFace,
    effect(callback) {
      state.effects += 1
      callback()
      return () => {}
    },
    get: (name) => (name === 'remote.session'
      ? { modelCatalog: options.modelCatalog ?? (async () => ({ ok: true, value: { groups: [] } })) }
      : undefined),
  }
  return { ctx, state, form, writes, sets }
}

function makeHookRunner() {
  const state = []
  const dependencies = []
  const cleanups = []
  const elements = []
  let hookIndex = 0
  let pendingEffects = []

  const sameDependencies = (left, right) => left !== undefined
    && right !== undefined
    && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]))

  const schedule = (effect, deps) => {
    const index = hookIndex++
    if (dependencies[index] === undefined || !sameDependencies(dependencies[index], deps)) {
      dependencies[index] = deps
      pendingEffects.push({ effect, index })
    }
  }

  const React = {
    Fragment: () => null,
    createElement: (component, props, ...children) => {
      const element = { component, props, children }
      elements.push(element)
      return element
    },
    useEffect: schedule,
    useMemo: (fn) => {
      hookIndex += 1
      return fn()
    },
    useState: (initial) => {
      const index = hookIndex++
      if (state[index] === undefined) state[index] = typeof initial === 'function' ? initial() : initial
      return [state[index], (next) => {
        const value = typeof next === 'function' ? next(state[index]) : next
        if (!Object.is(state[index], value)) state[index] = value
      }]
    },
  }

  return {
    React,
    elements,
    render(component, props) {
      hookIndex = 0
      pendingEffects = []
      return component(props)
    },
    flushEffects() {
      const effects = pendingEffects
      pendingEffects = []
      for (const { effect, index } of effects) {
        cleanups[index]?.()
        cleanups[index] = effect()
      }
    },
  }
}

function renderRegistered(runner, registration, props) {
  return runner.render((nextProps) => {
    const element = registration.render(nextProps)
    return element.component(element.props)
  }, props)
}

const settle = async () => {
  await Promise.resolve()
  await new Promise((resolve) => setImmediate(resolve))
}

/**
 * Strip comments from a source or bundle text. `tsc` keeps every comment in the
 * built bundle, and several assertions below check that an identifier is *gone*;
 * without this, the prose that records why an approach was rejected would read as
 * its presence.
 */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

test('registers the row configuration page and the composer control', () => {
  const { require } = makeRequire()
  const plugin = definition.factory(require)
  const { ctx, state } = makeCtx()
  plugin.apply(ctx)

  assert.deepEqual(state.injected, ['plugins.row.config', 'conversation.input.right'])
  assert.deepEqual(state.registered.map((item) => item.slotDefinition.name), ['plugins.row.config', 'conversation.input.right'])
  assert.equal(state.registered[0].slotDefinition.key, '@zhourenke/dsh-reasoning-mode#reasoning-mode')
  assert.equal(state.registered[1].slotDefinition.id, 'reasoning-mode')
  // The page must not exist unless the Host serves the namespace it configures.
  assert.deepEqual(state.served, ['reasoning-mode'])
  assert.deepEqual(state.read, ['reasoning-mode'])
  assert.equal(state.effects, 2, 'one effect for the dictionaries and one for the page gate')
})

test('builds the composer menu from the official primitive and re-implements nothing', () => {
  const source = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
  const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /conversation\.input\.left/)
  const legacySummaryLabel = ['摘要', '级别'].join('')
  assert.doesNotMatch(source, new RegExp(legacySummaryLabel))
  assert.match(source, /conversation\.input\.right/)
  assert.match(source, /摘要等级/)
  // Both registrations declare `locale: NS`, which is what puts the translator
  // on their props (the renderer composes `kit.t` from the entry's `locale` and
  // throws when no locale face is installed). Binding our own translator would
  // shadow that identical prop, so the source must contain none.
  assert.equal((source.match(/locale: NS,/g) ?? []).length, 2)
  assert.doesNotMatch(source, /locale\.bind/)
  // One flat official card: two group headings, the five option rows, and a
  // hairline between the groups (contract fact 7). Both selections are marked by
  // the primitive (`selection: 'check'` + `selectedIds`), so the plugin stages no
  // glyph of its own.
  assert.match(source, /type: 'label', id: 'label:mode', text: t\('modeLabel'\)/)
  assert.match(source, /type: 'label', id: 'label:summary', text: t\('summaryLabel'\)/)
  assert.match(source, /type: 'separator', id: 'separator:groups'/)
  assert.match(source, /selection: 'check'/)
  assert.match(source, /selectedIds: \[`mode:\$\{config\.mode\}`, `summary:\$\{config\.summary\}`\]/)
  assert.match(source, /onSelect: update/)
  assert.match(source, /'mode:pro': \{ mode: 'pro' \}/)
  assert.match(source, /'summary:detailed': \{ summary: 'detailed' \}/)
  // The nested side card is unreachable from this anchor and must not come back,
  // with the hand-rolled row/cell/check markup it needed.
  const code = withoutComments(source)
  const bundleCode = withoutComments(bundle)
  assert.doesNotMatch(code, /submenu/)
  assert.doesNotMatch(code, /rm-cell|rm-option/)
  assert.doesNotMatch(bundleCode, /rm-cell|rm-option|submenu/)
  // The trigger copies the official model seat's tokens verbatim (fact 8), and
  // the card hands its height budget to the primitive instead of clipping.
  assert.match(source, /\.rm-control-trigger \{[^}]*font-weight: 400;/)
  assert.match(source, /\.rm-control-trigger \{[^}]*color: var\(--dsw-alias-label-secondary\);/)
  assert.match(source, /\.rm-control-trigger \{[^}]*border-radius: var\(--dsw-radius-sm\);/)
  assert.match(source, /\.rm-control-trigger \{[^}]*max-width: min\(360px, 45cqw\);/)
  assert.match(source, /\.rm-control-trigger:focus-visible \{ box-shadow: 0 0 0 2px var\(--dsw-focus-ring-color, var\(--dsw-alias-state-business-primary\)\); \}/)
  assert.match(source, /\.rm-control-effort \{[^}]*color: var\(--dsw-alias-label-caption\);/)
  assert.match(source, /\.rm-control-chevron \{[^}]*color: var\(--dsw-alias-label-caption\);/)
  assert.match(source, /\.rm-control-menu \{[^}]*max-width: min\(420px, calc\(100vw - 32px\)\); \}/)
  assert.doesNotMatch(source, /\.rm-control-menu \{[^}]*overflow: hidden/)
  // Dead rules and dead keys may not linger either.
  assert.doesNotMatch(code, /rm-readonly/)
  assert.doesNotMatch(code, /menuLabel/)
  // Nothing here re-implements what the primitive owns.
  assert.doesNotMatch(source, /rm-menu|createPortal|ReactDOM|mousedown|useLayoutEffect|getBoundingClientRect|aria-controls/)
  assert.doesNotMatch(bundleCode, /rm-menu|createPortal|ReactDOM|mousedown|getBoundingClientRect/)
  assert.match(bundle, /rm-control-effort[^}]*label-caption/)
})

test('hands the official Menu one flat card whose option rows are the only writes', async () => {
  const runner = makeHookRunner()
  const { require, primitives, requested } = makeRequire({ React: runner.React })
  const plugin = definition.factory(require)
  const route = { provider: 'provider-a', model: 'model-a', mode: 'standard', summary: 'auto' }
  const { ctx, state, sets } = makeCtx({ value: { models: [route] } })
  plugin.apply(ctx)
  // react-dom went with the hand-written portal.
  assert.equal(requested.includes('react-dom'), false)

  const menuElement = renderRegistered(runner, state.registered[1], {
    sessionId: 'session-1',
    useProjection: () => ({ next: { provider: 'provider-a', model: 'model-a' }, lastUsed: null }),
  })
  runner.flushEffects()
  assert.equal(menuElement.component, primitives.Menu, 'the control renders the official Menu primitive')
  const menu = menuElement.props
  assert.equal(menu.open, false)
  assert.equal(menu.side, 'top')
  assert.equal(menu.align, 'end')
  assert.equal(menu.portal, true)
  assert.equal(menu.className, 'rm-control-root')
  assert.equal(menu.listClassName, 'rm-control-menu')
  // Two headings, two independent option groups, one hairline between them.
  assert.deepEqual(menu.items.map((item) => item.id), [
    'label:mode', 'mode:standard', 'mode:pro', 'separator:groups',
    'label:summary', 'summary:auto', 'summary:concise', 'summary:detailed',
  ])
  assert.equal(menu.items[0].type, 'label')
  assert.equal(menu.items[0].text, 'reasoning-mode:modeLabel')
  assert.equal(menu.items[3].type, 'separator')
  assert.equal(menu.items[4].text, 'reasoning-mode:summaryLabel')
  assert.deepEqual(menu.items.slice(1, 3).map((item) => item.label), ['reasoning-mode:standard', 'reasoning-mode:pro'])
  // The primitive marks both current values itself; the plugin supplies no glyph.
  assert.equal(menu.selection, 'check')
  assert.deepEqual(menu.selectedIds, ['mode:standard', 'summary:auto'])
  // The trigger stays the anchor the primitive returns focus to: the value, the
  // summary, and the chevron — no separator of our own (contract fact 8).
  const trigger = menu.anchor
  assert.equal(trigger.props.className, 'rm-control-trigger')
  assert.equal(trigger.props['aria-haspopup'], 'menu')
  assert.equal(trigger.props['aria-expanded'], false)
  assert.equal(trigger.props['aria-busy'], false)
  assert.equal(trigger.props.disabled, false)
  assert.equal(trigger.children.length, 3)
  assert.equal(trigger.children[0].props.className, 'rm-control-value')
  assert.equal(trigger.children[1].props.className, 'rm-control-effort')
  assert.deepEqual(trigger.children[0].children, ['reasoning-mode:standard'])
  assert.deepEqual(trigger.children[1].children, ['reasoning-mode:auto'])
  assert.equal(trigger.children[2].component, primitives.IconChevronDownOutlineRegular)

  menu.onSelect('summary:concise')
  await settle()
  // Live, unstaged: one field write carrying the whole patched route list.
  assert.deepEqual(sets, [{
    field: 'models',
    value: [{ provider: 'provider-a', model: 'model-a', mode: 'standard', summary: 'concise' }],
  }])
  // A heading, a hairline and an unknown id select nothing.
  menu.onSelect('label:mode')
  menu.onSelect('separator:groups')
  menu.onSelect('summary:unknown')
  await settle()
  assert.equal(sets.length, 1)
  assert.equal(typeof menu.onClose, 'function')
})

test('swaps the chevron for the official pending dot while the write is in flight', async () => {
  const runner = makeHookRunner()
  const { require, primitives } = makeRequire({ React: runner.React })
  const plugin = definition.factory(require)
  let release
  const inFlight = new Promise((resolve) => { release = resolve })
  const { ctx, state } = makeCtx({
    value: { models: [{ provider: 'provider-a', model: 'model-a', mode: 'standard', summary: 'auto' }] },
    set: () => inFlight,
  })
  plugin.apply(ctx)
  const props = {
    sessionId: 'session-1',
    useProjection: () => ({ next: { provider: 'provider-a', model: 'model-a' }, lastUsed: null }),
  }

  const idle = renderRegistered(runner, state.registered[1], props)
  runner.flushEffects()
  assert.equal(idle.props.anchor.children[2].component, primitives.IconChevronDownOutlineRegular)

  idle.props.onSelect('mode:pro')
  const busy = renderRegistered(runner, state.registered[1], props)
  assert.equal(busy.props.open, false, 'selecting an option closes the card')
  assert.equal(busy.props.anchor.props['aria-busy'], true)
  assert.equal(busy.props.anchor.props.disabled, true)
  assert.equal(busy.props.anchor.children[2].component, primitives.StateDot)

  release(true)
  await settle()
  const settled = renderRegistered(runner, state.registered[1], props)
  assert.equal(settled.props.anchor.props['aria-busy'], false)
  assert.equal(settled.props.anchor.props.disabled, false)
  assert.equal(settled.props.anchor.children[2].component, primitives.IconChevronDownOutlineRegular)
})

test('declares the page services and the conversation client dependencies', () => {
  const plugin = definition.factory(makeRequire().require)
  assert.deepEqual(plugin.inject, ['slots', 'configForms', 'locale', 'remote', 'remote.session'])
})

test('keeps the page models-only and uses checkbox-only catalog rows', () => {
  const source = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
  const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(source, /value\?: \{ models\?: Selection\[\] \}/)
  assert.match(source, /scope\.set\('models', next\)/)
  // The whole list is staged locally and committed as one revision-fenced write.
  assert.match(source, /form\.mutate\(\[\{ op: 'set', path: \['models'\], value: draftModels \}\], revision\)/)
  assert.match(source, /modelsHint: '只有勾选的 provider\/model 会改变 Responses 请求；未出现在目录中的已保存路由仍会保留。'/)
  assert.match(source, /\.rm-models \{[^}]*max-height: 280px;/)
  assert.match(source, /\.rm-model \{[^}]*grid-template-columns: auto minmax\(0, 1fr\) auto;/)
  assert.match(source, /Keep saved routes in the staged candidate set until Save commits an uncheck/)
  assert.match(source, /for \(const item of effective\.values\(\)\)/)
  // The frame, its save control and its failure notice are the official form's.
  assert.match(source, /return e\(SettingsForm, \{/)
  assert.match(source, /unavailable: t\('formUnavailable'\)/)
  assert.doesNotMatch(source, /rm-card|rm-head|rm-footer|rm-save|rm-discard|rm-chevron\b/)
  assert.doesNotMatch(source, /\bdefaultMode\b|\bdefaultSummary\b|\bdraftMode\b|\bdraftSummary\b|scope\.mutate|scope\.set\('models', draftModels\)/)
  assert.doesNotMatch(source, /<select|rm-select|rm-defaults|routeHint|unavailableRoute/)
  assert.doesNotMatch(bundle, /defaultMode|defaultSummary|scope\.mutate|rm-select|rm-defaults|rm-card/)
})

test('the slot mount forwards the injected face to the page', () => {
  const { require, primitives, elements } = makeRequire()
  const plugin = definition.factory(require)
  const { ctx, state, form } = makeCtx()
  plugin.apply(ctx)

  // The owner passes only the view and the Host form (contract fact 1), so the
  // render closure is what has to hand the page its catalog face; the translator
  // arrives from the seat instead, and only because the registration declares
  // `locale` (the harness composes the kit the way the renderer does).
  const element = state.registered[0].render({ view: 'page', form })
  assert.equal(typeof element.component, 'function')
  assert.equal(state.registered[0].slotDefinition.locale, 'reasoning-mode')

  const page = element.component(element.props)
  assert.ok(page, 'a ready Host form must render the page')
  assert.equal(page.component, primitives.SettingsForm)
  assert.ok(elements.length > 1, 'the page must build its own element tree')
  assert.equal(elements[0].component, element.component)
  assert.equal(element.props.t('description'), 'reasoning-mode:description')
  assert.equal(typeof element.props.sessionFace, 'function')
  // The Host form is the owner's; the page must not smuggle a scope of its own.
  assert.equal(element.props.scope, undefined)
})

test('the page renders nothing until the Host answers with a ready form', () => {
  const { require, elements } = makeRequire()
  const plugin = definition.factory(require)
  const { ctx, state } = makeCtx()
  plugin.apply(ctx)

  const loading = { state: { status: 'loading', value: undefined, writable: true }, mutate: async () => false }
  const element = state.registered[0].render({ view: 'page', form: loading })
  const page = element.component(element.props)
  assert.equal(page, null)
  assert.equal(elements.length, 1, 'only the slot element itself may be created')
})

test('the page renders nothing when the owner serves no form at all', () => {
  const { require } = makeRequire()
  const plugin = definition.factory(require)
  const { ctx, state } = makeCtx()
  plugin.apply(ctx)
  const element = state.registered[0].render({ view: 'page' })
  assert.equal(element.component(element.props), null)
})

test('the summary view is the row one-liner and never loads a catalog', async () => {
  const runner = makeHookRunner()
  const { require } = makeRequire({ React: runner.React })
  const plugin = definition.factory(require)
  let calls = 0
  const { ctx, state } = makeCtx({
    modelCatalog: async () => {
      calls += 1
      return { ok: true, value: { groups: [] } }
    },
  })
  plugin.apply(ctx)

  const element = renderRegistered(runner, state.registered[0], { view: 'summary' })
  runner.flushEffects()
  await settle()

  assert.equal(element.component, 'span')
  assert.deepEqual(element.children, ['reasoning-mode:description'])
  assert.equal(calls, 0, 'the one-liner must not read the model catalog')
})

test('stages the route list and commits it with one revision-fenced write', async () => {
  const runner = makeHookRunner()
  const { require, primitives } = makeRequire({ React: runner.React })
  const plugin = definition.factory(require)
  const writes = []
  const { ctx, state, form } = makeCtx({
    form: {
      state: readyValue({ models: [] }, 7),
      mutate: async (ops, expectedRevision) => { writes.push({ ops, expectedRevision }); return true },
    },
    modelCatalog: async () => ({
      ok: true,
      value: {
        default: { provider: 'provider-a', model: 'model-a' },
        groups: [{ id: 'provider-a', name: 'Provider A', models: [{ id: 'model-a', name: 'Model A' }] }],
      },
    }),
  })
  plugin.apply(ctx)

  const props = { view: 'page', form }
  renderRegistered(runner, state.registered[0], props)
  runner.flushEffects()
  await settle()
  renderRegistered(runner, state.registered[0], props)

  const row = runner.elements.filter((element) => element.component?.name === 'ModelRow').pop()
  assert.ok(row, 'the catalog row must be rendered')
  assert.equal(row.props.checked, false)
  row.props.onToggle()
  renderRegistered(runner, state.registered[0], props)

  const shell = runner.elements.filter((element) => element.component === primitives.SettingsForm).pop()
  assert.ok(shell, 'the official form must wrap the controls')
  assert.equal(shell.props.state.dirty, true)
  assert.equal(shell.props.state.writable, true)
  assert.equal(shell.props.labels.save, 'reasoning-mode:save')

  // The count reaches the translator as a parameter; the plugin does not patch
  // `{n}` into the returned string itself.
  const countCall = state.translations.filter((call) => call.key === 'selected').pop()
  assert.deepEqual(countCall?.params, { n: 1 })

  shell.props.onSave()
  await settle()

  assert.deepEqual(writes, [{
    ops: [{ op: 'set', path: ['models'], value: [{ provider: 'provider-a', model: 'model-a', mode: 'standard', summary: 'auto' }] }],
    expectedRevision: 7,
  }])
})

test('shows the composer control for a new session after the catalog supplies its default route', async () => {
  const runner = makeHookRunner()
  const { require } = makeRequire({ React: runner.React })
  const plugin = definition.factory(require)
  let calls = 0
  const { ctx, state } = makeCtx({
    value: { models: [{ provider: 'provider-a', model: 'model-a', mode: 'standard', summary: 'auto' }] },
    modelCatalog: async () => {
      calls += 1
      return { ok: true, value: { default: { provider: 'provider-a', model: 'model-a' }, groups: [] } }
    },
  })
  plugin.apply(ctx)

  const registered = state.registered[1]
  const props = { sessionId: 'session-a', useProjection: () => ({ next: null, lastUsed: null }) }
  assert.equal(renderRegistered(runner, registered, props), null)
  runner.flushEffects()
  await Promise.resolve()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(calls, 1)
  const control = renderRegistered(runner, registered, props)
  assert.equal(control.props.className, 'rm-control-root')
})

test('does not request a catalog or render the composer control without a session', async () => {
  const runner = makeHookRunner()
  const { require } = makeRequire({ React: runner.React })
  const plugin = definition.factory(require)
  let calls = 0
  const { ctx, state } = makeCtx({
    value: { models: [{ provider: 'provider-a', model: 'model-a', mode: 'standard', summary: 'auto' }] },
    modelCatalog: async () => {
      calls += 1
      return { ok: true, value: { default: { provider: 'provider-a', model: 'model-a' }, groups: [] } }
    },
  })
  plugin.apply(ctx)

  const registered = state.registered[1]
  const props = { useProjection: () => ({ next: null, lastUsed: null }) }
  assert.equal(renderRegistered(runner, registered, props), null)
  runner.flushEffects()
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(renderRegistered(runner, registered, props), null)
  assert.equal(calls, 0)
})


// ---------------------------------------------------------------------------
// The states a user can hit and the wording they see: a route the catalog
// dropped, a refused write, a catalog that will not load.
// ---------------------------------------------------------------------------

test('keeps a saved route the catalog no longer carries and renders both row kinds', async () => {
  const runner = makeHookRunner()
  const { require } = makeRequire({ React: runner.React })
  const plugin = definition.factory(require)
  const { ctx, state, form } = makeCtx({
    form: {
      state: readyValue({
        models: [
          { provider: 'provider-a', model: 'model-a', mode: 'pro', summary: 'detailed' },
          { provider: 'provider-gone', model: 'model-gone', mode: 'pro', summary: 'concise' },
        ],
      }, 4),
      mutate: async () => true,
    },
    modelCatalog: async () => ({
      ok: true,
      value: {
        default: { provider: 'provider-a', model: 'model-a' },
        groups: [{ id: 'provider-a', name: 'Provider A', models: [{ id: 'model-a', name: 'Model A' }] }],
      },
    }),
  })
  plugin.apply(ctx)

  const props = { view: 'page', form }
  renderRegistered(runner, state.registered[0], props)
  runner.flushEffects()
  await settle()
  const before = runner.elements.length
  renderRegistered(runner, state.registered[0], props)
  const fresh = runner.elements.slice(before)

  assert.deepEqual(
    fresh.filter((element) => element.props?.className === 'rm-provider').map((element) => element.children[0]),
    ['Provider A', 'reasoning-mode:unavailableGroup'],
    'the dropped route keeps its own group instead of vanishing',
  )

  const rows = fresh.filter((element) => element.component?.name === 'ModelRow')
  assert.deepEqual(
    rows.map((row) => [row.props.item.provider, row.props.item.model, row.props.available, row.props.checked]),
    [
      ['provider-a', 'model-a', true, true],
      ['provider-gone', 'model-gone', false, true],
    ],
    'a dropped route stays listed and stays checked until Save removes it',
  )

  // A shallow render records elements without running child components, so the
  // two row bodies are invoked here directly — one per arm of the chip.
  const live = rows[0].component(rows[0].props)
  assert.equal(live.props.className, 'rm-model')
  assert.equal(live.children[0].props.type, 'checkbox')
  assert.equal(live.children[2], null, 'a route the catalog carries needs no chip')

  const gone = rows[1].component(rows[1].props)
  assert.equal(gone.children[2].props.className, 'rm-unavailable')
  assert.deepEqual(gone.children[2].children, ['reasoning-mode:unavailable'])
  assert.equal(gone.children[1].children[1].children[0], 'provider-gone · provider-gone/model-gone')
})

test('reports a refused write and lets Discard return to the saved list', async () => {
  const runner = makeHookRunner()
  const { require, primitives } = makeRequire({ React: runner.React })
  const plugin = definition.factory(require)
  const { ctx, state, form } = makeCtx({
    form: {
      state: readyValue({ models: [{ provider: 'provider-a', model: 'model-a', mode: 'standard', summary: 'auto' }] }, 5),
      mutate: async () => false,
    },
    modelCatalog: async () => ({
      ok: true,
      value: {
        default: { provider: 'provider-a', model: 'model-a' },
        groups: [{ id: 'provider-a', name: 'Provider A', models: [{ id: 'model-a', name: 'Model A' }] }],
      },
    }),
  })
  plugin.apply(ctx)

  const props = { view: 'page', form }
  const shell = () => runner.elements.filter((element) => element.component === primitives.SettingsForm).pop()
  renderRegistered(runner, state.registered[0], props)
  runner.flushEffects()
  await settle()
  renderRegistered(runner, state.registered[0], props)

  // Unchecking the only route stages a change; the Host then refuses it.
  runner.elements.filter((element) => element.component?.name === 'ModelRow').pop().props.onToggle()
  renderRegistered(runner, state.registered[0], props)
  assert.equal(shell().props.state.dirty, true)

  shell().props.onSave()
  await settle()
  renderRegistered(runner, state.registered[0], props)
  assert.equal(shell().props.state.failed, true, 'a refusal raises the failure notice')
  assert.equal(shell().props.state.dirty, true, 'and the staged change survives it')

  // Discard is the only way back: the drafts drop, the notice clears.
  shell().props.onDiscard()
  const before = runner.elements.length
  renderRegistered(runner, state.registered[0], props)
  assert.equal(shell().props.state.dirty, false)
  assert.equal(shell().props.state.failed, false)
  assert.equal(
    runner.elements.slice(before).filter((element) => element.component?.name === 'ModelRow').pop().props.checked,
    true,
    'the stored selection is back',
  )
})

test('treats a write that throws as a refusal, never as success', async () => {
  const runner = makeHookRunner()
  const { require, primitives } = makeRequire({ React: runner.React })
  const plugin = definition.factory(require)
  const { ctx, state, form } = makeCtx({
    form: {
      state: readyValue({ models: [] }, 6),
      mutate: async () => { throw new Error('transport closed') },
    },
    modelCatalog: async () => ({
      ok: true,
      value: {
        default: { provider: 'provider-a', model: 'model-a' },
        groups: [{ id: 'provider-a', name: 'Provider A', models: [{ id: 'model-a', name: 'Model A' }] }],
      },
    }),
  })
  plugin.apply(ctx)

  const props = { view: 'page', form }
  renderRegistered(runner, state.registered[0], props)
  runner.flushEffects()
  await settle()
  renderRegistered(runner, state.registered[0], props)

  runner.elements.filter((element) => element.component?.name === 'ModelRow').pop().props.onToggle()
  renderRegistered(runner, state.registered[0], props)
  const shell = runner.elements.filter((element) => element.component === primitives.SettingsForm).pop()
  shell.props.onSave()
  await settle()
  renderRegistered(runner, state.registered[0], props)

  const after = runner.elements.filter((element) => element.component === primitives.SettingsForm).pop()
  assert.equal(after.props.state.failed, true)
  assert.equal(after.props.state.dirty, true, 'a thrown write leaves the drafts in place')
})

test('surfaces a failed catalog load and retries it on demand', async () => {
  const runner = makeHookRunner()
  const { require } = makeRequire({ React: runner.React })
  const plugin = definition.factory(require)
  let attempts = 0
  const { ctx, state, form } = makeCtx({
    form: { state: readyValue({ models: [] }, 2), mutate: async () => true },
    modelCatalog: async () => {
      attempts += 1
      if (attempts === 1) return { ok: false, error: { code: 'unavailable', message: 'catalog offline' } }
      return {
        ok: true,
        value: {
          default: { provider: 'provider-a', model: 'model-a' },
          groups: [{ id: 'provider-a', name: 'Provider A', models: [{ id: 'model-a', name: 'Model A' }] }],
        },
      }
    },
  })
  plugin.apply(ctx)

  const props = { view: 'page', form }
  renderRegistered(runner, state.registered[0], props)
  runner.flushEffects()
  await settle()
  let before = runner.elements.length
  renderRegistered(runner, state.registered[0], props)

  const alert = runner.elements.slice(before).filter((element) => element.props?.className === 'rm-catalog-error').pop()
  assert.ok(alert, 'the failure is announced, not swallowed')
  assert.match(alert.children[0].children[0], /reasoning-mode:catalogFailed \(catalog offline\)/)
  const retry = runner.elements.slice(before).filter((element) => element.component === 'button').pop()
  assert.deepEqual(retry.children, ['reasoning-mode:retry'])
  assert.equal(
    runner.elements.slice(before).filter((element) => element.component?.name === 'ModelRow').length,
    0,
    'nothing to tick while the catalog is missing',
  )

  retry.props.onClick()
  await settle()
  before = runner.elements.length
  renderRegistered(runner, state.registered[0], props)
  const afterRetry = runner.elements.slice(before)
  assert.equal(attempts, 2, 'the retry asks the Host again')
  assert.equal(afterRetry.filter((element) => element.props?.className === 'rm-catalog-error').length, 0)
  assert.ok(afterRetry.filter((element) => element.component?.name === 'ModelRow').pop(), 'and renders the catalog it got')
})

test('hides the composer control when the catalog cannot be reached at all', async () => {
  const runner = makeHookRunner()
  const { require } = makeRequire({ React: runner.React })
  const plugin = definition.factory(require)
  let attempts = 0
  const { ctx, state } = makeCtx({
    value: { models: [{ provider: 'provider-a', model: 'model-a', mode: 'standard', summary: 'auto' }] },
    modelCatalog: async () => { attempts += 1; throw new Error('catalog unreachable') },
  })
  plugin.apply(ctx)

  const registered = state.registered[1]
  const props = { sessionId: 'session-a', useProjection: () => ({ next: null, lastUsed: null }) }
  assert.equal(renderRegistered(runner, registered, props), null)
  runner.flushEffects()
  await settle()
  assert.equal(attempts, 1)
  assert.equal(renderRegistered(runner, registered, props), null, 'no route means no control')

  // A new session re-runs the effect, which must first cancel the one it
  // replaces — otherwise a late answer would set the new session's route.
  renderRegistered(runner, registered, { sessionId: 'session-b', useProjection: () => ({ next: null, lastUsed: null }) })
  runner.flushEffects()
  await settle()
  assert.equal(attempts, 2)
})

test('warns on the console when the Host refuses a composer write', async () => {
  const runner = makeHookRunner()
  const { require, primitives } = makeRequire({ React: runner.React })
  const plugin = definition.factory(require)
  const { ctx, state } = makeCtx({
    value: { models: [{ provider: 'provider-a', model: 'model-a', mode: 'standard', summary: 'auto' }] },
    set: async () => { throw new Error('refused by the Host') },
  })
  plugin.apply(ctx)

  const props = {
    sessionId: 'session-1',
    useProjection: () => ({ next: { provider: 'provider-a', model: 'model-a' }, lastUsed: null }),
  }
  const control = renderRegistered(runner, state.registered[1], props)
  runner.flushEffects()
  const menu = runner.elements.filter((element) => element.component === primitives.Menu).pop()

  // The pill has nowhere to report a refused write, so the console is the only
  // record — and it must exist, or the failure is invisible.
  const warnings = []
  const originalWarn = console.warn
  console.warn = (message) => { warnings.push(String(message)) }
  try {
    control.props.anchor.props.onClick?.()
    menu.props.onSelect('mode:pro')
    await settle()
  } finally {
    console.warn = originalWarn
  }
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /\[reasoning-mode\] the composer write failed: refused by the Host/)
})


test('can be concatenated with the sibling reasoning-summary client bundle', () => {
  const modeBundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const summaryBundle = readFileSync(new URL('../../dsh-reasoning-summary/lib/client.js', import.meta.url), 'utf8')
  assert.doesNotThrow(() => new vm.Script(`${summaryBundle}\n${modeBundle}`))
})

test('injects the stylesheet once and never replaces an existing one', () => {
  const { require } = makeRequire()
  const plugin = definition.factory(require)
  const created = []
  globalThis.document = {
    querySelector: () => undefined,
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: (node) => created.push(node) },
  }
  try {
    plugin.apply(makeCtx().ctx)
    assert.equal(created.length, 1)
    assert.equal(created[0].dataset.pluginCss, 'reasoning-mode')
    assert.match(created[0].textContent, /\.rm-models/)

    // A second activation must not duplicate the stylesheet.
    globalThis.document.querySelector = () => ({})
    plugin.apply(makeCtx().ctx)
    assert.equal(created.length, 1)
  } finally {
    delete globalThis.document
  }
})

test('apply stays inert when the required client services are absent', () => {
  const { require, elements } = makeRequire()
  const plugin = definition.factory(require)
  plugin.apply({ effect: () => {}, get: () => undefined })
  assert.equal(elements.length, 0)
})
