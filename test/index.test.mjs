import assert from 'node:assert/strict'
import test from 'node:test'

import {
  apply,
  applyReasoningBody,
  isResponsesRequest,
  resolveRouteCandidate,
  Config,
} from '../lib/index.js'

test('serializes a self-contained settings transform callback', () => {
  const envelope = Config.toJSON()
  const transform = envelope.refs[String(envelope.uid)]

  assert.equal(transform.type, 'transform')
  assert.equal(typeof transform.callback, 'string')
  assert.doesNotMatch(transform.callback, /normalizeModels/)

  // This is the same rehydration mechanism used by the browser settings client.
  const callback = new Function(`return ${transform.callback}`)()
  assert.equal(typeof callback, 'function')
  assert.deepEqual(callback({
    defaultMode: 'pro',
    defaultSummary: 'detailed',
    models: [
      { provider: 'p', model: 'm', mode: 'pro', summary: 'concise' },
      { provider: 'p', model: 'm', mode: 'standard', summary: 'auto' },
      { provider: 'q', model: 'n', mode: 'standard', summary: 'auto' },
    ],
  }), {
    defaultMode: 'pro',
    defaultSummary: 'detailed',
    models: [
      { provider: 'p', model: 'm', mode: 'pro', summary: 'concise' },
      { provider: 'q', model: 'n', mode: 'standard', summary: 'auto' },
    ],
  })
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

  let watchCallback
  const settingsScope = {
    get: () => ({
      defaultMode: 'standard',
      defaultSummary: 'auto',
      models: [{ provider: 'cotton-codex-plus', model: 'gpt-5.6-luna', mode: 'pro', summary: 'concise' }],
    }),
    watch: (callback) => { watchCallback = callback; return () => {} },
  }
  const listeners = []
  const disposers = []
  const ctx = {
    settings: {
      register: () => settingsScope,
    },
    on: (name, listener) => { listeners.push({ name, listener }); return () => {} },
    effect: (callback) => { const disposer = callback(); disposers.push(disposer); return disposer },
    logger: { warn: () => {} },
  }

  try {
    apply(ctx)
    assert.equal(typeof watchCallback, 'function')
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
  const settingsScope = {
    get: () => ({
      defaultMode: 'standard',
      defaultSummary: 'auto',
      models: [{ provider: 'cotton-codex-plus', model: 'gpt-5.6-luna', mode: 'pro', summary: 'detailed' }],
    }),
    watch: () => () => {},
  }
  const listeners = []
  const disposers = []
  const ctx = {
    settings: { register: () => settingsScope },
    on: (name, listener) => { listeners.push({ name, listener }); return () => {} },
    effect: (callback) => { const disposer = callback(); disposers.push(disposer); return disposer },
    logger: { warn: () => {} },
  }
  try {
    apply(ctx)
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
  const settingsScope = {
    get: () => ({
      defaultMode: 'standard',
      defaultSummary: 'auto',
      models: [
        { provider: 'cotton-codex', model: 'gpt-5.6-luna', mode: 'standard', summary: 'concise' },
        { provider: 'cotton-codex-plus', model: 'gpt-5.6-luna', mode: 'pro', summary: 'detailed' },
      ],
    }),
    watch: () => () => {},
  }
  const listeners = []
  const disposers = []
  const ctx = {
    settings: { register: () => settingsScope },
    on: (name, listener) => { listeners.push({ name, listener }); return () => {} },
    effect: (callback) => { const disposer = callback(); disposers.push(disposer); return disposer },
    logger: { warn: () => {} },
  }
  try {
    apply(ctx)
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
  const settingsScope = {
    get: () => ({
      defaultMode: 'standard',
      defaultSummary: 'auto',
      models: [
        { provider: 'cotton-codex', model: 'gpt-5.6-luna', mode: 'standard', summary: 'auto' },
        { provider: 'cotton-codex-plus', model: 'gpt-5.6-luna', mode: 'pro', summary: 'detailed' },
        { provider: 'cotton-codex-enterprise', model: 'gpt-5.6-luna', mode: 'standard', summary: 'concise' },
      ],
    }),
    watch: () => () => {},
  }
  const listeners = []
  const disposers = []
  const warnings = []
  const ctx = {
    settings: { register: () => settingsScope },
    on: (name, listener) => { listeners.push({ name, listener }); return () => {} },
    effect: (callback) => { const disposer = callback(); disposers.push(disposer); return disposer },
    logger: { warn: (message) => warnings.push(String(message)) },
  }
  try {
    apply(ctx)
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
