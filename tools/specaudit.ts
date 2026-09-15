import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const docsDir = path.resolve('docs');
const excluded = new Set(['index.md', 'SPECIFICATION_STYLE.md']);
const requiredSections = [
  '## 1. Overview',
  '## 2. Program and storage architecture',
  '## 3. Level data',
  '## 4. Objects',
  '## 5. Audio',
  '## 6. Unused and hidden content',
  '## 7. nviewer implementation',
  '## 8. Verification and remaining work',
];
const requiredOverview = [
  '### 1.1 Technical summary',
  '### 1.2 ROM identification',
  '### 1.3 Terminology and conventions',
];
const requiredSubsections = [
  '### 2.1 Boot and executable layout',
  '### 2.2 Memory and address mapping',
  '### 2.3 ROM map and asset organization',
  '### 2.4 Compression formats',
  '### 2.5 Loading process',
  '### 2.6 Revision differences',
  '### 3.1 Level catalog and identifiers',
  '### 3.2 Level container',
  '### 3.3 Geometry',
  '### 3.4 Display lists and render state',
  '### 3.5 Textures and materials',
  '### 3.6 Collision',
  '### 3.7 Environment, sky, fog, and lighting',
  '### 3.8 Cameras and paths',
  '### 4.1 Placement records',
  '### 4.2 Object and model formats',
  '### 4.3 Skeletons and animation',
  '### 4.4 Behaviors, triggers, and scripted objects',
  '### 5.1 Audio storage and banks',
  '### 5.2 Sequence format and driver',
  '### 5.3 Instruments and sample encoding',
  '### 5.4 Music catalog and loop points',
  '### 6.1 Unreferenced assets',
  '### 6.2 Cut or inaccessible levels',
  '### 6.3 Debug features',
  '### 6.4 Prototype or revision-specific content',
  '### 7.1 Module mapping',
  '### 7.2 Supported features',
  '### 7.3 Approximations and omissions',
  '### 8.1 Verification evidence',
  '### 8.2 Known unknowns',
  '### 8.3 References',
];
const summaryProperties = [
  'Asset organization',
  'Compression',
  'Graphics microcode',
  'Geometry',
  'Textures',
  'Collision',
  'Music driver',
  'Audio microcode',
  'Sample encoding',
  'Levels',
  'Memory requirement',
  'Viewer support',
];
const identificationHeader =
  '| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |';
const inheritedHeadingPrefixes = [
  'Filesystem and compression:',
  'Level geometry:',
  'Mapping onto the viewer:',
  'Music:',
  'Unused and hidden content:',
  'Verification evidence and open questions:',
];
const boilerplate = [
  'Geometry representation is described above.',
  'The complete known song catalog and loop policy are included above.',
  'Candidate levels are distinguished from shipped content above.',
];

let failures = 0;
const files = (await readdir(docsDir))
  .filter((file) => file.endsWith('.md') && !excluded.has(file))
  .sort();

for (const file of files) {
  const text = await readFile(path.join(docsDir, file), 'utf8');
  const problems: string[] = [];
  const titleCount = text.match(/^# /gm)?.length ?? 0;
  if (titleCount !== 1) problems.push(`expected one H1, found ${titleCount}`);
  if (!/^# .+ — Nintendo 64 ROM format specification$/m.test(text)) {
    problems.push('nonstandard H1');
  }
  const headings = [...requiredSections, ...requiredOverview, ...requiredSubsections];
  for (const heading of headings) {
    if (!text.includes(`${heading}\n`)) problems.push(`missing ${heading}`);
  }
  const ordered = [...requiredSections, ...requiredOverview, ...requiredSubsections]
    .map((heading) => ({ heading, offset: text.indexOf(`${heading}\n`) }))
    .filter(({ offset }) => offset >= 0)
    .sort((a, b) => a.offset - b.offset);
  const expectedOrder = [
    requiredSections[0], ...requiredOverview,
    requiredSections[1], ...requiredSubsections.slice(0, 6),
    requiredSections[2], ...requiredSubsections.slice(6, 14),
    requiredSections[3], ...requiredSubsections.slice(14, 18),
    requiredSections[4], ...requiredSubsections.slice(18, 22),
    requiredSections[5], ...requiredSubsections.slice(22, 26),
    requiredSections[6], ...requiredSubsections.slice(26, 29),
    requiredSections[7], ...requiredSubsections.slice(29),
  ];
  if (ordered.map(({ heading }) => heading).join('\n') !== expectedOrder.join('\n')) {
    problems.push('canonical sections are out of order');
  }

  const summaryStart = text.indexOf('### 1.1 Technical summary\n');
  const identificationStart = text.indexOf('### 1.2 ROM identification\n');
  if (summaryStart >= 0 && identificationStart > summaryStart) {
    const summary = text.slice(summaryStart, identificationStart);
    const properties = [...summary.matchAll(/^\|\s*([^|]+?)\s*\|/gm)]
      .map((match) => match[1].trim())
      .slice(2, 2 + summaryProperties.length);
    if (properties.join('\n') !== summaryProperties.join('\n')) {
      problems.push('nonstandard technical-summary properties or order');
    }
    const summaryValues = new Map(
      [...summary.matchAll(/^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|$/gm)]
        .map((match) => [match[1].trim(), match[2].trim()] as const),
    );
    const audioValues = ['Music driver', 'Audio microcode', 'Sample encoding']
      .map((property) => [property, summaryValues.get(property)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined);
    for (let left = 0; left < audioValues.length; left++) {
      for (let right = left + 1; right < audioValues.length; right++) {
        if (audioValues[left][1] === audioValues[right][1]) {
          problems.push(`duplicate ${audioValues[left][0]} and ${audioValues[right][0]} summaries`);
        }
      }
    }
    if (/^\|\s*Byte order\s*\|/im.test(summary)) {
      problems.push('byte order belongs with the affected format, not the technical summary');
    }
  }
  if (!text.includes(identificationHeader)) problems.push('nonstandard ROM identification columns');
  if (identificationStart >= 0) {
    const identificationEnd = text.indexOf('### 1.3 Terminology and conventions\n', identificationStart);
    const identification = text.slice(identificationStart, identificationEnd < 0 ? undefined : identificationEnd);
    if (/\b(?:MD5|md5sum)\b/.test(identification)) problems.push('MD5 in ROM identification');
    for (const line of identification.split('\n').filter((candidate) => /^\|/.test(candidate)).slice(2)) {
      const columns = line.slice(1, -1).split('|').map((column) => column.trim());
      if (columns.length !== 10) {
        problems.push(`ROM identification row has ${columns.length} columns`);
        continue;
      }
      const plain = (value: string) => value.replace(/`/g, '');
      if (!/^[0-9A-F]{8}$/.test(plain(columns[5]))) problems.push(`invalid CRC1 ${columns[5]}`);
      if (!/^[0-9A-F]{8}$/.test(plain(columns[6]))) problems.push(`invalid CRC2 ${columns[6]}`);
      if (!/^[0-9a-f]{40}$/.test(plain(columns[7]))) problems.push(`invalid SHA-1 ${columns[7]}`);
    }
  }
  if (/\bV-(?:ROM|TOOL|ASM|RAM|FRAME|AUDIO|REPO|EMU|SOURCE|MANUAL)\b/i.test(text)) {
    problems.push('opaque evidence label');
  }
  if (/§§?\d/.test(text)) problems.push('stale numeric section reference');
  if (/\/home\/n64\/\.ai-tmp\/|research archive\//.test(text)) problems.push('published scratch path');
  if (/^#{2,4} .*Research.process|^#{2,4} .*Process and artifact hygiene|^#{2,4} .*Emulator and process hygiene/im.test(text)) {
    problems.push('published research-process section');
  }
  let parentTitle = '';
  let parentNumber = '';
  for (const line of text.split('\n')) {
    const parent = /^### (\d+\.\d+) (.+)$/.exec(line);
    if (parent) {
      parentNumber = parent[1];
      parentTitle = parent[2].trim().toLowerCase();
      continue;
    }
    const child = /^#### (.+)$/.exec(line);
    if (!child) continue;
    const heading = child[1].trim();
    const normalized = heading.replace(/\s*\([^)]*\)\s*$/, '').toLowerCase();
    if (
      normalized === parentTitle
      || (normalized === 'music' && parentNumber.startsWith('5.'))
      || ((normalized === 'unused and hidden content' || normalized === 'unused or hidden content')
        && parentNumber.startsWith('6.'))
    ) {
      problems.push(`redundant subheading ${heading}`);
    }
    if (inheritedHeadingPrefixes.some((prefix) => heading.startsWith(prefix))) {
      problems.push(`subheading repeats its former parent: ${heading}`);
    }
  }
  for (const sentence of boilerplate) {
    if (text.includes(sentence)) problems.push(`generic navigation prose: ${sentence}`);
  }
  if (problems.length) {
    failures++;
    console.error(`${file}:`);
    for (const problem of problems) console.error(`  - ${problem}`);
  }
}

if (failures) {
  console.error(`\n${failures} specification${failures === 1 ? '' : 's'} failed.`);
  process.exitCode = 1;
} else {
  console.log(`${files.length} specifications conform to docs/SPECIFICATION_STYLE.md.`);
}
