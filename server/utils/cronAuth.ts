export function assertCronAuthorized(authHeader: string | undefined | null, secret: string | undefined): void {
  if (!secret) {
    throw new Error('CRON_SECRET is not configured')
  }
  if (authHeader !== `Bearer ${secret}`) {
    const err = new Error('Unauthorized cron request') as Error & { statusCode: number }
    err.statusCode = 401
    throw err
  }
}
