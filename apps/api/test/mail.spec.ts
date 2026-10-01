import { Logger } from '@nestjs/common'
import { AppError } from '../src/common/errors'
import { resetConfigCache } from '../src/config'
import { MailService } from '../src/infra/mail.service'

describe('MailService', () => {
  const saved = { ...process.env }
  const msg = { to: 'asha@example.com', subject: 'Reset your Weddyzone Studio password', text: 'Use this link…' }
  let fetchMock: jest.SpyInstance

  const withEnv = (env: Record<string, string>) => {
    process.env = { ...saved, SMTP_HOST: '', ...env }
    resetConfigCache()
    return new MailService()
  }

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch')
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    jest.restoreAllMocks()
    process.env = { ...saved }
    resetConfigCache()
  })

  it('sends through Resend when RESEND_API_KEY is set', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'email_1' }), { status: 200 }))
    await withEnv({ RESEND_API_KEY: 're_123', MAIL_FROM: 'Weddyzone <no-reply@mail.weddyzone.app>' }).send(msg)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer re_123' })
    expect(JSON.parse(String(init.body))).toEqual({ from: 'Weddyzone <no-reply@mail.weddyzone.app>', to: ['asha@example.com'], subject: msg.subject, text: msg.text })
  })

  it.each([
    ['Resend rejects the request', () => fetchMock.mockResolvedValue(new Response(JSON.stringify({ name: 'validation_error', message: 'domain not verified' }), { status: 403 }))],
    ['Resend cannot be reached', () => fetchMock.mockRejectedValue(new TypeError('fetch failed'))],
  ])('throws a clear 503 when %s', async (_case, arrange) => {
    arrange()
    const sent = withEnv({ RESEND_API_KEY: 're_123' }).send(msg)
    await expect(sent).rejects.toBeInstanceOf(AppError)
    await expect(sent).rejects.toMatchObject({ status: 503, code: 'EMAIL_FAILED', message: expect.stringMatching(/couldn't send the email/) })
  })

  it('only logs the email when no provider is configured (development)', async () => {
    const mail = withEnv({ RESEND_API_KEY: '' })
    await expect(mail.send(msg)).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mail.lastMessage).toEqual(msg)
  })
})
