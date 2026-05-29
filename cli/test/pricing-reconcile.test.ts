import { describe, it, expect } from 'vitest'
import { transformModelsDev } from '../src/services/pricing-transform.js'
import { reconcilePricing } from '../src/services/pricing-reconcile.js'
import type { PricingMap } from '../src/types.js'

describe('transformModelsDev', () => {
  it('flattens providers and keeps per-million costs, first-party winning on id collisions', () => {
    const out = transformModelsDev({
      bedrock: { models: { 'claude-opus-4-8': { id: 'claude-opus-4-8', cost: { input: 99, output: 99, cache_read: 9, cache_write: 9 } } } },
      anthropic: { models: { 'claude-opus-4-8': { id: 'claude-opus-4-8', cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 } } } },
      free: { models: { 'local-model': { id: 'local-model' } } }, // no cost -> skipped
    })
    // anthropic (higher priority) wins over bedrock for the shared id
    expect(out['claude-opus-4-8']).toEqual({
      inputPerMillion: 5, outputPerMillion: 25, cacheReadPerMillion: 0.5, cacheWritePerMillion: 6.25,
    })
    expect(out['local-model']).toBeUndefined()
  })
})

describe('reconcilePricing', () => {
  const primary: PricingMap = {
    'a': { inputPerMillion: 5, outputPerMillion: 25, cacheReadPerMillion: 0.5, cacheWritePerMillion: 6.25 },
    'b': { inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
    'c': { inputPerMillion: 1, outputPerMillion: 2, cacheReadPerMillion: 0, cacheWritePerMillion: 0 }, // primary-only
  }

  it('marks models both sources agree on as verified', () => {
    const secondary: PricingMap = {
      'a': { inputPerMillion: 5, outputPerMillion: 25, cacheReadPerMillion: 0.5, cacheWritePerMillion: 6.25 },
      'b': { inputPerMillion: 3.01, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 }, // within 1%
      'd': { inputPerMillion: 9, outputPerMillion: 9, cacheReadPerMillion: 0, cacheWritePerMillion: 0 }, // secondary-only
    }
    const r = reconcilePricing(primary, secondary, { tolerance: 0.01 })
    expect(r.verified).toEqual(['a', 'b'])
    expect(r.conflicts).toEqual([])
    expect(r.onlyPrimary).toEqual(['c'])
    expect(r.onlySecondary).toEqual(['d'])
    expect(r.merged).toBe(primary) // never overrides primary values
  })

  it('flags headline disagreements as conflicts (sorted by divergence)', () => {
    const secondary: PricingMap = {
      'a': { inputPerMillion: 10, outputPerMillion: 25, cacheReadPerMillion: 0.5, cacheWritePerMillion: 6.25 }, // input 2x
      'b': { inputPerMillion: 3.3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 }, // input +10%
    }
    const r = reconcilePricing(primary, secondary, { tolerance: 0.01 })
    expect(r.verified).toEqual([])
    expect(r.conflicts.map((c) => c.model)).toEqual(['a', 'b']) // 'a' (50%) before 'b' (~9%)
    expect(r.conflicts[0].diffs[0].field).toBe('inputPerMillion')
  })
})
