import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

import {
  apply,
  applyReasoningBody,
  isResponsesRequest,
  normalizeModels,
  sameModelRoutes,
  Config,
  inject,
  name,
} from '../lib/index.js'

test('exports the host contract with no required service', () => {
  assert.equal(name, 'reasoning-mode')
  assert.deepEqual(inject, [])
  assert.equal(typeof apply, 'function')
})

test('normalizes a stored route list: unusable entries, duplicate routes, and unknown enums', () => {
  assert.deepEqual(normalizeModels([
    { provider: 'p', model: 'm', mode: 'pro', summary: 'concise' },
    { provider: 'p', model: 'm', mode: 'standard', summary: 'auto' },
    { provider: 'q', model: 'n' },
    { provider: '', model: 'n' },
    { provider: 'q', model: '' },
    { provider: 'q' },
    null,
    'nope',
  ]), [
    { provider: 'p', model: 'm', mode: 'pro', summary: 'concise' },
    { provider: 'q', model: 'n', mode: 'standard', summary: 'auto' },
  ])
  assert.deepEqual(normalizeModels(undefined), [])
})

// The loader keeps `volatile` fields live: it hands `apply` a box whose `get()`
// answers the current value and re-reads it on every load, instead of freezing
// the document value captured at activation. schemastery records the marker as
// `meta.volatile` on the field's own ref (measured on 3.18.4, the version the
// host and the official plugins resolve).
test('declares the route list as a volatile field so the loader owns live values', () => {
  const envelope = Config.toJSON()
  const refs = envelope.refs
  const root = refs[envelope.uid]
  const routes = refs[root.dict.models]

  assert.equal(routes.type, 'array')
  assert.equal(routes.meta.volatile, true, 'a non-volatile route list would freeze the value captured at apply time')
  // The item schema is the four fields the host half normalizes on read.
  assert.deepEqual(Object.keys(refs[routes.inner].dict), ['provider', 'model', 'mode', 'summary'])
})

test('applies mode and summary while retaining existing reasoning fields', () => {
  const body = {
    model: 'gpt-5.6-luna',
    stream: true,
    reasoning: { effort: 'max', summary: 'auto', provider_field: 'keep' },
  }
  const result = applyReasoningBody(body, { mode: 'pro', summary: 'concise' })

  assert.deepEqual(result, {
    model: 'gpt-5.6-luna',
    stream: true,
    reasoning: { effort: 'max', summary: 'concise', provider_field: 'keep', mode: 'pro' },
  })
  assert.deepEqual(body.reasoning, { effort: 'max', summary: 'auto', provider_field: 'keep' })
})

test('supports explicit Standard mode and an absent reasoning object', () => {
  assert.deepEqual(
    applyReasoningBody({ model: 'm' }, { mode: 'standard', summary: 'detailed' }),
    { model: 'm', reasoning: { mode: 'standard', summary: 'detailed' } },
  )
})

// The tracker rewrites a request only when exactly one distinct route remains,
// which is what makes two providers sharing one model ambiguous; that decision is
// proved end-to-end below ("does not rewrite an ambiguous same-model request").
// This test pins the set the decision is made from.
test('keeps same-model routes from different providers distinct and collapses exact duplicates', () => {
  assert.deepEqual(sameModelRoutes([
    { provider: 'cotton-codex', model: 'gpt-5.6-luna' },
    { provider: 'cotton-codex-plus', model: 'gpt-5.6-luna' },
  ], 'gpt-5.6-luna'), [
    { provider: 'cotton-codex', model: 'gpt-5.6-luna' },
    { provider: 'cotton-codex-plus', model: 'gpt-5.6-luna' },
  ])
  assert.deepEqual(sameModelRoutes([
    { provider: 'cotton-codex-plus', model: 'gpt-5.6-luna' },
    { provider: 'cotton-codex-plus', model: 'gpt-5.6-luna' },
  ], 'gpt-5.6-luna'), [{ provider: 'cotton-codex-plus', model: 'gpt-5.6-luna' }])
  assert.deepEqual(sameModelRoutes([
    { provider: 'cotton-codex', model: 'gpt-5.6-luna' },
  ], 'gpt-5.6-sol'), [])
})



test('rewrites an active Responses request and restores fetch on disposal', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  const stubFetch = async (input, init) => {
    calls.push({ input, init })
    return { ok: true }
  }
  globalThis.fetch = stubFetch

  // A stand-in for the loader's volatile reference: reading it once per request
  // is what makes a saved settings write effective without re-applying.
  let stored = [{ provider: 'cotton-codex-plus', model: 'gpt-5.6-luna', mode: 'pro', summary: 'concise' }]
  const config = { models: { get: () => stored } }
  const listeners = []
  const disposers = []
  const ctx = {
    on: (name, listener) => { listeners.push({ name, listener }); return () => {} },
    effect: (callback) => { const disposer = callback(); disposers.push(disposer); return disposer },
    logger: { warn: () => {} },
  }

  try {
    apply(ctx, config)
    const streamListener = listeners.find((entry) => entry.name === 'llm/stream').listener
    const stream = streamListener({
      provider: 'cotton-codex-plus',
      model: 'gpt-5.6-luna',
      sessionId: 'session-plus',
    }, () => (async function* () {
      yield { type: 'finish' }
    })())

    await globalThis.fetch('https://api.cottonapi.cloud/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '999', 'x-client-request-id': 'session-plus', 'x-preserve': 'yes' },
      body: JSON.stringify({ model: 'gpt-5.6-luna', stream: true, reasoning: { effort: 'max' } }),
    })
    await stream.next()

    assert.equal(calls.length, 1)
    const sent = JSON.parse(calls[0].init.body)
    assert.deepEqual(sent.reasoning, { effort: 'max', mode: 'pro', summary: 'concise' })
    assert.equal(calls[0].init.headers['content-length'], undefined)
    assert.equal(calls[0].init.headers['x-preserve'], 'yes')

    // Liveness: the value the settings page wrote after apply must reach the next
    // request through the same volatile reference, with no re-apply and no subscription.
    stored = [{ provider: 'cotton-codex-plus', model: 'gpt-5.6-luna' }]
    const nextStream = streamListener({
      provider: 'cotton-codex-plus',
      model: 'gpt-5.6-luna',
      sessionId: 'session-plus',
    }, () => (async function* () {
      yield { type: 'finish' }
    })())
    await globalThis.fetch('https://api.cottonapi.cloud/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-request-id': 'session-plus' },
      body: JSON.stringify({ model: 'gpt-5.6-luna', stream: true }),
    })
    await nextStream.next()
    assert.equal(calls.length, 2)
    assert.deepEqual(JSON.parse(calls[1].init.body).reasoning, { mode: 'standard', summary: 'auto' })

    const beforeBypass = calls.length
    await globalThis.fetch('https://api.cottonapi.cloud/v1/models', { method: 'GET' })
    assert.equal(calls.length, beforeBypass + 1)
    for (const dispose of disposers) dispose?.()
    assert.equal(globalThis.fetch, stubFetch)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rewrites a native Request body, preserves request fields, and removes stale content-length', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  const stubFetch = async (input, init) => {
    calls.push({ input, init })
    return { ok: true }
  }
  globalThis.fetch = stubFetch
  const config = {
    models: { get: () => [{ provider: 'cotton-codex-plus', model: 'gpt-5.6-luna', mode: 'pro', summary: 'detailed' }] },
  }
  const listeners = []
  const disposers = []
  const ctx = {
    on: (name, listener) => { listeners.push({ name, listener }); return () => {} },
    effect: (callback) => { const disposer = callback(); disposers.push(disposer); return disposer },
    logger: { warn: () => {} },
  }
  try {
    apply(ctx, config)
    const streamListener = listeners.find((entry) => entry.name === 'llm/stream').listener
    const stream = streamListener({
      provider: 'cotton-codex-plus',
      model: 'gpt-5.6-luna',
      sessionId: 'request-session',
    }, () => (async function* () {
      yield { type: 'finish' }
    })())

    const request = new Request('https://api.cottonapi.cloud/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '999',
        'x-client-request-id': 'request-session',
        'x-preserve': 'request-header',
      },
      cache: 'no-store',
      redirect: 'manual',
      referrerPolicy: 'no-referrer',
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        stream: true,
        reasoning: { effort: 'low', provider_field: 'keep' },
      }),
    })

    await globalThis.fetch(request)

    assert.equal(calls.length, 1)
    assert.equal(calls[0].init, undefined)
    assert.ok(calls[0].input instanceof Request)
    const rewritten = calls[0].input
    assert.equal(rewritten.method, 'POST')
    assert.equal(rewritten.url, request.url)
    assert.equal(rewritten.cache, 'no-store')
    assert.equal(rewritten.redirect, 'manual')
    assert.equal(rewritten.referrerPolicy, 'no-referrer')
    assert.equal(rewritten.headers.get('content-type'), 'application/json')
    assert.equal(rewritten.headers.get('content-length'), null)
    assert.equal(rewritten.headers.get('x-client-request-id'), 'request-session')
    assert.equal(rewritten.headers.get('x-preserve'), 'request-header')
    assert.deepEqual(JSON.parse(await rewritten.clone().text()), {
      model: 'gpt-5.6-luna',
      stream: true,
      reasoning: { effort: 'low', provider_field: 'keep', mode: 'pro', summary: 'detailed' },
    })
    assert.equal(request.bodyUsed, false)

    await stream.next()
    await stream.next()
    for (const dispose of disposers) dispose?.()
    assert.equal(globalThis.fetch, stubFetch)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('uses request affinity to select the exact provider among concurrent same-model routes', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  const stubFetch = async (input, init) => {
    calls.push({ input, init })
    return { ok: true }
  }
  globalThis.fetch = stubFetch
  const config = {
    models: {
      get: () => [
        { provider: 'cotton-codex', model: 'gpt-5.6-luna', mode: 'standard', summary: 'concise' },
        { provider: 'cotton-codex-plus', model: 'gpt-5.6-luna', mode: 'pro', summary: 'detailed' },
      ],
    },
  }
  const listeners = []
  const disposers = []
  const ctx = {
    on: (name, listener) => { listeners.push({ name, listener }); return () => {} },
    effect: (callback) => { const disposer = callback(); disposers.push(disposer); return disposer },
    logger: { warn: () => {} },
  }
  try {
    apply(ctx, config)
    const streamListener = listeners.find((entry) => entry.name === 'llm/stream').listener
    const streamA = streamListener({
      provider: 'cotton-codex',
      model: 'gpt-5.6-luna',
      sessionId: 'affinity-a',
    }, () => (async function* () {
      yield { type: 'finish' }
    })())
    const streamB = streamListener({
      provider: 'cotton-codex-plus',
      model: 'gpt-5.6-luna',
      sessionId: 'affinity-b',
    }, () => (async function* () {
      yield { type: 'finish' }
    })())

    for (const [sessionId, headerName, expectedMode, expectedSummary] of [
      ['affinity-a', 'x-client-request-id', 'standard', 'concise'],
      ['affinity-b', 'session_id', 'pro', 'detailed'],
    ]) {
      await globalThis.fetch('https://api.cottonapi.cloud/v1/responses', {
        method: 'POST',
        headers: { 'content-type': 'application/json', [headerName]: sessionId },
        body: JSON.stringify({ model: 'gpt-5.6-luna', reasoning: { effort: 'high' } }),
      })
      const sent = JSON.parse(calls.at(-1).init.body)
      assert.deepEqual(sent.reasoning, { effort: 'high', mode: expectedMode, summary: expectedSummary })
    }

    await streamA.next()
    await streamA.next()
    await streamB.next()
    await streamB.next()
    for (const dispose of disposers) dispose?.()
    assert.equal(globalThis.fetch, stubFetch)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('does not rewrite an ambiguous same-model request and restores after stream completion', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  const stubFetch = async (input, init) => {
    calls.push({ input, init })
    return { ok: true }
  }
  globalThis.fetch = stubFetch
  const config = {
    models: {
      get: () => [
        { provider: 'cotton-codex', model: 'gpt-5.6-luna', mode: 'standard', summary: 'auto' },
        { provider: 'cotton-codex-plus', model: 'gpt-5.6-luna', mode: 'pro', summary: 'detailed' },
        { provider: 'cotton-codex-enterprise', model: 'gpt-5.6-luna', mode: 'standard', summary: 'concise' },
      ],
    },
  }
  const listeners = []
  const disposers = []
  const warnings = []
  const ctx = {
    on: (name, listener) => { listeners.push({ name, listener }); return () => {} },
    effect: (callback) => { const disposer = callback(); disposers.push(disposer); return disposer },
    logger: { warn: (message) => warnings.push(String(message)) },
  }
  try {
    apply(ctx, config)
    const streamListener = listeners.find((entry) => entry.name === 'llm/stream').listener
    const streamA = streamListener({
      provider: 'cotton-codex',
      model: 'gpt-5.6-luna',
      sessionId: 'session-codex',
    }, () => (async function* () {
      yield { type: 'finish' }
    })())
    const streamB = streamListener({
      provider: 'cotton-codex-plus',
      model: 'gpt-5.6-luna',
      sessionId: 'session-plus',
    }, () => (async function* () {
      yield { type: 'finish' }
    })())

    await globalThis.fetch('https://api.cottonapi.cloud/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.6-luna', stream: true, reasoning: { effort: 'max' } }),
    })
    await globalThis.fetch('https://api.cottonapi.cloud/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.6-luna', stream: true, reasoning: { effort: 'max' } }),
    })
    assert.equal(JSON.parse(calls[0].init.body).reasoning.mode, undefined)
    assert.equal(JSON.parse(calls[1].init.body).reasoning.mode, undefined)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /provider identity is ambiguous/)
    assert.match(warnings[0], /cotton-codex\/gpt-5\.6-luna/)
    assert.match(warnings[0], /cotton-codex-plus\/gpt-5\.6-luna/)

    const streamC = streamListener({
      provider: 'cotton-codex-enterprise',
      model: 'gpt-5.6-luna',
      sessionId: 'session-enterprise',
    }, () => (async function* () {
      yield { type: 'finish' }
    })())
    await globalThis.fetch('https://api.cottonapi.cloud/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.6-luna', stream: true, reasoning: { effort: 'max' } }),
    })
    await globalThis.fetch('https://api.cottonapi.cloud/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.6-luna', stream: true, reasoning: { effort: 'max' } }),
    })
    assert.equal(warnings.length, 2)
    assert.match(warnings[1], /provider identity is ambiguous/)
    assert.match(warnings[1], /cotton-codex-enterprise\/gpt-5\.6-luna/)

    await streamA.next()
    await streamA.next()
    await streamB.next()
    await streamB.next()
    await streamC.next()
    await streamC.next()
    for (const dispose of disposers) dispose?.()
    assert.equal(globalThis.fetch, stubFetch)
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// Boundary guards
//
// This wrapper sits on the GLOBAL fetch, not on pi-ai's call site, so every
// guard below is reachable by some caller: another plugin, a proxy layer, a
// retry loop, a hand-built request. They are the plugin's "do no harm" surface —
// each one must forward the request exactly as it arrived.
// ---------------------------------------------------------------------------

test('forwards every request the boundary does not own, byte for byte', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init) => { calls.push({ input, init }); return { ok: true } }

  const listeners = []
  const ctx = {
    on: (name, listener) => { listeners.push({ name, listener }); return () => {} },
    effect: (callback) => callback(),
    logger: { warn: () => {} },
  }

  try {
    apply(ctx, { models: { get: () => [{ provider: 'cotton-codex', model: 'gpt-5.6-luna', mode: 'pro', summary: 'concise' }] } })
    const listener = listeners.find((entry) => entry.name === 'llm/stream').listener
    // An ACTIVE, CONFIGURED route for the very model every case below sends.
    // Without it each request would go unrewritten for want of a route, and this
    // test would keep passing after the guard under test was deleted — each case
    // must be able to fail for exactly one reason.
    const stream = listener(
      { provider: 'cotton-codex', model: 'gpt-5.6-luna', sessionId: 'session-guard' },
      () => (async function* () { yield { type: 'finish' } })(),
    )
    const url = 'https://api.example.com/v1/responses'
    const headers = { 'content-type': 'application/json', 'x-client-request-id': 'session-guard' }
    const body = JSON.stringify({ model: 'gpt-5.6-luna' })

    // Positive control: the same shape with nothing to trigger a guard IS
    // rewritten. Without this line a broken setup would make every case below
    // vacuous — which is exactly how a guard test starts lying.
    const control = { method: 'POST', headers, body }
    await globalThis.fetch(url, control)
    assert.equal(calls.length, 1)
    assert.notEqual(calls[0].init, control, 'a request the boundary owns is rebuilt')
    assert.equal(JSON.parse(calls[0].init.body).reasoning.mode, 'pro')
    calls.length = 0

    // A relative URL is eligible too, and on purpose: `new URL()` cannot parse it,
    // so the fallback applies the same `/responses` suffix rule to the raw string.
    // A caller that prefixes the base URL itself therefore still gets the rewrite.
    const relative = { method: 'POST', headers, body }
    await globalThis.fetch('/v1/responses', relative)
    assert.equal(calls.length, 1)
    assert.notEqual(calls[0].init, relative, 'a relative /responses URL is still admitted')
    assert.equal(JSON.parse(calls[0].init.body).reasoning.mode, 'pro')
    calls.length = 0

    const cases = [
      ['a GET', url, { method: 'GET', headers, body }],
      ['no method at all, which fetch reads as GET', url, { headers, body }],
      ['another path', 'https://api.example.com/v1/chat/completions', { method: 'POST', headers, body }],
      ['a subpath that merely ends in the word', 'https://api.example.com/v1/responses/extra', { method: 'POST', headers, body }],
      // An unparsable path that is not a Responses endpoint: this is the other arm
      // of the same fallback the relative case above exercises.
      ['a relative non-Responses path', '/v1/chat/completions', { method: 'POST', headers, body }],
      // The body is compressed: reading it as text would hand back gzip bytes.
      ['an encoded body', url, { method: 'POST', headers: { ...headers, 'content-encoding': 'gzip' }, body }],
      ['a non-JSON body', url, { method: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body }],
      ['a body that is not JSON at all', url, { method: 'POST', headers, body: '}{' }],
      ['JSON that is not an object', url, { method: 'POST', headers, body: '"gpt-5.6-luna"' }],
      ['a body with no model', url, { method: 'POST', headers, body: '{"stream":true}' }],
      ['a body whose model is not a string', url, { method: 'POST', headers, body: '{"model":42}' }],
      ['no body to read', url, { method: 'POST', headers }],
      ['a body fetch refuses to give back', url, {
        method: 'POST',
        headers,
        body: { get [Symbol.toStringTag]() { return 'blob' } },
      }],
    ]

    for (const [label, input, init] of cases) {
      const before = calls.length
      await globalThis.fetch(input, init)
      assert.equal(calls.length, before + 1, label)
      assert.equal(calls[calls.length - 1].input, input, `${label}: the input reference is forwarded untouched`)
      assert.equal(calls[calls.length - 1].init, init, `${label}: the init reference is forwarded untouched`)
    }

    await stream.next()
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('leaves a tracked route alone when the configuration does not list it', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init) => { calls.push({ input, init }); return { ok: true } }

  const listeners = []
  const ctx = {
    on: (name, listener) => { listeners.push({ name, listener }); return () => {} },
    effect: (callback) => callback(),
    logger: { warn: () => {} },
  }

  try {
    // An empty list is the documented off switch, so a known, active route whose
    // provider/model pair is absent from the configuration must not be touched.
    apply(ctx, { models: { get: () => [] } })
    const listener = listeners.find((entry) => entry.name === 'llm/stream').listener
    const stream = listener(
      { provider: 'cotton-codex', model: 'gpt-5.6-luna', sessionId: 'session-unlisted' },
      () => (async function* () { yield { type: 'finish' } })(),
    )

    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-request-id': 'session-unlisted' },
      body: JSON.stringify({ model: 'gpt-5.6-luna', stream: true }),
    }
    await globalThis.fetch('https://api.example.com/v1/responses', init)

    // The route resolved — the tracker knows this session — and the only reason
    // the request is not rewritten is that the configuration omits the pair.
    assert.equal(calls.length, 1)
    assert.equal(calls[0].init, init)
    assert.equal(JSON.parse(calls[0].init.body).reasoning, undefined)

    await stream.next()
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('reads a body and an affinity header through every shape fetch accepts', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init) => { calls.push({ input, init }); return { ok: true } }

  const listeners = []
  const ctx = {
    on: (name, listener) => { listeners.push({ name, listener }); return () => {} },
    effect: (callback) => callback(),
    logger: { warn: () => {} },
  }

  try {
    apply(ctx, { models: { get: () => [{ provider: 'cotton-codex', model: 'gpt-5.6-luna', mode: 'pro', summary: 'detailed' }] } })
    const listener = listeners.find((entry) => entry.name === 'llm/stream').listener
    const track = () => listener(
      { provider: 'cotton-codex', model: 'gpt-5.6-luna', sessionId: 'session-shapes' },
      () => (async function* () { yield { type: 'finish' } })(),
    )

    // Array-of-pairs headers: a legal fetch shape, and the affinity lookup has a
    // separate branch for it.
    const paired = track()
    await globalThis.fetch('https://api.example.com/v1/responses', {
      method: 'POST',
      headers: [['content-type', 'application/json'], ['session_id', 'session-shapes']],
      body: JSON.stringify({ model: 'gpt-5.6-luna' }),
    })
    assert.equal(JSON.parse(calls[calls.length - 1].init.body).reasoning.mode, 'pro', 'affinity found in a header pair array')

    // A byte body: the decoder has a branch per shape, not just for strings.
    const bytes = track()
    await globalThis.fetch('https://api.example.com/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'session_id': 'session-shapes' },
      body: new TextEncoder().encode(JSON.stringify({ model: 'gpt-5.6-luna', reasoning: { effort: 'max' } })),
    })
    assert.deepEqual(
      JSON.parse(calls[calls.length - 1].init.body).reasoning,
      { effort: 'max', mode: 'pro', summary: 'detailed' },
      'a Uint8Array body is decoded, and existing reasoning fields survive',
    )

    // Headers that throw when read: treated as absent, never as a hard failure,
    // so the request still goes out (unaffinitised here, hence still rewritten
    // because exactly one route is active).
    const throwing = track()
    await globalThis.fetch('https://api.example.com/v1/responses', {
      method: 'POST',
      headers: { get() { throw new Error('detached Headers') }, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.6-luna' }),
    })
    assert.equal(JSON.parse(calls[calls.length - 1].init.body).reasoning.mode, 'pro', 'a throwing headers.get() is not fatal')

    await paired.next()
    await bytes.next()
    await throwing.next()
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('tracks nothing when the stream event carries no caller identity', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init) => { calls.push({ input, init }); return { ok: true } }

  const listeners = []
  const ctx = {
    on: (name, listener) => { listeners.push({ name, listener }); return () => {} },
    effect: (callback) => callback(),
    logger: { warn: () => {} },
  }

  try {
    apply(ctx, { models: { get: () => [{ provider: 'p', model: 'gpt-5.6-luna', mode: 'pro', summary: 'concise' }] } })
    const listener = listeners.find((entry) => entry.name === 'llm/stream').listener
    const yielded = (async function* () { yield { type: 'finish' } })()
    const next = () => yielded

    // An incomplete or non-LLM stream event: the ordinary call still flows, but
    // no route may be registered — a phantom registration would rewrite some
    // later request that merely shares the model id.
    for (const options of [
      { model: 'gpt-5.6-luna' },
      { provider: 'p' },
      { provider: 'p', model: 'gpt-5.6-luna' },
      { purpose: 'title', provider: 'p', model: 'gpt-5.6-luna', sessionId: 's' },
      null,
    ]) {
      assert.equal(listener(options, next), yielded, 'the stream is returned untouched')
    }

    await globalThis.fetch('https://api.example.com/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.6-luna' }),
    })
    assert.equal(JSON.parse(calls[0].init.body).reasoning, undefined, 'nothing was registered, so nothing is rewritten')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('unregisters and rethrows when the stream factory throws', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init) => { calls.push({ input, init }); return { ok: true } }

  const listeners = []
  const ctx = {
    on: (name, listener) => { listeners.push({ name, listener }); return () => {} },
    effect: (callback) => callback(),
    logger: { warn: () => {} },
  }

  try {
    apply(ctx, { models: { get: () => [{ provider: 'cotton-codex', model: 'gpt-5.6-luna', mode: 'pro', summary: 'concise' }] } })
    const listener = listeners.find((entry) => entry.name === 'llm/stream').listener
    const boom = new Error('stream factory failed')

    // The route is registered before the factory runs, so a throwing factory must
    // both propagate the original error and undo the registration.
    assert.throws(
      () => listener(
        { provider: 'cotton-codex', model: 'gpt-5.6-luna', sessionId: 'session-doomed' },
        () => { throw boom },
      ),
      (error) => error === boom,
    )

    await globalThis.fetch('https://api.example.com/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'session_id': 'session-doomed' },
      body: JSON.stringify({ model: 'gpt-5.6-luna' }),
    })
    assert.equal(JSON.parse(calls[0].init.body).reasoning, undefined, 'the failed stream left no route behind')
  } finally {
    globalThis.fetch = originalFetch
  }
})
test('survives a malformed or hostile request instead of failing the caller', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init) => { calls.push({ input, init }); return { ok: true } }

  const listeners = []
  const ctx = {
    on: (name, listener) => { listeners.push({ name, listener }); return () => {} },
    effect: (callback) => callback(),
    logger: { warn: () => {} },
  }

  try {
    apply(ctx, { models: { get: () => [{ provider: 'cotton-codex', model: 'gpt-5.6-luna', mode: 'pro', summary: 'concise' }] } })
    const listener = listeners.find((entry) => entry.name === 'llm/stream').listener
    const stream = listener(
      { provider: 'cotton-codex', model: 'gpt-5.6-luna', sessionId: 'session-hostile' },
      () => (async function* () { yield { type: 'finish' } })(),
    )

    // Every case below must leave through the ONE exit that cannot fail the
    // caller: the original fetch, with the original input and init references.
    const expectForwarded = (label, expectedInput) => {
      assert.equal(calls.length, 1, label)
      assert.equal(calls[0].input, expectedInput, `${label}: the original input is forwarded`)
      assert.equal(calls[0].init === undefined || typeof calls[0].init === 'object', true, label)
      calls.length = 0
    }

    // A URL object is a legal fetch input but carries no `url` property, so the
    // wrapper cannot tell what it points at and must stand aside.
    const asUrl = new URL('https://api.example.com/v1/responses')
    await globalThis.fetch(asUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', session_id: 'session-hostile' },
      body: JSON.stringify({ model: 'gpt-5.6-luna' }),
    })
    expectForwarded('a URL object input', asUrl)

    // A request whose body cannot be read, because cloning it throws.
    const unclonable = {
      url: 'https://api.example.com/v1/responses',
      method: 'POST',
      headers: { 'content-type': 'application/json', session_id: 'session-hostile' },
      clone() { throw new Error('body already consumed') },
    }
    await globalThis.fetch(unclonable, { method: 'POST' })
    expectForwarded('a request that refuses to be cloned', unclonable)

    // A request the wrapper WOULD rewrite, except that a header value it was
    // given is one the Request constructor rejects. The rewrite must be
    // abandoned whole — a half-built request must never leave.
    const native = new Request('https://api.example.com/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.6-luna', stream: true }),
    })
    const illegal = { headers: { 'content-type': 'application/json', session_id: 'session-hostile', 'x-illegal': 'a\nb' } }
    await globalThis.fetch(native, illegal)
    expectForwarded('a rebuild the Request constructor rejects', native)

    // Reading `init.body` itself throws: the async read rejects rather than
    // returning, so this covers the wrapper's catch as well.
    const hostile = { method: 'POST', get body() { throw new Error('hostile body getter') } }
    await globalThis.fetch('https://api.example.com/v1/responses', hostile)
    expectForwarded('a body property that throws when read', 'https://api.example.com/v1/responses')

    await stream.next()
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// Manifest contract
//
// The host reads the display metadata and the icon WITHOUT activating the
// plugin, so no runtime test can reach it: the page can be perfect while the
// plugin list carries no name, no description and no icon. The failure is also
// asymmetric — a bad icon only drops the icon, while an empty or non-string
// title/description makes the whole read fail and takes the icon with it.
// ---------------------------------------------------------------------------

const packageRoot = new URL('..', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8'))

test('the display metadata the plugin list shows is declared and valid', () => {
  // `locale/*.json` resolves through the package `exports` map, and neither the
  // dictionaries nor the icon belong to the auto-included set.
  assert.equal(manifest.icon, './icon.svg', 'icon field points at the icon')
  assert.equal(
    manifest.exports['./locale/*.json'],
    './locale/*.json',
    'locale dictionaries resolve through exports',
  )
  for (const entry of ['icon.svg', 'locale/*.json']) {
    assert.ok(manifest.files.includes(entry), `files lists ${entry}`)
  }

  const icon = readFileSync(new URL(manifest.icon, packageRoot))
  assert.ok(icon.byteLength > 0, 'the icon is not empty')
  assert.ok(icon.byteLength <= 256 * 1024, 'the icon is within the 256 KiB limit')
  assert.match(icon.toString('utf8'), /^<svg[\s>]/, 'the icon is an SVG document')

  const localeDir = new URL('locale/', packageRoot)
  const dictionaries = readdirSync(localeDir).filter((file) => file.endsWith('.json'))
  assert.ok(dictionaries.length > 0, 'at least one dictionary exists')
  for (const file of dictionaries) {
    const dict = JSON.parse(readFileSync(new URL(file, localeDir), 'utf8'))
    assert.equal(typeof dict.meta?.title, 'string', `${file} carries a title`)
    assert.ok(dict.meta.title.length > 0, `${file} title is not empty`)
    assert.equal(typeof dict.meta?.description, 'string', `${file} carries a description`)
    assert.ok(dict.meta.description.length > 0, `${file} description is not empty`)
  }
})
