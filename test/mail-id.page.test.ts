// test/mail-id.page.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import MailDetailPage from '../app/pages/mail/[id].vue'

// mockNuxtImport rewrites into a hoisted vi.mock() call, so the values its
// factory closes over must be declared via vi.hoisted() — a plain top-level
// const here throws "Cannot access '...' before initialization" (TDZ).
const { fetchMock, navigateToMock, confirmMock } = vi.hoisted(() => ({
  fetchMock: vi.fn().mockResolvedValue({ ok: true }),
  navigateToMock: vi.fn(),
  confirmMock: vi.fn().mockReturnValue(true)
}))

vi.stubGlobal('confirm', confirmMock)

mockNuxtImport('useRoute', () => () => ({ params: { id: 'm1' } }))
mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('navigateTo', () => navigateToMock)
mockNuxtImport('useSupabaseClient', () => {
  return () => ({
    from: vi.fn((table: string) => {
      if (table === 'messages') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: {
                  id: 'm1',
                  mailbox_id: 'mb-1',
                  from_addr: 'sender@example.com',
                  to_addrs: ['inbox1@example.com'],
                  subject: 'Hello there',
                  body_html: null,
                  body_text: 'Plain body',
                  received_at: '2026-08-19'
                },
                error: null
              })
            }),
            update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) })
          }),
          update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) })
        }
      }
      if (table === 'attachments') {
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    })
  })
})

describe('mail detail page', () => {
  beforeEach(() => {
    fetchMock.mockClear()
    navigateToMock.mockClear()
    confirmMock.mockClear().mockReturnValue(true)
  })

  it('renders the message subject and body', async () => {
    const wrapper = await mountSuspended(MailDetailPage)
    expect(wrapper.text()).toContain('Hello there')
    expect(wrapper.text()).toContain('Plain body')
  })

  it('sends a reply via /api/mail/send', async () => {
    const wrapper = await mountSuspended(MailDetailPage)
    await wrapper.get('button[aria-label="Reply"]').trigger('click')
    await wrapper.find('textarea').setValue('My reply')
    await wrapper.find('form').trigger('submit.prevent')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenCalledWith('/api/mail/send', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ mailboxId: 'mb-1', text: 'My reply' })
    }))
  })

  it('moves the message to Trash after confirmation', async () => {
    const wrapper = await mountSuspended(MailDetailPage)

    await wrapper.get('button[aria-label="Move to Trash"]').trigger('click')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(confirmMock).toHaveBeenCalledWith('Move this message to Trash?')
    expect(fetchMock).toHaveBeenCalledWith('/api/mail/m1', { method: 'DELETE' })
    expect(navigateToMock).toHaveBeenCalledWith('/')
  })
})
