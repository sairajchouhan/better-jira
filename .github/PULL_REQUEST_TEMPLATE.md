## Summary
-

## Verification
- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun test`
- [ ] `bun run test:e2e -- --grep-invert "speed:"` (for UI/API changes)
- [ ] `bun run verify:models --prove-bugs` (if touching sync, outbox, uploads, or inbox)
