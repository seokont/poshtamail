import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearNuxtData } from '#app'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import IndexPage from '../app/pages/index.vue'

const { from, mailboxOrder, messageEq, messageFolderEq, messageOrder, messageLimit, fetchMock } = vi.hoisted(() => ({
  from: vi.fn(),
  mailboxOrder: vi.fn(),
  messageEq: vi.fn(),
  messageFolderEq: vi.fn(),
  messageOrder: vi.fn(),
  messageLimit: vi.fn(),
  fetchMock: vi.fn()
}))

mockNuxtImport('useSupabaseClient', () => {
  return () => ({ from })
})
mockNuxtImport('useMailRealtime', () => vi.fn())
mockNuxtImport('$fetch', () => fetchMock)

describe('index page (inbox)', () => {
  beforeEach(() => {
    clearNuxtData('inbox-messages')
    fetchMock.mockReset().mockResolvedValue({ ok: true })
    mailboxOrder.mockResolvedValue({
      data: [{ id: 'mb-1', email: 'inbox1@example.com' }],
      error: null
    })
    messageEq.mockReturnValue({ eq: messageFolderEq })
    messageFolderEq.mockReturnValue({ order: messageOrder })
    messageOrder.mockReturnValue({ limit: messageLimit })
    from.mockImplementation((table: string) => {
      if (table === 'mailboxes') {
        return { select: () => ({ order: mailboxOrder }) }
      }
      if (table === 'messages') {
        return { select: () => ({ eq: messageEq }) }
      }
      throw new Error('unexpected table ' + table)
    })
  })

  it('renders the fetched messages', async () => {
    messageLimit.mockResolvedValue({
      data: [
        { id: 'm1', mailbox_id: 'mb-1', from_addr: 'a@example.com', subject: 'First', received_at: '2026-08-19', is_read: false },
        { id: 'm2', mailbox_id: 'mb-1', from_addr: 'b@example.com', subject: 'Second', received_at: '2026-08-18', is_read: true }
      ],
      error: null
    })

    const wrapper = await mountSuspended(IndexPage)

    expect(wrapper.text()).toContain('First')
    expect(wrapper.text()).toContain('Second')
    expect(wrapper.findAll('a').some(link => link.attributes('href') === '/mail/m1')).toBe(true)
  })

  it('shows an empty state when there are no messages', async () => {
    messageLimit.mockResolvedValue({ data: [], error: null })

    const wrapper = await mountSuspended(IndexPage)

    expect(wrapper.text()).toContain('Your inbox is empty')
  })

  it('syncs the selected mailbox when Refresh is clicked', async () => {
    messageLimit.mockResolvedValue({ data: [], error: null })
    const wrapper = await mountSuspended(IndexPage)

    await wrapper.get('button[aria-label=Refresh]').trigger('click')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenCalledWith('/api/mail/sync', {
      method: 'POST',
      body: { mailboxId: 'mb-1' }
    })
  })
})
