import { describe, expect, it } from 'vitest'
import { assertCronAuthorized } from '../server/utils/cronAuth'

describe('assertCronAuthorized', () => {
  it('throws if CRON_SECRET is not configured', () => {
    expect(() => assertCronAuthorized('Bearer x', undefined)).toThrow('CRON_SECRET')
  })

  it('throws a 401 when the header does not match', () => {
    try {
      assertCronAuthorized('Bearer wrong', 'right-secret')
      throw new Error('should have thrown')
    } catch (err: any) {
      expect(err.statusCode).toBe(401)
    }
  })

  it('does not throw when the header matches', () => {
    expect(() => assertCronAuthorized('Bearer right-secret', 'right-secret')).not.toThrow()
  })
})
