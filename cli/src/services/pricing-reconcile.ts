import type { PricingMap } from '../types.js'

// Pure, deterministic cross-verification of two pricing sources. No network, no
// LLM — just arithmetic. A model is "verified" when both sources agree on its
// headline rates; disagreements are surfaced as conflicts rather than silently
// resolved. The merged result keeps the PRIMARY source's values (we never let the
// secondary override prices), so this only ever adds confidence, never risk.

export interface FieldDiff {
  field: string
  primary: number
  secondary: number
  relDiff: number   // 0..1, relative to the larger magnitude
}

export interface Conflict {
  model: string
  diffs: FieldDiff[]
}

export interface ReconcileReport {
  comparedFields: string[]
  tolerance: number
  verified: string[]      // in both, all compared fields agree
  conflicts: Conflict[]   // in both, at least one field diverges
  onlyPrimary: string[]   // only the primary source has it (unverified)
  onlySecondary: string[] // only the secondary source has it
  merged: PricingMap      // primary values, unchanged
}

// Headline rates both catalogs always carry. Cache rates are reported as diffs
// when present but don't gate "verified" (sources differ on whether/how they
// encode cache pricing, which would create noisy false conflicts).
const COMPARE_FIELDS: Array<keyof FieldComparable> = ['inputPerMillion', 'outputPerMillion']
const CACHE_FIELDS: Array<keyof FieldComparable> = ['cacheReadPerMillion', 'cacheWritePerMillion']

interface FieldComparable {
  inputPerMillion: number
  outputPerMillion: number
  cacheReadPerMillion: number
  cacheWritePerMillion: number
}

function agree(a: number, b: number, tol: number): boolean {
  if (a === b) return true
  const max = Math.max(Math.abs(a), Math.abs(b))
  if (max === 0) return true
  return Math.abs(a - b) / max <= tol
}

function relDiff(a: number, b: number): number {
  const max = Math.max(Math.abs(a), Math.abs(b))
  return max === 0 ? 0 : Math.abs(a - b) / max
}

export interface ReconcileOptions {
  tolerance?: number       // relative tolerance for "agreement" (default 1%)
  includeCacheDiffs?: boolean // also report cache-rate divergences (default true)
}

export function reconcilePricing(
  primary: PricingMap,
  secondary: PricingMap,
  opts: ReconcileOptions = {},
): ReconcileReport {
  const tolerance = opts.tolerance ?? 0.01
  const includeCacheDiffs = opts.includeCacheDiffs ?? true

  const verified: string[] = []
  const conflicts: Conflict[] = []
  const onlyPrimary: string[] = []

  for (const model of Object.keys(primary)) {
    const s = secondary[model]
    if (!s) { onlyPrimary.push(model); continue }
    const p = primary[model]

    const diffs: FieldDiff[] = []
    let headlineConflict = false
    for (const f of COMPARE_FIELDS) {
      if (!agree(p[f], s[f], tolerance)) {
        diffs.push({ field: f, primary: p[f], secondary: s[f], relDiff: relDiff(p[f], s[f]) })
        headlineConflict = true
      }
    }
    if (includeCacheDiffs) {
      for (const f of CACHE_FIELDS) {
        // only compare when both report a non-zero rate — avoids "0 vs absent" noise
        if (p[f] > 0 && s[f] > 0 && !agree(p[f], s[f], tolerance)) {
          diffs.push({ field: f, primary: p[f], secondary: s[f], relDiff: relDiff(p[f], s[f]) })
        }
      }
    }

    if (headlineConflict) conflicts.push({ model, diffs })
    else verified.push(model)
  }

  const onlySecondary = Object.keys(secondary).filter((k) => !(k in primary))

  // Largest divergences first — most worth a human's attention.
  conflicts.sort((a, b) => {
    const am = Math.max(...a.diffs.map((d) => d.relDiff), 0)
    const bm = Math.max(...b.diffs.map((d) => d.relDiff), 0)
    return bm - am
  })

  return {
    comparedFields: [...COMPARE_FIELDS],
    tolerance,
    verified: verified.sort(),
    conflicts,
    onlyPrimary: onlyPrimary.sort(),
    onlySecondary: onlySecondary.sort(),
    merged: primary,
  }
}
