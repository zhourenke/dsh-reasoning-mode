import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const definitions = []
globalThis.window = { __ModuleLoader__: { load: (definition) => definitions.push(definition) } }
await import('../lib/client.js')

assert.equal(definitions.length, 1)
const definition = definitions[0]

function makeRequire() {
  const React = {
    createElement: () => null,
    useEffect: () => {},
    useLayoutEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: () => ({ current: null }),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  }
  return (id) => {
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return { IconChevronDownOutline14: () => null, IconChevronRightOutline14: () => null, IconCheckOutline16: () => null, Tag: () => null }
    }
    if (id === 'react-dom') return { createPortal: (node) => node }
    throw new Error(`unexpected dependency: ${id}`)
  }
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
    mutate: async () => {},
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
  const plugin = definition.factory(makeRequire())
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
  const plugin = definition.factory(makeRequire())
  assert.deepEqual(plugin.inject, ['slots', 'settingsScope', 'locale', 'remote', 'remote.session'])
})

test('can be concatenated with the sibling reasoning-summary client bundle', () => {
  const modeBundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const summaryBundle = readFileSync(new URL('../../dsh-reasoning-summary/lib/client.js', import.meta.url), 'utf8')
  assert.doesNotThrow(() => new vm.Script(`${summaryBundle}\n${modeBundle}`))
})
