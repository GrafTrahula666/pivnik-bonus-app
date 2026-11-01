import { build } from 'esbuild';
await build({ entryPoints: ['public/app.js'], outfile: 'public/app.bundle.js', bundle: true, minify: true, target: ['safari16', 'chrome110'], legalComments: 'eof' });
