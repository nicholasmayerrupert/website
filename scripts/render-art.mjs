// Dev-only helper: bundles render-entry.jsx for node and runs it.
import { build } from 'esbuild';
import { spawnSync } from 'child_process';

await build({
  entryPoints: ['scripts/render-entry.jsx'],
  bundle: true,
  outfile: 'scripts/.render-art.cjs',
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  external: ['react', 'react-dom', 'sharp'],
});

const res = spawnSync(process.execPath, ['scripts/.render-art.cjs'], { stdio: 'inherit' });
process.exit(res.status ?? 0);
