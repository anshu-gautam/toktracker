import type { Command } from 'commander'
import { writeFileSync } from 'node:fs'
import { bootDb } from '../db/boot.js'
import { FeatureFlagsRepo } from '../db/repository.js'
import { getPricingCacheInfo, refreshPricing } from '../services/pricing-cache.js'
import { transformUpstream, transformModelsDev } from '../services/pricing-transform.js'
import { reconcilePricing } from '../services/pricing-reconcile.js'
import { pricingCachePath, pricingVerificationPath } from '../db/paths.js'

const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const MODELS_DEV_URL = 'https://models.dev/api.json'
// Flagship ids the coding tools actually report — a conflict here is release-gating.
const SENTINELS = ['claude-opus-4-8', 'claude-sonnet-4-5', 'gpt-5', 'gpt-4.1', 'gemini-2.5-pro']

export function registerPricingCommands(program: Command): void {
  const pricing = program.command('pricing').description('Model pricing data and optional refresh')

  pricing.command('status').action(() => {
    const flag = new FeatureFlagsRepo(bootDb()).get('pricing_refresh')
    const cache = getPricingCacheInfo()
    process.stdout.write(JSON.stringify({
      refreshEnabled: !!flag?.enabled,
      cacheFile: pricingCachePath(),
      cached: cache.exists,
      source: cache.source,
      lastFetchedAt: cache.fetchedAt ? new Date(cache.fetchedAt).toISOString() : null,
      cacheAgeHours: cache.ageMs != null ? +(cache.ageMs / 3_600_000).toFixed(1) : null,
      cachedModels: cache.modelCount ?? null,
    }, null, 2) + '\n')
  })

  pricing.command('enable').description('Opt into the nightly pricing refresh').action(() => {
    new FeatureFlagsRepo(bootDb()).set('pricing_refresh', { enabled: true })
    process.stdout.write('pricing refresh enabled (runs in the daemon nightly job)\n')
  })

  pricing.command('disable').description('Opt out of the nightly pricing refresh').action(() => {
    new FeatureFlagsRepo(bootDb()).set('pricing_refresh', { enabled: false })
    process.stdout.write('pricing refresh disabled\n')
  })

  pricing.command('refresh').description('Fetch the latest pricing catalog now (one-shot)').action(async () => {
    const r = await refreshPricing()
    process.stdout.write(JSON.stringify(r) + '\n')
    if (r.status !== 'ok') process.exitCode = 1
  })

  pricing.command('verify')
    .description('Cross-check LiteLLM against models.dev (pure code, no AI) and report agreement')
    .option('--tolerance <pct>', 'relative tolerance for agreement, in percent', '1')
    .action(async (opts) => {
      const tolerance = (parseFloat(opts.tolerance) || 1) / 100
      let litellm, modelsdev
      try {
        const [a, b] = await Promise.all([fetch(LITELLM_URL), fetch(MODELS_DEV_URL)])
        if (!a.ok) throw new Error(`LiteLLM HTTP ${a.status}`)
        if (!b.ok) throw new Error(`models.dev HTTP ${b.status}`)
        litellm = transformUpstream(await a.json() as Record<string, unknown>)
        modelsdev = transformModelsDev(await b.json() as Record<string, unknown>)
      } catch (err) {
        process.stderr.write(`verify failed: ${err instanceof Error ? err.message : String(err)}\n`)
        process.exitCode = 1
        return
      }

      const report = reconcilePricing(litellm, modelsdev, { tolerance })
      const overlap = report.verified.length + report.conflicts.length
      const agreePct = overlap > 0 ? (report.verified.length / overlap) * 100 : 0
      const sentinelConflicts = report.conflicts.filter((c) => SENTINELS.includes(c.model)).map((c) => c.model)

      const summary = {
        comparedFields: report.comparedFields,
        tolerancePct: tolerance * 100,
        litellmModels: Object.keys(litellm).length,
        modelsDevModels: Object.keys(modelsdev).length,
        overlap,
        verified: report.verified.length,
        conflicts: report.conflicts.length,
        agreementPct: +agreePct.toFixed(1),
        onlyLiteLLM: report.onlyPrimary.length,
        onlyModelsDev: report.onlySecondary.length,
        sentinelConflicts,
      }
      process.stdout.write(JSON.stringify(summary, null, 2) + '\n')

      if (report.conflicts.length > 0) {
        process.stdout.write('\ntop conflicts (by relative divergence):\n')
        for (const c of report.conflicts.slice(0, 10)) {
          const parts = c.diffs.map((d) => `${d.field} ${d.primary} vs ${d.secondary} (${(d.relDiff * 100).toFixed(0)}%)`)
          process.stdout.write(`  ${c.model}: ${parts.join(', ')}\n`)
        }
      }

      try {
        writeFileSync(pricingVerificationPath(), JSON.stringify({ summary, conflicts: report.conflicts }, null, 2))
        process.stdout.write(`\nfull report: ${pricingVerificationPath()}\n`)
      } catch { /* report write is best-effort */ }

      // Gate on the flagship models the coding tools actually report.
      if (sentinelConflicts.length > 0) {
        process.stderr.write(`\nflagship pricing disagreement: ${sentinelConflicts.join(', ')}\n`)
        process.exitCode = 1
      }
    })
}
