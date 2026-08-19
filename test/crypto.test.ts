import { beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { decrypt, encrypt } from '../server/utils/crypto'

describe('crypto', () => {
  beforeEach(() => {
    process.env.MAIL_ENCRYPTION_KEY = randomBytes(32).toString('hex')
  })

  it('round-trips a plaintext string', () => {
    const ciphertext = encrypt('super-secret-password')
    expect(decrypt(ciphertext)).toBe('super-secret-password')
  })

  it('produces a different ciphertext each call (random IV)', () => {
    const a = encrypt('same-input')
    const b = encrypt('same-input')
    expect(a).not.toBe(b)
  })

  it('throws if the ciphertext was tampered with', () => {
    const ciphertext = encrypt('super-secret-password')
    const buf = Buffer.from(ciphertext, 'base64')
    buf[buf.length - 1] ^= 0xff // flip last byte of the encrypted payload
    const tampered = buf.toString('base64')
    expect(() => decrypt(tampered)).toThrow()
  })

  it('throws when MAIL_ENCRYPTION_KEY is not set', () => {
    delete process.env.MAIL_ENCRYPTION_KEY
    expect(() => encrypt('x')).toThrow('MAIL_ENCRYPTION_KEY')
  })

  it('throws when MAIL_ENCRYPTION_KEY is not 32 bytes', () => {
    process.env.MAIL_ENCRYPTION_KEY = '1234'
    expect(() => encrypt('x')).toThrow('32 bytes')
  })
})
