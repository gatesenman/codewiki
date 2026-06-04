import { Database } from './database'
import { Logger } from './logger'

export interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'user'
}

export class UserService {
  private db: Database
  private logger: Logger

  constructor(db: Database, logger: Logger) {
    this.db = db
    this.logger = logger
  }

  async getUser(id: string): Promise<User | null> {
    this.logger.info(`Fetching user ${id}`)
    return this.db.findOne('users', { id })
  }

  async createUser(data: Omit<User, 'id'>): Promise<User> {
    const user: User = { ...data, id: crypto.randomUUID() }
    await this.db.insert('users', user)
    this.logger.info(`Created user ${user.id}`)
    return user
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | null> {
    const user = await this.getUser(id)
    if (!user) return null
    const updated = { ...user, ...updates }
    await this.db.update('users', { id }, updated)
    return updated
  }

  async deleteUser(id: string): Promise<boolean> {
    this.logger.warn(`Deleting user ${id}`)
    return this.db.delete('users', { id })
  }

  async listUsers(filter?: { role?: string }): Promise<User[]> {
    return this.db.find('users', filter || {})
  }
}
