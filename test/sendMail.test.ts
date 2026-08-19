// test/sendMail.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encrypt } from '../server/utils/crypto'
import { sendMailForUser } from '../server/utils/sendMail'

function fakeAdmin(opts: { hasAccess: boolean; smtpPasswordEncrypted: string }) {
  const accessMaybeSingle = vi.fn().mockResolvedValue({
    data: opts.hasAccess ? { mailbox_id: 'mb-1' } : null,
    error: null
  })
  const accessEq2 = vi.fn(() => ({ maybeSingle: accessMaybeSingle }))
  const accessEq1 = vi.fn(() => ({ eq: accessEq2 }))
  const accessSelect = vi.fn(() => ({ eq: accessEq1 }))

  const mailboxSingle = vi.fn().mockResolvedValue({
    data: {
      email: 'inbox1@example.com',
      smtp_host: 'smtp.example.com',
      smtp_port: 465,
      smtp_password_encrypted: opts.smtpPasswordEncrypted
    },
    error: null
  })
  const mailboxEq = vi.fn(() => ({ single: mailboxSingle }))
  const mailboxSelect = vi.fn(() => ({ eq: mailboxEq }))

  const from = vi.fn((table: string) => {
    if (table === 'mailbox_access') return { select: accessSelect }
    if (table === 'mailboxes') return { select: mailboxSelect }
    throw new Error(`unexpected table ${table}`)
  })
  return { from } as any
}

describe('sendMailForUser', () => {
  beforeEach(() => {
    process.env.MAIL_ENCRYPTION_KEY = randomBytes(32).toString('hex')
  })

  it('rejects when the user has no access to the mailbox', async () => {
    const admin = fakeAdmin({ hasAccess: false, smtpPasswordEncrypted: encrypt('pw') })
    await expect(
      sendMailForUser(admin, 'user-1', { mailboxId: 'mb-1', to: 'x@y.com', subject: 'Hi' })
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('sends mail through nodemailer using the decrypted SMTP password', async () => {
    const admin = fakeAdmin({ hasAccess: true, smtpPasswordEncrypted: encrypt('smtp-secret') })
    const sendMail = vi.fn().mockResolvedValue({})
    const createTransport = vi.fn().mockReturnValue({ sendMail })

    const result = await sendMailForUser(
      admin,
      'user-1',
      { mailboxId: 'mb-1', to: 'x@y.com', subject: 'Hi', text: 'body' },
      createTransport as any
    )

    expect(result).toEqual({ ok: true })
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        auth: { user: 'inbox1@example.com', pass: 'smtp-secret' }
      })
    )
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'inbox1@example.com', to: 'x@y.com', subject: 'Hi', text: 'body' })
    )
  })
})
