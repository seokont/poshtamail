import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encrypt } from '../server/utils/crypto'
import { trashMailForUser } from '../server/utils/trashMail'

function fakeAdmin(encryptedPassword: string) {
  const messageSingle = vi.fn().mockResolvedValue({
    data: { id: 'msg-1', mailbox_id: 'mb-1', folder_id: 'inbox-folder', imap_uid: 101 },
    error: null
  })
  const messageSelect = vi.fn(() => ({ eq: () => ({ single: messageSingle }) }))
  const updateMessageEq = vi.fn().mockResolvedValue({ error: null })
  const updateMessage = vi.fn(() => ({ eq: updateMessageEq }))

  const accessMaybeSingle = vi.fn().mockResolvedValue({ data: { mailbox_id: 'mb-1' }, error: null })
  const accessSelect = vi.fn(() => ({
    eq: () => ({ eq: () => ({ maybeSingle: accessMaybeSingle }) })
  }))

  const mailboxSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'mb-1',
      email: 'inbox@example.com',
      imap_host: 'imap.example.com',
      imap_port: 993,
      smtp_host: 'smtp.example.com',
      smtp_port: 465,
      imap_password_encrypted: encryptedPassword
    },
    error: null
  })
  const mailboxSelect = vi.fn(() => ({ eq: () => ({ single: mailboxSingle }) }))

  const sourceFolderSingle = vi.fn().mockResolvedValue({ data: { name: 'INBOX' }, error: null })
  const trashFolderMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'trash-folder' }, error: null })
  const folderSelect = vi.fn((columns: string) => columns === 'name'
    ? { eq: () => ({ single: sourceFolderSingle }) }
    : { eq: () => ({ eq: () => ({ maybeSingle: trashFolderMaybeSingle }) }) })

  const messagesTable = { select: messageSelect, update: updateMessage }
  const from = vi.fn((table: string) => {
    if (table === 'messages') return messagesTable
    if (table === 'mailbox_access') return { select: accessSelect }
    if (table === 'mailboxes') return { select: mailboxSelect }
    if (table === 'folders') return { select: folderSelect }
    throw new Error(`unexpected table ${table}`)
  })

  return { admin: { from } as any, updateMessage, updateMessageEq }
}

describe('trashMailForUser', () => {
  beforeEach(() => {
    process.env.MAIL_ENCRYPTION_KEY = randomBytes(32).toString('hex')
  })

  it('moves the IMAP message to Trash and updates its local folder', async () => {
    const { admin, updateMessage, updateMessageEq } = fakeAdmin(encrypt('mail-password'))
    const release = vi.fn()
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([
        { path: 'INBOX', delimiter: '.', specialUse: '\\Inbox' },
        { path: 'INBOX.Trash', delimiter: '.', specialUse: '\\Trash' }
      ]),
      mailboxCreate: vi.fn(),
      getMailboxLock: vi.fn().mockResolvedValue({ release }),
      messageMove: vi.fn().mockResolvedValue({ uidMap: new Map([[101, 501]]) }),
      logout: vi.fn().mockResolvedValue(undefined)
    }

    await expect(trashMailForUser(admin, 'user-1', 'msg-1', () => client)).resolves.toEqual({ ok: true })

    expect(client.getMailboxLock).toHaveBeenCalledWith('INBOX')
    expect(client.messageMove).toHaveBeenCalledWith([101], 'INBOX.Trash', { uid: true })
    expect(client.mailboxCreate).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalled()
    expect(updateMessage).toHaveBeenCalledWith({ folder_id: 'trash-folder', imap_uid: 501, is_read: true })
    expect(updateMessageEq).toHaveBeenCalledWith('id', 'msg-1')
  })
})
