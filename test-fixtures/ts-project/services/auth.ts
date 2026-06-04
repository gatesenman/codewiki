import { UserService } from './user'
import type { User } from './user'

export interface AuthToken {
  token: string
  userId: string
  expiresAt: number
}

export class AuthService {
  private userService: UserService
  private tokens: Map<string, AuthToken> = new Map()

  constructor(userService: UserService) {
    this.userService = userService
  }

  async login(email: string, password: string): Promise<AuthToken | null> {
    const users = await this.userService.listUsers()
    const user = users.find(u => u.email === email)
    if (!user) return null

    const token: AuthToken = {
      token: Math.random().toString(36),
      userId: user.id,
      expiresAt: Date.now() + 3600000,
    }
    this.tokens.set(token.token, token)
    return token
  }

  async validateToken(tokenStr: string): Promise<User | null> {
    const token = this.tokens.get(tokenStr)
    if (!token || token.expiresAt < Date.now()) return null
    return this.userService.getUser(token.userId)
  }

  logout(tokenStr: string): void {
    this.tokens.delete(tokenStr)
  }
}
