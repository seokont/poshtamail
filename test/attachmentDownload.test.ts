// test/attachmentDownload.test.ts
import { describe, expect, it, vi } from 'vitest'
import { getAttachmentSignedUrl } from '../server/utils/attachmentDownload'

function fakeAdmin(opts: { hasAccess: boolean }) {
  const attSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'att-1',
      storage_path: 'mb-1/101/file.txt',
      filename: 'file.txt',
      message_id: 'msg-1',
      messages: { mailbox_id: 'mb-1' }
    },
    error: null
  })
  const attEq = vi.fn(() => ({ single: attSingle }))
  const attSelect = vi.fn(() => ({ eq: attEq }))

  const accessMaybeSingle = vi.fn().mockResolvedValue({
    data: opts.hasAccess ? { mailbox_id: 'mb-1' } : null,
    error: null
  })
  const accessEq2 = vi.fn(() => ({ maybeSingle: accessMaybeSingle }))
  const accessEq1 = vi.fn(() => ({ eq: accessEq2 }))
  const accessSelect = vi.fn(() => ({ eq: accessEq1 }))

  const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.example/file.txt' }, error: null })

  const from = vi.fn((table: string) => {
    if (table === 'attachments') return { select: attSelect }
    if (table === 'mailbox_access') return { select: accessSelect }
    throw new Error(`unexpected table ${table}`)
  })

  return { from, storage: { from: vi.fn(() => ({ createSignedUrl })) } } as any
}

describe('getAttachmentSignedUrl', () => {
  it('returns a signed URL when the user has access to the owning mailbox', async () => {
    const admin = fakeAdmin({ hasAccess: true })
    const result = await getAttachmentSignedUrl(admin, 'user-1', 'att-1')
    expect(result).toEqual({ url: 'https://signed.example/file.txt', filename: 'file.txt' })
  })

  it('rejects when the user has no access to the owning mailbox', async () => {
    const admin = fakeAdmin({ hasAccess: false })
    await expect(getAttachmentSignedUrl(admin, 'user-1', 'att-1')).rejects.toMatchObject({ statusCode: 403 })
  })
})
