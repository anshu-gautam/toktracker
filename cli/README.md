# Tokscale — proactive insights for AI coding assistants

Tokscale hooks into Claude Code, Codex, OpenCode, and Gemini CLI to watch
your token spend in real time and warn you before waste compounds. No existing
tool proactively surfaces AI-agent anti-patterns while they are happening;
Tokscale does.

## Install

```
npm install -g tokscale
```

Requires Node 20+.

## Quick start

```
# Open the TUI dashboard
tokscale

# Enable hook injection for Claude Code (writes to settings.json)
tokscale hook install --global

# Start background watcher for Codex / OpenCode / Gemini
tokscale daemon start --detach
```

## What it does

Tokscale runs 14 detection rules grouped into four families:

- **Redundant tool calls** — repeated reads of the same file, duplicate Bash
  commands, unnecessary directory listings within a single session.
- **Context bloat** — large file re-opens, prompt templates that inflate token
  count, context-window ETA warnings before you hit the limit.
- **Waste postmortems** — cache-miss analysis, retry and failure spend, model
  mismatch (using Opus where Haiku suffices), runaway kill-switch detection.
- **Session-level signals** — repeat questions across sessions, correction
  patterns (you frequently fix AI output), cost per merged PR, abandoned
  session detection, pre-flight cost estimation.

Rules emit inline hints inside Claude Code via the hook mechanism. The TUI
aggregates everything into a single dashboard.

## TUI cheat sheet

```
1-0       Switch tabs (Sessions, Today, Models, Repos, Hooks, Rules,
          Insights, Redact, Privacy, Help)
?         Full keybinding overlay
q         Quit
```

## CLI cheat sheet

```
# Hooks
tokscale hook install [--global|--local]
tokscale hook status  [--global|--local]
tokscale hook uninstall [--global|--local]

# Rules
tokscale rules list
tokscale rules enable  <rule-id>
tokscale rules disable <rule-id>
tokscale rules set-threshold <rule-id> <value>
tokscale rules hard-block <rule-id> [on|off]

# Redaction
tokscale redact list
tokscale redact add <pattern>
tokscale redact test <string>

# Daemon
tokscale daemon start [--detach]
tokscale daemon stop
tokscale daemon status

# Privacy
tokscale privacy audit
tokscale privacy wipe

# Export
tokscale export
```

## Privacy

All data is stored locally in `~/.config/tokscale/toktracker.db`. Nothing
leaves your machine unless you explicitly export it. The redaction pipeline
strips secrets and PII from payloads before they reach the database. Run
`tokscale privacy audit` to inspect what is stored, and `tokscale privacy wipe`
to delete everything.

## Pricing

Model prices ship bundled in the binary (`src/data/pricing.json`), generated at
build time from a **pinned** commit of LiteLLM's public pricing catalog and
recorded in `src/data/pricing-source.json` (commit + SHA-256) so any source
change is a reviewable diff. With this baseline, costing works **fully offline** —
there are no runtime network calls by default.

Unknown models are never silently mis-priced: lookup is exact-match (with
deterministic date/version-suffix normalization), and a model with no known price
is marked **unpriced** (`$0` placeholder) and surfaced in the dashboard rather
than guessed from a similarly-named model.

### Optional pricing refresh (off by default)

To pick up newly-launched models between releases, you can opt into a best-effort
background refresh:

```bash
tokscale pricing enable      # opt into the nightly refresh
tokscale pricing refresh     # or fetch once, right now
tokscale pricing status      # show state, source, cache age
tokscale pricing disable     # opt back out
```

### Cross-verify two sources (`pricing verify`)

`tokscale pricing verify` fetches **both** LiteLLM and [models.dev](https://models.dev)
and cross-checks them — pure deterministic code, no AI in the loop. A model is
*verified* when both sources agree on its input/output rates (within a tolerance,
default 1%); disagreements are reported, never silently resolved. LiteLLM stays the
primary/shipped source; models.dev is only a second opinion.

```bash
tokscale pricing verify                  # summary + top conflicts
tokscale pricing verify --tolerance 2    # loosen agreement to 2%
```

It writes a full report to `~/.config/tokscale/pricing-verification.json` and
**exits non-zero if a flagship model** (the ids coding tools actually report —
Claude/GPT/Gemini) disagrees, so it can gate CI.

When enabled, the **daemon's nightly job** (never the parse path, never on
startup) fetches the latest catalog into `~/.config/tokscale/pricing-cache.json`,
which overlays — but never replaces — the bundled baseline. Safeguards:

- **Anti-corruption guard** — a fetched catalog missing sentinel models or >5% of
  previously-known models is rejected; the last-good cache (and bundled floor) stay.
- **Keep-last-good** — any fetch/parse error leaves existing pricing untouched.
- **Disclosed** — `tokscale privacy audit` reports whether refresh is enabled, the
  endpoint, last-fetch time, and cache age; `tokscale privacy wipe` deletes the cache.

No session data is ever sent — the refresh is a plain `GET` of a public JSON file.

## Requirements

- Node 20+
- macOS or Linux (Windows is untested)

## License

MIT
