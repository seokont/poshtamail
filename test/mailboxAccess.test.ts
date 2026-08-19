import { describe, expect, it, vi } from 'vitest'
import { assertMailboxAccess } from '../server/utils/mailboxAccess'

function fakeAdmin(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const eq2 = vi.fn(() => ({ maybeSingle }))
  const eq1 = vi.fn(() => ({ eq: eq2 }))
  const select = vi.fn(() => ({ eq: eq1 }))
  const from = vi.fn(() => ({ select }))
  return { from } as any
}

describe('assertMailboxAccess', () => {
  it('resolves when an access row exists', async () => {
    const admin = fakeAdmin({ data: { mailbox_id: 'mb-1' }, error: null })
    await expect(assertMailboxAccess(admin, 'user-1', 'mb-1')).resolves.toBeUndefined()
  })

  it('throws 403 when no access row exists', async () => {
    const admin = fakeAdmin({ data: null, error: null })
    await expect(assertMailboxAccess(admin, 'user-1', 'mb-1')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('throws 500 on a query error', async () => {
    const admin = fakeAdmin({ data: null, error: { message: 'db down' } })
    await expect(assertMailboxAccess(admin, 'user-1', 'mb-1')).rejects.toMatchObject({ statusCode: 500 })
  })
})
