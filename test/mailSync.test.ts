// test/mailSync.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const fetchedMessage = { uid: 101, source: Buffer.from('raw-email') }

const connect = vi.fn().mockResolvedValue(undefined)
const release = vi.fn()
const getMailboxLock = vi.fn().mockResolvedValue({ release })
const logout = vi.fn().mockResolvedValue(undefined)
async function* fetchGenerator() {
  yield fetchedMessage
}
const fetchMock = vi.fn(() => fetchGenerator())

vi.mock('imapflow', () => ({
  // A regular `function` (not an arrow function) is required here: the
  // implementation code calls `new ImapFlow(...)`, and arrow functions
  // can never be invoked with `new` (they have no [[Construct]] slot) —
  // an arrow-function mockImplementation throws "is not a constructor".
  ImapFlow: vi.fn().mockImplementation(function () {
    return {
      connect,
      getMailboxLock,
      fetch: fetchMock,
      logout
    }
  })
}))

vi.mock('mailparser', () => ({
  simpleParser: vi.fn().mockResolvedValue({
    messageId: '<abc@example.com>',
    from: { text: 'sender@example.com' },
    to: { text: 'inbox1@example.com' },
    subject: 'Hello',
    text: 'Hello body',
    html: false,
    date: new Date('2026-08-19T00:00:00Z'),
    attachments: [{ filename: 'a.txt', content: Buffer.from('x'), contentType: 'text/plain', size: 1 }]
  })
}))

import { syncAllMailboxes } from '../server/utils/mailSync'

function fakeAdmin() {
  const messageSelectLimit = vi.fn().mockResolvedValue({ data: [], error: null })
  const messageSelectUid = vi.fn(() => ({ limit: messageSelectLimit }))
  const messageSelectFolder = vi.fn(() => ({ eq: messageSelectUid }))
  const messageSelectMailbox = vi.fn(() => ({ eq: messageSelectFolder }))
  const messageSelect = vi.fn(() => ({ eq: messageSelectMailbox }))
  const messageInsertSingle = vi.fn().mockResolvedValue({ data: { id: 'msg-1' }, error: null })
  const messageInsertSelect = vi.fn(() => ({ single: messageInsertSingle }))
  const messageInsert = vi.fn(() => ({ select: messageInsertSelect }))

  const attachmentSelectLimit = vi.fn().mockResolvedValue({ data: [], error: null })
  const attachmentSelectPath = vi.fn(() => ({ limit: attachmentSelectLimit }))
  const attachmentSelectMessage = vi.fn(() => ({ eq: attachmentSelectPath }))
  const attachmentSelect = vi.fn(() => ({ eq: attachmentSelectMessage }))
  const attachmentInsert = vi.fn().mockResolvedValue({ data: null, error: null })
  const updateEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const update = vi.fn(() => ({ eq: updateEq }))

  const folderMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'folder-1' }, error: null })
  const folderEqName = vi.fn(() => ({ maybeSingle: folderMaybeSingle }))
  const folderEqMailbox = vi.fn(() => ({ eq: folderEqName }))
  const folderSelect = vi.fn(() => ({ eq: folderEqMailbox }))

  const mailboxesSelect = vi.fn().mockResolvedValue({
    data: [{
      id: 'mb-1',
      email: 'inbox1@example.com',
      imap_host: 'imap.example.com',
      imap_port: 993,
      smtp_host: 'smtp.example.com',
      smtp_port: 465,
      imap_password_encrypted: 'cipher',
      last_uid_seen: 100
    }],
    error: null
  })

  const upload = vi.fn().mockResolvedValue({ data: {}, error: null })

  const from = vi.fn((table: string) => {
    if (table === 'mailboxes') return { select: mailboxesSelect, update }
    if (table === 'folders') return { select: folderSelect }
    if (table === 'messages') return { select: messageSelect, insert: messageInsert }
    if (table === 'attachments') return { select: attachmentSelect, insert: attachmentInsert }
    throw new Error(`unexpected table ${table}`)
  })

  return { from, storage: { from: vi.fn(() => ({ upload })) } } as any
}

describe('syncAllMailboxes', () => {
  beforeEach(() => {
    fetchMock.mockClear()
  })

  it('fetches only UIDs above last_uid_seen, saves the message and attachment, and advances last_uid_seen', async () => {
    const admin = fakeAdmin()
    const decrypt = vi.fn().mockReturnValue('plain-password')

    const result = await syncAllMailboxes(admin, decrypt)

    expect(result).toEqual({ ok: true, synced: 1 })
    expect(decrypt).toHaveBeenCalledWith('cipher')
    expect(fetchMock).toHaveBeenCalledWith('101:*', { envelope: true, source: true, uid: true }, { uid: true })
    expect(admin.from('messages').insert).toHaveBeenCalledWith(expect.objectContaining({
      mailbox_id: 'mb-1',
      folder_id: 'folder-1',
      imap_uid: 101,
      subject: 'Hello'
    }))
    expect(admin.from('mailboxes').update).toHaveBeenCalledWith({ last_uid_seen: 101 })
  })
})
