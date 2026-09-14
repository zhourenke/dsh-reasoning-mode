import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

// ---------------------------------------------------------------------------
// The host contracts this file models, as measured from the installed
// 0.1.5-rc.1 packages. Keep the citations when editing: a mock that drifts from
// the real contract hides defects instead of catching them (a "false green" —
// see PLUGIN_RELEASE_GUIDE.md §4.3).
//
// 1. The card seat `settings.plugin.item` is declared at RUNTIME by the Plugins
//    settings section, not by the settings domain package:
//      @deepseek-ai/dsh-client-ui-settings-plugins/lib/types/client/slot-contract.d.ts
//        'settings.plugin.item': { kind: 'keyed'; scope: 'root';
//                                  owner: SettingsPluginItemOwnerProps }
//    `SettingsPluginItemOwnerProps` is a marker (`children?: never`), i.e. the
//    section passes NO props of its own — every value the card needs must arrive
//    through the plugin's own `inject()` face.
//
// 2. Registration shape, taken from that package's own client.js: the
//    `settings.plugin.item` slot is claimed under the settings namespace the
//    Host half registers (`settings.register(SETTINGS_NAMESPACE, Config)` in
//    src/index.ts), and dispatch is by that namespace's intersection with the
//    registered cards.
//
// 3. `ctx.settingsScope.bind(spec)` takes `{ namespace, decode? }` and returns a
//    scope whose measured surface is getSnapshot / subscribe / set / unset /
//    mutate, over a snapshot of
//      { status: 'loading' | 'ready' | 'unavailable', value, base, user,
//        revision, writable, mode }
//    (dsh-client-ui-settings/lib/types/client/settings-contract.d.ts). The card
//    returns null unless `status === 'ready'`, so an unanswered Host renders
//    nothing rather than an empty card.
//
// 4. `remote.session.modelCatalog()` resolves the Host-generation model catalog
//    (`dsh-api-session-controller/lib/types/types.d.ts` ModelCatalog:
//    `default: ModelSelection` is the model used by unconfigured Sessions).
//    The official composer model seat renders `projected.next ??
//    catalog.value.default` (`dsh-client-ui-model-selection/lib/client.js`
//    ModelDirectory.syncInputs), which is why a new Session with an empty
//    projection still shows a model seat. The `{ ok, value, error }` wrapper
//    is the RPC result shape that `ModelCatalogDirectory.load()` checks
//    (`response.ok` before reading `response.value`).
//
// 5. `sessionId` and `useProjection` reach the slot from the built-in session
//    standard source (`dsh-client-ui-session/lib/client.js` BUILTIN_SOURCE:
//    `props: ['sessionId']`, `keyedHooks: ['projection']`), so
//    `conversation.input.right` occupants can read both even though the slot's
//    owner props are `{}`. `sessionId === undefined` is the no-Session inert
//    composer, which is why the fallback must not fire there.
//
// NOT modelled here: React's reconciler and full hook semantics (the default
// stub only invokes lazy state initializers and memo callbacks), the host's real
// slot registry, and the tab that dispatches the slot. The focused fallback
// tests below use a small state/effect runner only to model the two rerenders
// that matter for the session default route; it is not a replacement for React.
// This file proves the plugin's side of the contract; the Host's side is proven
// by the card appearing in a running deployment.
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
 * observes what the card would render.
 */
function makeRequire(options = {}) {
  const requested = []
  const elements = []
  const React = options.React ?? {
    createElement: (component, props, ...children) => {
      const element = { component, props, children }
      elements.push(element)
      return element
    },
    useEffect: () => {},
    useLayoutEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: () => ({ current: null }),
    // React invokes a function initial state lazily; the card relies on it to
    // copy the saved selection out of the snapshot.
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  }
  const require = (id) => {
    requested.push(id)
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return {
        IconChevronDownOutline14: () => ({}),
        IconChevronRightOutline14: () => ({}),
        IconCheckOutline16: () => ({}),
        Tag: (props) => props?.children ?? null,
      }
    }
    if (id === 'react-dom') return { createPortal: (node) => node }
    throw new Error(`unexpected dependency: ${id}`)
  }
  return { require, requested, elements }
}

/** A `ready` snapshot with no saved model routes — the shape the Host serves. */
function readySnapshot(value = { models: [] }) {
  return { status: 'ready', value, writable: true }
}

/**
 * Minimal stand-in for the client services the browser half touches, shaped
 * after the measured contracts above. `options.snapshot` overrides the settings
 * snapshot the card reads.
 */
function makeCtx(options = {}) {
  const state = { injected: [], registered: [], locales: [], effects: 0, bindSpecs: [] }
  const snapshot = options.snapshot ?? readySnapshot(options.value)
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set: async () => {},
  }
  const ctx = {
    slots: {
      inject(name, callback) {
        state.injected.push(name)
        callback()
      },
      register(slotDefinition, render) {
        state.registered.push({ slotDefinition, render })
        return () => {}
      },
    },
    settingsScope: {
      bind: (spec) => {
        state.bindSpecs.push(spec)
        return scope
      },
    },
    locale: {
      bind: (namespace) => (key) => `${namespace}:${key}`,
      register(namespace, dictionaries) {
        state.locales.push({ namespace, dictionaries })
        return () => {}
      },
    },
    effect(callback) {
      state.effects += 1
      callback()
      return () => {}
    },
    get: (name) => (name === 'remote.session'
      ? { modelCatalog: options.modelCatalog ?? (async () => ({ ok: true, value: { groups: [] } })) }
      : undefined),
  }
  return { ctx, state, scope }
}

function makeHookRunner() {
  const state = []
  const dependencies = []
  const cleanups = []
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
    createElement: (component, props, ...children) => ({ component, props, children }),
    useEffect: schedule,
    useLayoutEffect: schedule,
    useMemo: (fn) => {
      hookIndex += 1
      return fn()
    },
    useRef: (initial) => {
      const index = hookIndex++
      if (state[index] === undefined) state[index] = { current: initial }
      return state[index]
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

test('registers the reasoning settings card and composer control', () => {
  const registered = []
  const injected = []
  const locale = {
    register: () => () => {},
    bind: () => (key) => key,
  }
  const scope = {
    getSnapshot: () => ({ status: 'ready', value: { models: [] }, writable: true }),
    subscribe: () => () => {},
    set: async () => {},
  }
  const ctx = {
    slots: {
      inject: (name, callback) => { injected.push(name); callback() },
      register: (options, renderer) => { registered.push({ options, renderer }); return () => {} },
    },
    settingsScope: { bind: () => scope },
    locale,
    effect: (callback) => callback(),
    get: (name) => name === 'remote.session' ? { modelCatalog: async () => ({ ok: true, value: { groups: [] } }) } : undefined,
  }
  const plugin = definition.factory(makeRequire().require)
  plugin.apply(ctx)

  assert.deepEqual(injected, ['settings.plugin.item', 'conversation.input.right'])
  assert.deepEqual(registered.map((item) => item.options.name), ['settings.plugin.item', 'conversation.input.right'])
  assert.equal(registered[0].options.key, 'reasoning-mode')
  assert.equal(registered[1].options.id, 'reasoning-mode')
})

test('uses the right-side slot and matches official nested-menu structure', () => {
  const source = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
  const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /conversation\.input\.left/)
  const legacySummaryLabel = ['摘要', '级别'].join('')
  assert.doesNotMatch(source, new RegExp(legacySummaryLabel))
  assert.match(source, /conversation\.input\.right/)
  assert.match(source, /摘要等级/)
  assert.match(source, /\.rm-menu-cell \{ appearance: none; box-sizing: border-box; width: auto; min-width: 100%; height: 40px;/)
  assert.match(source, /\.rm-menu-cell-value \{[^}]*text-align: right;[^}]*color: var\(--dsw-alias-label-tertiary\);[^}]*flex: auto;/)
  assert.match(source, /\.rm-menu-cell-chevron \{ color: var\(--dsw-alias-label-tertiary\);/)
  assert.match(source, /\.rm-menu-option \{ appearance: none; box-sizing: border-box; width: auto; min-width: 100%; min-height: 38px;/)
  assert.doesNotMatch(source, /rm-menu-back/)
  assert.doesNotMatch(source, /const back\s*=/)
  assert.doesNotMatch(bundle, /rm-menu-back/)
  assert.doesNotMatch(bundle, /back\(t\('modeLabel'\)\)/)
  assert.doesNotMatch(bundle, /back\(t\('summaryLabel'\)\)/)
  assert.match(bundle, /rm-menu-cell-value[^}]*label-tertiary/)
})

test('declares both the settings and conversation client dependencies', () => {
  const plugin = definition.factory(makeRequire().require)
  assert.deepEqual(plugin.inject, ['slots', 'settingsScope', 'locale', 'remote', 'remote.session'])
})

test('keeps settings models-only and uses checkbox-only catalog rows', () => {
  const source = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
  const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(source, /value\?: \{ models\?: Selection\[\] \}/)
  assert.match(source, /set\(field: string, value: unknown\): Promise<void>/)
  assert.match(source, /scope\.set\('models', draftModels\)/)
  assert.match(source, /scope\.set\('models', next\)/)
  assert.match(source, /modelsHint: '只有勾选的 provider\/model 会改变 Responses 请求；未出现在目录中的已保存路由仍会保留。'/)
  assert.match(source, /\.rm-models \{[^}]*max-height: 280px;/)
  assert.match(source, /\.rm-model \{[^}]*grid-template-columns: auto minmax\(0, 1fr\) auto;/)
  assert.match(source, /Keep saved routes in the staged candidate set until Save commits an uncheck/)
  assert.match(source, /for \(const item of effective\.values\(\)\)/)
  assert.doesNotMatch(source, /\bdefaultMode\b|\bdefaultSummary\b|\bdraftMode\b|\bdraftSummary\b|scope\.mutate/)
  assert.doesNotMatch(source, /<select|rm-select|rm-defaults|routeHint|unavailableRoute/)
  assert.doesNotMatch(bundle, /defaultMode|defaultSummary|scope\.mutate|rm-select|rm-defaults/)
})

test('the slot mount forwards the injected face to the card', () => {
  const { require, elements } = makeRequire()
  const plugin = definition.factory(require)
  const { ctx, state } = makeCtx()
  plugin.apply(ctx)

  // The section passes no props of its own (contract fact 1), so the render
  // closure is what has to hand the card its scope, translator and catalog
  // face. React would call the returned element's component with these props.
  const element = state.registered[0].render({})
  assert.equal(typeof element.component, 'function')

  const card = element.component(element.props)
  assert.ok(card, 'a ready snapshot must render a card element')
  assert.ok(elements.length > 1, 'the card must build its own element tree')
  assert.equal(elements[0].component, element.component)
  assert.equal(element.props.t('title'), 'reasoning-mode:title')
  assert.equal(typeof element.props.sessionFace, 'function')
  assert.ok(element.props.scope && typeof element.props.scope.getSnapshot === 'function')
})

test('the card renders nothing until the Host answers with a ready snapshot', () => {
  const { require, elements } = makeRequire()
  const plugin = definition.factory(require)
  const { ctx, state } = makeCtx({ snapshot: { status: 'loading', value: undefined, writable: true } })
  plugin.apply(ctx)

  const element = state.registered[0].render({})
  const card = element.component(element.props)
  assert.equal(card, null)
  assert.equal(elements.length, 1, 'only the card element itself may be created')
})

test('shows the composer control for a new session after the catalog supplies its default route', async () => {
  const runner = makeHookRunner()
  const { require } = makeRequire({ React: runner.React })
  const plugin = definition.factory(require)
  let calls = 0
  const { ctx, state } = makeCtx({
    snapshot: readySnapshot({ models: [{ provider: 'provider-a', model: 'model-a', mode: 'standard', summary: 'auto' }] }),
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
    snapshot: readySnapshot({ models: [{ provider: 'provider-a', model: 'model-a', mode: 'standard', summary: 'auto' }] }),
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
    assert.match(created[0].textContent, /\.rm-card/)

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