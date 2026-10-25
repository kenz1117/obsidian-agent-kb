import esbuild from 'esbuild';
import process from 'process';

const dev = process.argv.includes('--dev');

await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron'],
  outfile: 'main.js',
  format: 'cjs',
  target: 'es2022',
  logLevel: 'info',
  sourcemap: dev ? 'inline' : false,
  minify: !dev
});
