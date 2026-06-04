export interface AppConfig {
  port: number
  databaseUrl: string
  jwtSecret: string
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

export const defaultConfig: AppConfig = {
  port: 3000,
  databaseUrl: 'mongodb://localhost:27017/app',
  jwtSecret: 'change-me',
  logLevel: 'info',
}

export function loadConfig(): AppConfig {
  return {
    ...defaultConfig,
    port: parseInt(process.env.PORT || '3000'),
    databaseUrl: process.env.DATABASE_URL || defaultConfig.databaseUrl,
    jwtSecret: process.env.JWT_SECRET || defaultConfig.jwtSecret,
  }
}
