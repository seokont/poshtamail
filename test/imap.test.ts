import { describe, expect, it, vi } from 'vitest'
import { buildImapConfig, ensureFolderId, type MailboxRow } from '../server/utils/imap'

const mailbox: MailboxRow = {
  id: 'mb-1',
  email: 'inbox1@example.com',
  imap_host: 'imap.example.com',
  imap_port: 993,
  smtp_host: 'smtp.example.com',
  smtp_port: 465
}

describe('buildImapConfig', () => {
  it('maps a mailbox row + decrypted password into an ImapFlow config', () => {
    expect(buildImapConfig(mailbox, 'plain-password')).toEqual({
      host: 'imap.example.com',
      port: 993,
      secure: true,
      auth: { user: 'inbox1@example.com', pass: 'plain-password' },
      logger: false
    })
  })
})

function fakeAdminForFolders(existing: { id: string } | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null })
  const eqName = vi.fn(() => ({ maybeSingle }))
  const eqMailbox = vi.fn(() => ({ eq: eqName }))
  const select = vi.fn(() => ({ eq: eqMailbox }))

  const single = vi.fn().mockResolvedValue({ data: { id: 'new-folder-id' }, error: null })
  const insertSelect = vi.fn(() => ({ single }))
  const insert = vi.fn(() => ({ select: insertSelect }))

  const from = vi.fn(() => ({ select, insert }))
  return { from } as any
}

describe('ensureFolderId', () => {
  it('returns the existing folder id without inserting', async () => {
    const admin = fakeAdminForFolders({ id: 'existing-folder-id' })
    await expect(ensureFolderId(admin, 'mb-1', 'INBOX')).resolves.toBe('existing-folder-id')
    expect(admin.from().insert).not.toHaveBeenCalled()
  })

  it('creates the folder when it does not exist yet', async () => {
    const admin = fakeAdminForFolders(null)
    await expect(ensureFolderId(admin, 'mb-1', 'INBOX')).resolves.toBe('new-folder-id')
  })
})
