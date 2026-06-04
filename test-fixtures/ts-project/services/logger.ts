export class Logger {
  private prefix: string

  constructor(prefix: string = '') {
    this.prefix = prefix
  }

  info(message: string): void {
    console.log(`[INFO] ${this.prefix} ${message}`)
  }

  warn(message: string): void {
    console.warn(`[WARN] ${this.prefix} ${message}`)
  }

  error(message: string, err?: Error): void {
    console.error(`[ERROR] ${this.prefix} ${message}`, err)
  }
}
