import esbuild from 'esbuild';
import process from 'process';

const dev = process.argv.includes('--dev');

await Promise.all([
  esbuild.build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    platform: 'node',
    external: ['obsidian', 'electron'],
    outfile: 'main.js',
    format: 'cjs',
    target: 'es2022',
    logLevel: 'info',
    sourcemap: dev ? 'inline' : false,
    minify: !dev
  }),
  esbuild.build({
    entryPoints: ['src/standalone.ts'],
    bundle: true,
    platform: 'node',
    outfile: 'service.js',
    format: 'cjs',
    target: 'es2022',
    logLevel: 'info',
    sourcemap: false,
    minify: !dev
  })
]);
