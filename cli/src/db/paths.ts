import { homedir } from 'node:os'
import { join } from 'node:path'

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  const base = xdg ? xdg : join(homedir(), '.config')
  return join(base, 'tokscale')
}

export function dbPath(): string {
  return join(configDir(), 'toktracker.db')
}

export function hookLogPath(): string {
  return join(configDir(), 'hook.log')
}

export function modelsDir(): string {
  return join(configDir(), 'models')
}

export function pidFilePath(): string {
  return join(configDir(), 'daemon.pid')
}

export function pricingCachePath(): string {
  return join(configDir(), 'pricing-cache.json')
}

export function pricingVerificationPath(): string {
  return join(configDir(), 'pricing-verification.json')
}
