import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encrypt } from '../server/utils/crypto'
import { saveSentCopy } from '../server/utils/sentCopy'

function fakeAdmin() {
  const folderMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'sent-folder' }, error: null })
  const folderSelect = vi.fn(() => ({
    eq: () => ({ eq: () => ({ maybeSingle: folderMaybeSingle }) })
  }))

  const messageLimit = vi.fn().mockResolvedValue({ data: [], error: null })
  const messageSelect = vi.fn(() => ({
    eq: () => ({ eq: () => ({ eq: () => ({ limit: messageLimit }) }) })
  }))
  const messageInsertSingle = vi.fn().mockResolvedValue({ data: { id: 'sent-message' }, error: null })
  const messageInsert = vi.fn(() => ({ select: () => ({ single: messageInsertSingle }) }))

  const from = vi.fn((table: string) => {
    if (table === 'folders') return { select: folderSelect }
    if (table === 'messages') return { select: messageSelect, insert: messageInsert }
    throw new Error(`unexpected table ${table}`)
  })

  return { admin: { from } as any, messageInsert }
}

describe('saveSentCopy', () => {
  beforeEach(() => {
    process.env.MAIL_ENCRYPTION_KEY = randomBytes(32).toString('hex')
  })

  it('appends a compiled message to IMAP Sent and stores it locally', async () => {
    const { admin, messageInsert } = fakeAdmin()
    const compile = vi.fn().mockResolvedValue({ message: Buffer.from('raw message') })
    const createRawTransport = vi.fn().mockReturnValue({ sendMail: compile })
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([
        { path: 'INBOX', delimiter: '.', specialUse: '\\Inbox' },
        { path: 'INBOX.Sent', delimiter: '.', specialUse: '\\Sent' }
      ]),
      mailboxCreate: vi.fn(),
      append: vi.fn().mockResolvedValue({ uid: 777 }),
      logout: vi.fn().mockResolvedValue(undefined)
    }
    const mailbox = {
      id: 'mb-1',
      email: 'sender@example.com',
      imap_host: 'imap.example.com',
      imap_port: 993,
      smtp_host: 'smtp.example.com',
      smtp_port: 465,
      imap_password_encrypted: encrypt('mail-password')
    }

    const result = await saveSentCopy(
      admin,
      mailbox,
      { to: 'recipient@example.com', subject: 'Hello', text: 'Body', messageId: '<id@example.com>' },
      createRawTransport,
      () => client
    )

    expect(result).toEqual({ saved: true })
    expect(client.append).toHaveBeenCalledWith('INBOX.Sent', Buffer.from('raw message'), ['\\Seen'], expect.any(Date))
    expect(client.mailboxCreate).not.toHaveBeenCalled()
    expect(messageInsert).toHaveBeenCalledWith(expect.objectContaining({
      folder_id: 'sent-folder',
      imap_uid: 777,
      from_addr: 'sender@example.com',
      to_addrs: ['recipient@example.com'],
      subject: 'Hello'
    }))
  })
})
