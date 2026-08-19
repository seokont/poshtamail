// test/login.page.test.ts
import { describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import LoginPage from '../app/pages/login.vue'

// mockNuxtImport rewrites into a hoisted vi.mock() call, so the values its
// factory closes over must be declared via vi.hoisted() — a plain top-level
// const here throws "Cannot access '...' before initialization" (TDZ).
const { signInWithPassword, navigateToMock } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  navigateToMock: vi.fn()
}))

mockNuxtImport('useSupabaseClient', () => {
  return () => ({ auth: { signInWithPassword } })
})
mockNuxtImport('navigateTo', () => navigateToMock)

describe('login page', () => {
  it('signs in with the entered email/password and redirects home on success', async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    const wrapper = await mountSuspended(LoginPage)

    await wrapper.find('input[type="email"]').setValue('user@example.com')
    await wrapper.find('input[type="password"]').setValue('secret123')
    await wrapper.find('form').trigger('submit.prevent')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'user@example.com', password: 'secret123' })
    expect(navigateToMock).toHaveBeenCalledWith('/')
  })

  it('shows the error message and does not redirect on failure', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    navigateToMock.mockClear()
    const wrapper = await mountSuspended(LoginPage)

    await wrapper.find('input[type="email"]').setValue('user@example.com')
    await wrapper.find('input[type="password"]').setValue('wrong')
    await wrapper.find('form').trigger('submit.prevent')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(wrapper.text()).toContain('Invalid login credentials')
    expect(navigateToMock).not.toHaveBeenCalled()
  })
})
