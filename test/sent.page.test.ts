import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearNuxtData } from '#app'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import SentPage from '../app/pages/sent.vue'

const { from, mailboxOrder, messageEq, messageFolderEq, messageOrder, messageLimit, fetchMock } = vi.hoisted(() => ({
  from: vi.fn(),
  mailboxOrder: vi.fn(),
  messageEq: vi.fn(),
  messageFolderEq: vi.fn(),
  messageOrder: vi.fn(),
  messageLimit: vi.fn(),
  fetchMock: vi.fn()
}))

mockNuxtImport('useSupabaseClient', () => () => ({ from }))
mockNuxtImport('$fetch', () => fetchMock)

describe('sent page', () => {
  beforeEach(() => {
    clearNuxtData('sent-messages')
    fetchMock.mockReset().mockResolvedValue({ ok: true })
    mailboxOrder.mockResolvedValue({ data: [{ id: 'mb-1', email: 'inbox@example.com' }], error: null })
    messageEq.mockReturnValue({ eq: messageFolderEq })
    messageFolderEq.mockReturnValue({ order: messageOrder })
    messageOrder.mockReturnValue({ limit: messageLimit })
    from.mockImplementation((table: string) => {
      if (table === 'mailboxes') return { select: () => ({ order: mailboxOrder }) }
      if (table === 'messages') return { select: () => ({ eq: messageEq }) }
      throw new Error(`unexpected table ${table}`)
    })
  })

  it('renders sent messages and their recipients', async () => {
    messageLimit.mockResolvedValue({
      data: [{
        id: 'sent-1',
        mailbox_id: 'mb-1',
        subject: 'Shipping documents',
        to_addrs: ['customer@example.com'],
        received_at: '2026-08-20',
        is_read: true
      }],
      error: null
    })

    const wrapper = await mountSuspended(SentPage)

    expect(wrapper.text()).toContain('Shipping documents')
    expect(wrapper.text()).toContain('To: customer@example.com')
    expect(wrapper.get('a[href="/mail/sent-1"]').exists()).toBe(true)
  })

  it('syncs the selected mailbox from Sent', async () => {
    messageLimit.mockResolvedValue({ data: [], error: null })
    const wrapper = await mountSuspended(SentPage)

    await wrapper.get('button[aria-label="Refresh"]').trigger('click')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenCalledWith('/api/mail/sync', {
      method: 'POST',
      body: { mailboxId: 'mb-1' }
    })
  })
})
