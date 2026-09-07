## Change

Explain the motivation, scope, and user-visible outcome.

## Risk

- Security-boundary impact:
- Format-compatibility impact:
- Windows/macOS/Linux impact:

## Verification

- [ ] `pnpm verify`
- [ ] `pnpm test:coverage`
- [ ] `pnpm benchmark` when minimization, Oracles, or replay changed
- [ ] `pnpm build && pnpm pack:cli && pnpm smoke:install`
- [ ] Relevant English and Chinese documentation and CHANGELOG are updated
- [ ] No credentials, raw captures, caches, or ignored local files are included
