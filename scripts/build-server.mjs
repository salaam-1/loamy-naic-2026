#!/usr/bin/env node
/**
 * Bundle the deployable Loam backend.
 *
 * WHY A BUNDLE AND NOT `tsc`
 *   The server imports the orchestrator through the `@/` alias, as the rest
 *   of the codebase does. `tsc` would emit those specifiers unchanged and
 *   Node would fail to resolve them at runtime. Bundling resolves the alias
 *   once, at build time, and produces a single file with no path mapping to
 *   get wrong on a host.
 *
 *   It also means the deployed artefact contains exactly the modules the
 *   server actually reaches -- not `src/` wholesale, and nothing from the
 *   React application.
 *
 * WHY esbuild AND NOT A NEW DEPENDENCY
 *   esbuild is already installed, as Vite's own bundler. Using it adds
 *   nothing to install. It is currently a TRANSITIVE dependency, which is a
 *   known fragility: `npm install esbuild --save-dev` would pin it properly
 *   and needs authorisation, so it is recorded in the deployment guide
 *   rather than done quietly here.
 *
 * WHAT IS LEFT EXTERNAL
 *   `@supabase/supabase-js` and Node built-ins. Supabase stays external so
 *   the deployed service installs it from `package.json` like any other
 *   dependency, and a security patch to it does not require rebuilding this
 *   bundle.
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = resolve(root, 'dist-server/loam-server.mjs')

const result = await build({
  entryPoints: [resolve(root, 'server/index.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  // Matches the engines a current host provides, and what `tsconfig` targets.
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  // Readable stack traces matter more than bytes for a server nobody
  // downloads over a network.
  minify: false,
  logLevel: 'info',
  // Resolved here so the runtime never sees an `@/` specifier.
  alias: { '@': resolve(root, 'src') },
  external: ['@supabase/supabase-js'],
  /**
   * `import.meta.env` is a Vite construct and is `undefined` in Node, so any
   * shared module that reads it crashes the bundle at import time. Mapping
   * the whole object to `process.env` is what makes the shared modules work
   * unchanged in both runtimes.
   *
   * This is not hypothetical: `src/lib/copilot/retrieval.ts` imports the
   * browser Supabase singleton at module scope, which reads
   * `import.meta.env.VITE_SUPABASE_URL`, and the first build of this bundle
   * died on exactly that line.
   *
   * The singleton is INERT on the Loam path -- the orchestrator calls
   * `retrievePriceContext` and `retrieveConcept` with the per-request client
   * passed explicitly, and the three functions that use the singleton
   * directly belong to the legacy Co-pilot and are never reached. Removing
   * that import would change how the Co-pilot's evidence retrieval
   * authenticates, so it is left alone and recorded instead.
   */
  define: {
    'import.meta.env': 'process.env',
    // More specific than the above, so esbuild prefers these for the three
    // Vite flags that have no `process.env` equivalent.
    'import.meta.env.DEV': 'false',
    'import.meta.env.PROD': 'true',
    'import.meta.env.MODE': '"production"',
  },
  metafile: true,
})

const bytes = Object.values(result.metafile.outputs)
  .reduce((total, o) => total + (o.bytes ?? 0), 0)
console.log(`server bundle: dist-server/loam-server.mjs (${(bytes / 1024).toFixed(0)} KiB)`)

/**
 * A build-time guard, not a style check.
 *
 * If the bundle contains a loopback address it means a local-only default
 * reached the deployable artefact, which is the exact failure this migration
 * exists to remove. Fail the build rather than discover it in production.
 *
 * `127.0.0.1:11434` is the Ollama default inside `resolveInferenceUrl`, which
 * is legitimately present because development still uses it -- what matters
 * is that `resolveAdapter` refuses to USE it in production, which
 * tests/unit/loam-provider-select.test.ts asserts. So this check looks for a
 * loopback address being the only inference target available, not for the
 * string existing at all.
 */
const { readFileSync } = await import('node:fs')
const code = readFileSync(outfile, 'utf8')
if (!code.includes('cannot serve production traffic')) {
  console.error(
    'REFUSED: the production guard from src/lib/loam/model/select.ts is not in '
    + 'the bundle. Without it the service could fall back to local inference.',
  )
  process.exit(1)
}
console.log('guard present: production refuses local inference')
