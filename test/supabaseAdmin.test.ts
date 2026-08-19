import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: vi.fn() }))
}))

describe('getSupabaseAdmin', () => {
  afterEach(() => {
    vi.resetModules()
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  it('throws when SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY are missing', async () => {
    const { getSupabaseAdmin } = await import('../server/utils/supabaseAdmin')
    expect(() => getSupabaseAdmin()).toThrow(/SUPABASE_URL/)
  })

  it('returns a client once env vars are set, and reuses it', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    const { getSupabaseAdmin } = await import('../server/utils/supabaseAdmin')
    const a = getSupabaseAdmin()
    const b = getSupabaseAdmin()
    expect(a).toBe(b)
    expect(typeof a.from).toBe('function')
  })
})
