import { defineConfig } from 'vitepress';

const pagesBase = (process.env.NVIEWER_PAGES_BASE ?? '').replace(/\/$/, '');
const viewerUrl = process.env.NVIEWER_VIEWER_URL ?? 'http://localhost:5173/';

export default defineConfig({
  title: 'nviewer docs',
  description: 'Nintendo 64 ROM format specifications for nviewer',
  base: `${pagesBase}/wiki/`,
  outDir: '../dist/wiki',
  srcExclude: ['SPECIFICATION_STYLE.md'],
  // Binary-layout diagrams use colspan, which Markdown tables cannot express.
  markdown: { html: true },
  themeConfig: {
    nav: [
      { text: 'Docs', link: '/' },
      { text: 'Viewer', link: viewerUrl },
    ],
    sidebar: [
      {
        text: 'Games',
        items: [
          { text: 'Air Boarder 64', link: '/AIRBOARDER64' },
          { text: 'BattleTanx', link: '/BATTLETANX' },
          { text: 'BattleTanx: Global Assault', link: '/BATTLETANX_GLOBAL_ASSAULT' },
          { text: 'Bomberman 64', link: '/BOMBERMAN64' },
          { text: 'Bomberman 64: The Second Attack!', link: '/BOMBERMAN64_SECOND_ATTACK' },
          { text: 'Bomberman Hero', link: '/BOMBERMAN_HERO' },
          { text: "A Bug's Life", link: '/BUGSLIFE' },
          { text: 'Gex 3: Deep Cover Gecko', link: '/GEX3' },
          { text: 'Gex 64: Enter the Gecko', link: '/GEX64' },
          { text: 'GoldenEye 007', link: '/GOLDENEYE' },
          { text: 'Mario Kart 64', link: '/MARIOKART64' },
          { text: 'Off Road Challenge', link: '/OFFROADCHALLENGE' },
          { text: 'Perfect Dark', link: '/PERFECTDARK' },
          { text: 'Pilotwings 64', link: '/PILOTWINGS64' },
          { text: 'Pokémon Snap', link: '/POKEMONSNAP' },
          { text: 'San Francisco Rush: Extreme Racing', link: '/SAN_FRANCISCO_RUSH' },
          { text: 'San Francisco Rush 2049', link: '/SAN_FRANCISCO_RUSH_2049' },
          { text: 'Spider-Man', link: '/SPIDERMAN' },
          { text: 'Star Wars: Shadows of the Empire', link: '/SHADOWS_OF_THE_EMPIRE' },
          { text: '007: The World Is Not Enough', link: '/WORLDISNOTENOUGH' },
          { text: 'Star Fox 64', link: '/STARFOX' },
          { text: 'Stunt Racer 64', link: '/STUNTRACER64' },
          { text: "Yoshi's Story", link: '/YOSHISTORY' },
          { text: "The Legend of Zelda: Majora's Mask", link: '/MAJORAS_MASK' },
          { text: 'The Legend of Zelda: Ocarina of Time', link: '/OCARINA_OF_TIME' },
          { text: 'Ocarina of Time — 1997 prototype', link: '/OCARINA_OF_TIME_1997_PROTOTYPE' },
        ],
      },
      {
        text: 'Compression',
        items: [
          { text: 'Formats', link: '/compression/' },
          { text: 'MIO0', link: '/compression/mio0' },
          { text: 'Yaz0', link: '/compression/yaz0' },
          { text: 'Yay0', link: '/compression/yay0' },
          { text: 'Hudson LZSS', link: '/compression/hudson-lzss' },
          { text: 'Raw DEFLATE and Rare wrappers', link: '/compression/raw-deflate' },
          { text: 'Chunked zlib', link: '/compression/chunked-zlib' },
          { text: 'Rush LZSS', link: '/compression/rush-lzss' },
          { text: 'LZARI', link: '/compression/lzari' },
          { text: 'RNC', link: '/compression/rnc' },
          { text: 'Air Boarder LH5', link: '/compression/airboarder-lh5' },
          { text: 'CMPR / SMSR00', link: '/compression/smsr' },
          { text: 'VPK0', link: '/compression/vpk0' },
          { text: 'ERZ2', link: '/compression/erz2' },
          { text: 'EDL', link: '/compression/edl' },
          { text: 'Shadows LZHUF', link: '/compression/shadows-lzhuf' },
          { text: 'Shadows LZSS', link: '/compression/shadows-lzss' },
          { text: 'Shared match search', link: '/compression/common' },
        ],
      },
    ],
    search: { provider: 'local' },
    outline: 'deep',
    editLink: {
      pattern: 'https://github.com/DSLL32/nviewer/edit/master/docs/:path',
      text: 'Edit this page on GitHub',
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/DSLL32/nviewer' }],
  },
});
