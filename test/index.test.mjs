import assert from 'node:assert/strict'
import test from 'node:test'

import {
  apply,
  applyReasoningBody,
  isResponsesRequest,
  normalizeModels,
  resolveRouteCandidate,
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

test('fails closed for same-model routes from different providers', () => {
  assert.equal(resolveRouteCandidate([
    { provider: 'cotton-codex', model: 'gpt-5.6-luna' },
    { provider: 'cotton-codex-plus', model: 'gpt-5.6-luna' },
  ], 'gpt-5.6-luna'), undefined)
  assert.deepEqual(resolveRouteCandidate([
    { provider: 'cotton-codex-plus', model: 'gpt-5.6-luna' },
    { provider: 'cotton-codex-plus', model: 'gpt-5.6-luna' },
  ], 'gpt-5.6-luna'), { provider: 'cotton-codex-plus', model: 'gpt-5.6-luna' })
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
