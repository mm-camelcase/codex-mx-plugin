import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
const sourceFiles = ['packages/domain/model.js', 'packages/keypad-model/keys.js', 'public/demo.js', 'public/app.js'];
const sources = await Promise.all(sourceFiles.map(file => readFile(new URL(file, root), 'utf8')));
const script = sources.map(source => source.replace(/^import .*;\n/gm, '').replace(/^export /gm, '')).join('\n\n');
const check = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: script, encoding: 'utf8' });
if (check.status !== 0) throw new Error(check.stderr || 'Bundled script failed syntax validation.');
const css = await readFile(new URL('public/styles.css', root), 'utf8');
let html = await readFile(new URL('public/index.html', root), 'utf8');
html = html.replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="app.js"></script>', () => `<script type="module">\n${script}\n</script>`);
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/index.html', root), html);
console.log(`Built dist/index.html (${Math.round(Buffer.byteLength(html) / 1024)} KB). Standalone, sample data only.`);
