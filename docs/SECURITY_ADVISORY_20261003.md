# Dependency security status — 2026-10-03

The previous zero-advisory claim is historical and no longer applies. The current full npm audit reports five high-severity affected package entries in one dependency chain: eslint-config-next -> @next/eslint-plugin-next -> fast-glob -> micromatch -> braces 3.0.3.

The root advisory is GHSA-vfj7-8cjw-p6xm / CVE-2026-93687: deeply nested brace patterns can exhaust recursive AST walkers and crash the Node process. GitHub Advisory Database, updated 2026-10-02, lists <=3.0.3 as affected and no patched release. Source: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm .

The lockfile identifies this chain as development tooling. The application does not accept browser-provided glob patterns or import this lint tool at runtime. That reduces production exposure but does not remove the vulnerable package or establish general exploit immunity. Dependency audit is not a complete application security review.

The full audit gate remains failing while the advisory exists. A separate production-only audit runs with --omit=dev and retains its own artifact; do not conflate its result with the full audit. No --force downgrade, test deletion, advisory allowlist, or fabricated clean report was used. In particular npm's proposed eslint-config-next 14.2.35 downgrade is not an appropriate automatic change for Next 16.

Do not process untrusted repositories/glob patterns using this installation. Use isolated disposable CI for repository-owned lint/test/build patterns. Monitor the upstream patched release and update the genuine lockfile with regression tests when available. Broad public launch requires this issue to be resolved or explicitly risk-accepted by the owner.
