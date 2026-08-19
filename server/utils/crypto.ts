import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

function getKey(): Buffer {
  const hex = process.env.MAIL_ENCRYPTION_KEY
  if (!hex) throw new Error('MAIL_ENCRYPTION_KEY must be set')
  const key = Buffer.from(hex, 'hex')
  if (key.length !== 32) throw new Error('MAIL_ENCRYPTION_KEY must be 32 bytes (64 hex chars)')
  return key
}

export function encrypt(text: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decrypt(payload: string): string {
  const key = getKey()
  const buf = Buffer.from(payload, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}
