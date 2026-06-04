import { UserService } from '../services/user'
import { AuthService } from '../services/auth'

export class UserController {
  private userService: UserService
  private authService: AuthService

  constructor(userService: UserService, authService: AuthService) {
    this.userService = userService
    this.authService = authService
  }

  async handleGetUser(req: { params: { id: string }; headers: { authorization?: string } }) {
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (!token) return { status: 401, body: 'Unauthorized' }

    const currentUser = await this.authService.validateToken(token)
    if (!currentUser) return { status: 401, body: 'Invalid token' }

    const user = await this.userService.getUser(req.params.id)
    if (!user) return { status: 404, body: 'Not found' }

    return { status: 200, body: user }
  }

  async handleCreateUser(req: { body: { name: string; email: string; role: string }; headers: { authorization?: string } }) {
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (!token) return { status: 401, body: 'Unauthorized' }

    const currentUser = await this.authService.validateToken(token)
    if (!currentUser || currentUser.role !== 'admin') return { status: 403, body: 'Forbidden' }

    const user = await this.userService.createUser({
      name: req.body.name,
      email: req.body.email,
      role: req.body.role as 'admin' | 'user',
    })
    return { status: 201, body: user }
  }
}
