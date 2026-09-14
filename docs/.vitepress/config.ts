import { defineConfig } from 'vitepress';

const pagesBase = (process.env.NVIEWER_PAGES_BASE ?? '').replace(/\/$/, '');
const viewerUrl = process.env.NVIEWER_VIEWER_URL ?? 'http://localhost:5173/';

export default defineConfig({
  title: 'nviewer game specifications',
  description: 'Nintendo 64 ROM format specifications for nviewer',
  base: `${pagesBase}/wiki/`,
  outDir: '../dist/wiki',
  // These are plain technical Markdown documents. Angle-bracket placeholders
  // such as <rom> must remain text rather than being parsed as Vue components.
  markdown: { html: false },
  themeConfig: {
    nav: [
      { text: 'Specifications', link: '/' },
      { text: 'Viewer', link: viewerUrl },
    ],
    sidebar: [
      {
        text: 'Game specifications',
        items: [
          { text: 'Air Boarder 64', link: '/AIRBOARDER64' },
          { text: 'BattleTanx', link: '/BATTLETANX' },
          { text: 'Bomberman', link: '/BOMBERMAN' },
          { text: "A Bug's Life", link: '/BUGSLIFE' },
          { text: 'Gex', link: '/GEX' },
          { text: 'GoldenEye 007', link: '/GOLDENEYE' },
          { text: 'Off Road Challenge', link: '/OFFROADCHALLENGE' },
          { text: 'Perfect Dark', link: '/PERFECTDARK' },
          { text: 'Pilotwings 64', link: '/PILOTWINGS64' },
          { text: 'Pokémon Snap', link: '/POKEMONSNAP' },
          { text: 'Spider-Man', link: '/SPIDERMAN' },
          { text: 'Star Fox 64', link: '/STARFOX' },
          { text: 'Stunt Racer 64', link: '/STUNTRACER64' },
          { text: "Yoshi's Story", link: '/YOSHISTORY' },
          { text: 'The Legend of Zelda', link: '/ZELDA64' },
        ],
      },
    ],
    search: { provider: 'local' },
    outline: 'deep',
    editLink: {
      pattern: 'https://github.com/DSLL32/nviewer/edit/master/docs/:path',
      text: 'Edit this specification on GitHub',
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/DSLL32/nviewer' }],
  },
});
