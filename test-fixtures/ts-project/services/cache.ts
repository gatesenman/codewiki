import { Logger } from './logger'

export interface CacheOptions {
  ttl: number
  maxSize: number
}

export abstract class BaseCache<T> {
  protected items: Map<string, { value: T; expires: number }> = new Map()
  protected logger: Logger

  constructor(logger: Logger) {
    this.logger = logger
  }

  abstract serialize(value: T): string
  abstract deserialize(raw: string): T

  get(key: string): T | null {
    const item = this.items.get(key)
    if (!item) return null
    if (item.expires < Date.now()) {
      this.items.delete(key)
      return null
    }
    return item.value
  }

  set(key: string, value: T, ttl: number = 60000): void {
    this.items.set(key, { value, expires: Date.now() + ttl })
    this.logger.info(`Cache set: ${key}`)
  }

  invalidate(key: string): void {
    this.items.delete(key)
  }

  clear(): void {
    this.items.clear()
  }
}

export class UserCache extends BaseCache<{ id: string; name: string }> {
  serialize(value: { id: string; name: string }): string {
    return JSON.stringify(value)
  }

  deserialize(raw: string): { id: string; name: string } {
    return JSON.parse(raw)
  }
}

@Cacheable({ ttl: 300 })
export class SessionCache extends BaseCache<{ token: string; userId: string }> {
  serialize(value: { token: string; userId: string }): string {
    return JSON.stringify(value)
  }

  deserialize(raw: string): { token: string; userId: string } {
    return JSON.parse(raw)
  }
}

function Cacheable(options: { ttl: number }): ClassDecorator {
  return function(target: Function) {
    Object.defineProperty(target.prototype, 'defaultTTL', { value: options.ttl })
  }
}
