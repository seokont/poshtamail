import { describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

let capturedCallback: ((payload: { new: any }) => void) | undefined

// mockNuxtImport rewrites into a hoisted vi.mock() call, so the values its
// factory closes over must be declared via vi.hoisted() — a plain top-level
// const here throws "Cannot access '...' before initialization" (TDZ).
const { channel, on, removeChannel } = vi.hoisted(() => {
  const subscribe = vi.fn().mockReturnValue('channel-ref')
  const on = vi.fn((_event: string, _filter: unknown, cb: (payload: { new: any }) => void) => {
    capturedCallback = cb
    return { subscribe }
  })
  return {
    channel: vi.fn(() => ({ on })),
    on,
    removeChannel: vi.fn()
  }
})

mockNuxtImport('useSupabaseClient', () => {
  return () => ({ channel, removeChannel })
})

describe('useMailRealtime', () => {
  it('prepends newly inserted messages to the list', async () => {
    const { useMailRealtime } = await import('../app/composables/useMailRealtime')
    const messages = ref<any[]>([{ id: 'existing' }])
    const scope = effectScope()

    scope.run(() => useMailRealtime(messages))

    expect(channel).toHaveBeenCalledWith('inbox-updates')
    expect(on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      expect.any(Function)
    )

    capturedCallback?.({ new: { id: 'new-message' } })
    expect(messages.value.map((m) => m.id)).toEqual(['new-message', 'existing'])

    scope.stop()
    expect(removeChannel).toHaveBeenCalledWith('channel-ref')
  })
})
