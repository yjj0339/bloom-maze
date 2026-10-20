import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const opts = {
  entryPoints: ['src/main.js'],
  bundle: true,
  outfile: 'bundle.js',
  format: 'iife',
  target: ['es2020'],
  minify: !watch,
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
};

if (watch) await esbuild.context(opts).then((c) => c.watch());
else await esbuild.build(opts);
