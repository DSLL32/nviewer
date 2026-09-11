// Bundle the viewer into one self-contained HTML file that runs from the filesystem (no server, no sibling files):
//   npm run build:single   ->   dist/nviewer.html
//
// Vite builds the app in memory (no separate files), with every asset inlined and the parser worker embedded through
// `?worker&inline`. The script and the stylesheet are then written into the HTML itself. The worker is compiled as a
// classic script: a file:// page may start a blob worker, but not a module one.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Rollup } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const outFile = path.join(root, 'dist', 'nviewer.html');

const result = await build({
  configFile: false, // the project config's dev-only report endpoint has nothing to do with this build
  root,
  base: './',
  logLevel: 'warn',
  define: { __NVIEWER_BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  // Classic worker: a blob module worker does not start from a file:// page.
  worker: { format: 'iife' },
  build: {
    write: false,
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER, // images and fonts as data URIs
    modulePreload: { polyfill: false },
  },
});

const outputs = (Array.isArray(result) ? result : [result as Rollup.RollupOutput]).flatMap((r) => r.output);
const html = outputs.find((o) => o.type === 'asset' && o.fileName.endsWith('.html'));
const scripts = outputs.filter((o) => o.type === 'chunk');
const styles = outputs.filter((o) => o.type === 'asset' && o.fileName.endsWith('.css'));
const others = outputs.filter((o) => o !== html && !scripts.includes(o as never) && !styles.includes(o as never));
if (!html || html.type !== 'asset') throw new Error('the build produced no HTML');
if (scripts.length !== 1) throw new Error(`expected one script chunk, got ${scripts.length}: ${scripts.map((s) => s.fileName).join(', ')}`);
if (others.length > 0) throw new Error(`these files would have to sit next to the HTML: ${others.map((o) => o.fileName).join(', ')}`);

// Inline text inside a <script> or <style> element must not contain the element's end tag.
const inlineSafe = (code: string) => code.replace(/<\/(script|style)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

let page = String(html.source);
const quote = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const scriptTag = new RegExp(`<script[^>]*src="[^"]*${quote(scripts[0].fileName)}"[^>]*></script>`, 'g');
if (!scriptTag.test(page)) throw new Error(`could not find the script tag for ${scripts[0].fileName}`);
scriptTag.lastIndex = 0;
const inlineScript = `<script type="module">\n${inlineSafe(scripts[0].code)}\n</script>`;
let scriptsInlined = 0;
page = page.replace(scriptTag, () => (scriptsInlined++ === 0 ? inlineScript : '')); // the code goes in once
for (const style of styles) {
  const linkTag = new RegExp(`<link[^>]*href="[^"]*${quote(style.fileName)}"[^>]*>`, 'g');
  if (!linkTag.test(page)) throw new Error(`could not find the stylesheet link for ${style.fileName}`);
  linkTag.lastIndex = 0;
  const inlineStyle = `<style>\n${inlineSafe(String((style as Rollup.OutputAsset).source))}\n</style>`;
  let stylesInlined = 0;
  page = page.replace(linkTag, () => (stylesInlined++ === 0 ? inlineStyle : ''));
}
if (/\ssrc="(?!data:)/.test(page) || /\shref="(?!data:|#)/.test(page)) {
  throw new Error(`the page still refers to a file outside itself:\n${page.match(/<[^>]*(src|href)="[^"]*"[^>]*>/g)?.join('\n')}`);
}

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, page);
console.log(`${path.relative(root, outFile)}  ${(Buffer.byteLength(page) / 1048576).toFixed(2)} MB (open it from the filesystem, no server needed)`);
