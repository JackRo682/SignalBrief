/* Export only the actual overview Zod contract. Cross-field SQL/Zod checks remain authoritative. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const webRequire = createRequire(path.join(root, 'apps/web/package.json'));
const ts = webRequire('typescript');
const z = webRequire('zod');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const moduleObject = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const requireLocal = name => name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts')) : webRequire(name);
  vm.runInNewContext(source, { require: requireLocal, exports: moduleObject.exports, module: moduleObject, URL });
  cache.set(file, moduleObject.exports);
  return moduleObject.exports;
}
const { adminOverviewRequestSchema, adminOverviewResponseSchema } = load(path.join(root, 'apps/web/src/admin-logs/overview-contracts.ts'));
const responses = {
  200: { description: 'Validated current measurements; missing denominators and uninstrumented signup are null.', content: { 'application/json': { schema: { $ref: '#/components/schemas/AdminOverviewResponse' } } } },
};
for (const [code, description] of Object.entries({ 401: 'Missing, expired or revoked authentication.', 403: 'Administrator membership, MFA or account verification required.', 413: 'Body exceeds 4096 bytes.', 415: 'JSON required.', 422: 'Invalid dates, interval or settings.', 429: 'Rate limit; Retry-After is present.', 502: 'Invalid data-access response.', 503: 'Authentication, permission or metrics service unavailable.' })) responses[code] = { description };
const document = {
  openapi: '3.1.0',
  info: { title: 'SignalBrief Administrator Overview API', version: '1.0.0', description: 'One-page operational overview of existing consented activity and hourly API telemetry. No new tracking or consent changes.' },
  servers: [{ url: 'https://signalbrief.online' }],
  'x-zod-source': 'apps/web/src/admin-logs/overview-contracts.ts',
  'x-handler-source': 'apps/web/src/app/api/admin/overview/route.ts',
  paths: { '/api/admin/overview': { post: {
    operationId: 'readAdminOverview', summary: 'Read all operational metrics on the administrator page',
    description: 'Requires a verified live administrator session and MFA when enrolled. Dates are inclusive Asia/Seoul calendar days, maximum 90 days. API request aggregates cover at most 30 days and include administrators. Product data honors current consent and include_admin. Activation is current onboarding completion among newly created consented profiles in the selected period. Retention is exact-day, first-observed-view based; only complete return days are eligible. Session gaps are 30 minutes. Signup conversion is uninstrumented. Responses use private, no-store and Vary: Authorization. Safe audit metadata records the read.',
    security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/AdminOverviewRequest' } } } }, responses,
  } } },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: { AdminOverviewRequest: z.toJSONSchema(adminOverviewRequestSchema), AdminOverviewResponse: z.toJSONSchema(adminOverviewResponseSchema) },
  },
};
fs.writeFileSync(path.join(root, 'packages/shared/admin-overview.openapi.json'), JSON.stringify(document, null, 2) + '\n');
console.log('Exported administrator overview API contract.');
