import type { ModelPricing, PricingMap } from '../types.js'

/**
 * Transforms LiteLLM's `model_prices_and_context_window.json` shape into our
 * PricingMap. This MIRRORS the build-time transform in scripts/sync-pricing.mjs —
 * keep the two in sync (pricing-transform.test.ts guards this one). It exists
 * separately so the optional runtime refresh (pricing-cache.ts) produces entries
 * byte-identical to the bundled pricing.json.
 */

const perM = (v: number): number => +(v * 1_000_000).toFixed(6)

function addTieredPricing(entry: ModelPricing, spec: Record<string, unknown>): void {
  const thrKey = Object.keys(spec).find((k) => /^input_cost_per_token_above_(\d+)k_tokens$/.test(k))
  if (thrKey) {
    const n = parseInt(thrKey.match(/_above_(\d+)k_tokens$/)![1], 10)
    entry.thresholdTokens = n * 1000
    entry.inputPerMillionAboveThreshold = perM(spec[thrKey] as number)
    const out = spec[`output_cost_per_token_above_${n}k_tokens`]
    const cr = spec[`cache_read_input_token_cost_above_${n}k_tokens`]
    const cw = spec[`cache_creation_input_token_cost_above_${n}k_tokens`]
    if (typeof out === 'number') entry.outputPerMillionAboveThreshold = perM(out)
    if (typeof cr === 'number') entry.cacheReadPerMillionAboveThreshold = perM(cr)
    if (typeof cw === 'number') entry.cacheWritePerMillionAboveThreshold = perM(cw)
  }

  if (typeof spec.input_cost_per_token_priority === 'number')
    entry.priorityInputPerMillion = perM(spec.input_cost_per_token_priority)
  if (typeof spec.output_cost_per_token_priority === 'number')
    entry.priorityOutputPerMillion = perM(spec.output_cost_per_token_priority)
  if (typeof spec.cache_read_input_token_cost_priority === 'number')
    entry.priorityCacheReadPerMillion = perM(spec.cache_read_input_token_cost_priority)
}

// First-party providers win on id collisions, so a bare id like `claude-opus-4-8`
// gets the canonical Anthropic price rather than a Bedrock/OpenRouter variant.
const MODELSDEV_PROVIDER_PRIORITY = ['anthropic', 'openai', 'google', 'google-vertex', 'azure', 'xai', 'deepseek', 'mistral']
const providerRank = (p: string): number => {
  const i = MODELSDEV_PROVIDER_PRIORITY.indexOf(p)
  return i === -1 ? MODELSDEV_PROVIDER_PRIORITY.length : i
}

/**
 * Transforms models.dev's `api.json` (nested by provider; costs already in USD per
 * MILLION tokens) into our flat PricingMap. Pure/deterministic — used only to
 * cross-verify LiteLLM, never as the primary source (see pricing-reconcile.ts).
 */
export function transformModelsDev(api: Record<string, unknown>): PricingMap {
  const out: PricingMap = {}
  const providers = Object.keys(api).sort((a, b) => providerRank(a) - providerRank(b))
  for (const pid of providers) {
    const prov = api[pid] as { models?: Record<string, unknown> } | undefined
    const models = prov?.models
    if (!models || typeof models !== 'object') continue
    for (const mid of Object.keys(models)) {
      const m = models[mid] as { id?: string; cost?: Record<string, unknown> }
      const c = m?.cost
      if (!c || typeof c.input !== 'number' || typeof c.output !== 'number') continue
      const key = m.id ?? mid
      if (out[key]) continue // highest-priority provider already set this id
      out[key] = {
        inputPerMillion: c.input,
        outputPerMillion: c.output,
        cacheReadPerMillion: typeof c.cache_read === 'number' ? c.cache_read : 0,
        cacheWritePerMillion: typeof c.cache_write === 'number' ? c.cache_write : 0,
      }
    }
  }
  return out
}

export function transformUpstream(upstream: Record<string, unknown>): PricingMap {
  const out: PricingMap = {}
  for (const [model, raw] of Object.entries(upstream)) {
    if (model === 'sample_spec') continue
    if (typeof raw !== 'object' || raw === null) continue
    const spec = raw as Record<string, unknown>
    const input = spec.input_cost_per_token
    const output = spec.output_cost_per_token
    if (typeof input !== 'number' || typeof output !== 'number') continue
    const entry: ModelPricing = {
      inputPerMillion: perM(input),
      outputPerMillion: perM(output),
      cacheReadPerMillion: perM((spec.cache_read_input_token_cost as number) ?? 0),
      cacheWritePerMillion: perM((spec.cache_creation_input_token_cost as number) ?? 0),
    }
    addTieredPricing(entry, spec)
    out[model] = entry
  }
  return out
}
