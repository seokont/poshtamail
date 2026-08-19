import { describe, expect, it, vi } from 'vitest'
import { listMessages } from '../server/utils/listMail'

function fakeAdmin(rows: unknown[]) {
  const accessMaybeSingle = vi.fn().mockResolvedValue({ data: { mailbox_id: 'mb-1' }, error: null })
  const accessEq2 = vi.fn(() => ({ maybeSingle: accessMaybeSingle }))
  const accessEq1 = vi.fn(() => ({ eq: accessEq2 }))
  const accessSelect = vi.fn(() => ({ eq: accessEq1 }))

  const range = vi.fn().mockResolvedValue({ data: rows, error: null })
  const order = vi.fn(() => ({ range }))
  const eq = vi.fn(() => ({ order }))
  const messagesSelect = vi.fn(() => ({ eq }))

  const from = vi.fn((table: string) => {
    if (table === 'mailbox_access') return { select: accessSelect }
    if (table === 'messages') return { select: messagesSelect }
    throw new Error(`unexpected table ${table}`)
  })
  return { from, range, order, eq } as any
}

describe('listMessages', () => {
  it('returns messages for a mailbox the user can access, newest first, paginated', async () => {
    const rows = [{ id: 'm1' }, { id: 'm2' }]
    const admin = fakeAdmin(rows)

    const result = await listMessages(admin, 'user-1', { mailboxId: 'mb-1', limit: 20, offset: 0 })

    expect(result).toEqual(rows)
    expect(admin.order).toHaveBeenCalledWith('received_at', { ascending: false })
    expect(admin.range).toHaveBeenCalledWith(0, 19)
  })

  it('defaults limit to 50 and offset to 0', async () => {
    const admin = fakeAdmin([])
    await listMessages(admin, 'user-1', { mailboxId: 'mb-1' })
    expect(admin.range).toHaveBeenCalledWith(0, 49)
  })
})
