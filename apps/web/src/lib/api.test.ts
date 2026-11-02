import { afterEach, describe, expect, it, vi } from 'vitest'

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }))

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const unauthorized = () => json(401, { error: { code: 'TOKEN_EXPIRED', message: 'Session expired, please log in again' } })
const networkDown = () => Promise.reject(new TypeError('Failed to fetch'))

type Route = Record<string, Array<() => Response | Promise<Response>>>

/** Answers each "METHOD path" with its responses in order (the last one repeats); records every call. */
function server(routes: Route) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${new URL(url, 'http://app.test').pathname}`
      calls.push(key)
      const list = routes[key]
      if (!list) throw new Error(`unexpected ${key}`)
      return (list.length > 1 ? list.shift()! : list[0])()
    }),
  )
  return calls
}

/** A fresh copy of the module (it keeps the in-flight refresh between calls). */
async function load() {
  vi.resetModules()
  const mod = await import('./api')
  const ended = vi.fn()
  mod.onSessionExpired(ended)
  return { ...mod, ended }
}

afterEach(() => {
  vi.unstubAllGlobals()
  toastError.mockReset()
  Reflect.deleteProperty(navigator, 'locks')
})

describe('session refresh', () => {
  it('refreshes on a 401 and retries the request', async () => {
    const calls = server({ 'GET /api/v1/things': [unauthorized, () => json(200, { ok: 1 })], 'GET /api/v1/auth/me': [unauthorized], 'POST /api/v1/auth/refresh': [() => json(200)] })
    const { api, ended } = await load()
    await expect(api.get('/things')).resolves.toEqual({ ok: 1 })
    expect(calls).toEqual(['GET /api/v1/things', 'GET /api/v1/auth/me', 'POST /api/v1/auth/refresh', 'GET /api/v1/things'])
    expect(ended).not.toHaveBeenCalled()
  })

  it('a network failure during refresh does not log the user out', async () => {
    server({ 'GET /api/v1/things': [unauthorized], 'GET /api/v1/auth/me': [networkDown], 'POST /api/v1/auth/refresh': [networkDown] })
    const { api, ended } = await load()
    await expect(api.get('/things')).rejects.toMatchObject({ code: 'NETWORK', message: 'Connection problem, please retry' })
    expect(ended).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('Connection problem, please retry', { id: 'connection-problem' })
  })

  it('a server error (5xx) during refresh does not log the user out', async () => {
    server({ 'GET /api/v1/things': [unauthorized], 'GET /api/v1/auth/me': [unauthorized], 'POST /api/v1/auth/refresh': [() => new Response('Bad gateway', { status: 502 })] })
    const { api, ended } = await load()
    await expect(api.get('/things')).rejects.toMatchObject({ code: 'NETWORK' })
    expect(ended).not.toHaveBeenCalled()
  })

  it('a refused refresh retries the request once, then ends the session', async () => {
    const calls = server({ 'GET /api/v1/things': [unauthorized], 'GET /api/v1/auth/me': [unauthorized], 'POST /api/v1/auth/refresh': [unauthorized] })
    const { api, ended } = await load()
    await expect(api.get('/things')).rejects.toMatchObject({ status: 401 })
    expect(calls.filter((c) => c === 'GET /api/v1/things')).toHaveLength(2)
    expect(ended).toHaveBeenCalledTimes(1)
    expect(ended).toHaveBeenCalledWith('expired')
  })

  it('a refused refresh is not a logout when the retry works (another tab signed in meanwhile)', async () => {
    server({ 'GET /api/v1/things': [unauthorized, () => json(200, { ok: 1 })], 'GET /api/v1/auth/me': [unauthorized], 'POST /api/v1/auth/refresh': [unauthorized] })
    const { api, ended } = await load()
    await expect(api.get('/things')).resolves.toEqual({ ok: 1 })
    expect(ended).not.toHaveBeenCalled()
  })

  it('skips the refresh when another tab already refreshed (/auth/me works)', async () => {
    const calls = server({ 'GET /api/v1/things': [unauthorized, () => json(200, { ok: 1 })], 'GET /api/v1/auth/me': [() => json(200, {})] })
    const { api } = await load()
    await expect(api.get('/things')).resolves.toEqual({ ok: 1 })
    expect(calls).not.toContain('POST /api/v1/auth/refresh')
  })

  it('refreshes inside the auth-refresh Web Lock when the browser has one', async () => {
    const request = vi.fn((_name: string, fn: () => unknown) => Promise.resolve(fn()))
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
    server({ 'GET /api/v1/things': [unauthorized, () => json(200, { ok: 1 })], 'GET /api/v1/auth/me': [unauthorized], 'POST /api/v1/auth/refresh': [() => json(200)] })
    const { api } = await load()
    await expect(api.get('/things')).resolves.toEqual({ ok: 1 })
    expect(request).toHaveBeenCalledWith('auth-refresh', expect.any(Function))
  })

  it('parallel 401s in one tab share one refresh', async () => {
    const calls = server({
      'GET /api/v1/a': [unauthorized, () => json(200, 'a')],
      'GET /api/v1/b': [unauthorized, () => json(200, 'b')],
      'GET /api/v1/auth/me': [unauthorized],
      'POST /api/v1/auth/refresh': [() => json(200)],
    })
    const { api } = await load()
    await expect(Promise.all([api.get('/a'), api.get('/b')])).resolves.toEqual(['a', 'b'])
    expect(calls.filter((c) => c === 'POST /api/v1/auth/refresh')).toHaveLength(1)
  })

  it('tells other tabs: a logout there sends this tab to log in too', async () => {
    const { ended } = await load()
    const other = new BroadcastChannel('wz-auth')
    other.postMessage({ type: 'logged-out' })
    await vi.waitFor(() => expect(ended).toHaveBeenCalledWith('logged-out'))
    other.close()
  })
})
