import { createHash, randomBytes } from 'node:crypto'

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function randomStateId(): string {
  return randomBytes(16).toString('hex')
}
