import { AuthService } from '../services/auth'

export const createAuthMiddleware = (authService: AuthService) => {
  return async (req: { headers: { authorization?: string } }, next: () => Promise<void>) => {
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (!token) throw new Error('Unauthorized')

    const user = await authService.validateToken(token)
    if (!user) throw new Error('Invalid token')

    Object.assign(req, { user })
    await next()
  }
}
