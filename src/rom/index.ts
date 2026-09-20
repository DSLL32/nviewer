// Entry point: detect which supported game a ROM is and open it.
import { openAirBoarder64 } from './airboarder64';
import { openBanjoKazooie } from './banjo/banjo';
import { openBattleTanx } from './battletanx';
import { openBattleTanxGA } from './battletanxga';
import { openBomberman64 } from './bomberman/bm64';
import { openBomberman64SA } from './bomberman/bm64sa';
import { openBombermanHero } from './bomberman/bmhero';
import { openBugsLife } from './bugslife';
import { openCruisnUsa } from './cruisnusa/cruisnusa';
import { openGex3 } from './gex/gex3';
import { openGex64 } from './gex/gex64';
import { openGoldenEye } from './goldeneye/goldeneye';
import { openGlover } from './glover/glover';
import { openKirby64 } from './kirby64/kirby64';
import { openMarioKart64 } from './mk64/mk64';
import { openMarioParty } from './marioparty/marioparty';
import { openOffRoadChallenge } from './offroad/offroad';
import { openPilotwings } from './pilotwings/pilotwings';
import { openPokemonSnap } from './pokemonsnap/pokemonsnap';
import { openPerfectDark } from './perfectdark/perfectdark';
import { openYoshiStory } from './yoshi/yoshi';
import { LEVELS, loadLevel } from './level';
import { decodeRush2049Music, listRush2049Music } from './music/rush2049';
import { normalizeByteOrder, RushRom } from './rom';
import { openRush1 } from './rush1';
import { openStarFox64 } from './sf64/sf64';
import { openShadowsOfTheEmpire } from './shadows/shadows';
import { openSpiderMan } from './spiderman/spiderman';
import { openStuntRacer64 } from './stuntracer64/stuntracer64';
import { openTwine } from './twine/twine';
import { openVigilante8 } from './vigilante8/vigilante8';
import { openVigilante8SecondOffense } from './vigilante8_2/vigilante8_2';
import type { Game } from './types';
import { isZeldaAlpha, openZeldaAlpha } from './zelda/alpha';
import { findZeldaBuild } from './zelda/fs';
import { openZelda64 } from './zelda/zelda';

export type * from './types';

export function openRom(bytes: Uint8Array): Game {
  const rom = normalizeByteOrder(bytes);
  const code = String.fromCharCode(...rom.subarray(0x3b, 0x3f));
  // The Ocarina of Time prototype on an F-Zero X cartridge: by the whole file's hash, before any other detection.
  if (isZeldaAlpha(rom)) return openZeldaAlpha(rom);
  switch (code) {
    case 'NABJ':
    case 'NABP':
      return openAirBoarder64(rom);
    case 'NRUE': {
      const r = new RushRom(rom);
      return {
        id: 'rush2049',
        title: 'San Francisco Rush 2049',
        levels: LEVELS,
        loadLevel: (i) => loadLevel(r, i),
        music: listRush2049Music(r),
        decodeMusic: (i) => decodeRush2049Music(r, i),
      };
    }
    case 'NSFE':
      return openRush1(rom);
    case 'NBME':
      return openBomberman64(rom);
    case 'NBDE':
      return openBombermanHero(rom);
    case 'NBVE':
      return openBomberman64SA(rom);
    case 'NBYE':
    case 'NBYP':
    case 'NBYF':
    case 'NBYD':
    case 'NBYI':
      return openBugsLife(rom);
    case 'NBKE':
      if (rom[0x3f] !== 0) throw new Error(`Banjo-Kazooie (U) V1.${rom[0x3f]} is not supported: only the V1.0 ROM (revision 0) is.`);
      return openBanjoKazooie(rom);
    case 'NBKP':
    case 'NBKJ':
      throw new Error(`Banjo-Kazooie (${code === 'NBKP' ? 'E' : 'J'}) is not supported: only Banjo-Kazooie (U) (V1.0) is.`);
    case 'NBXE':
      return openBattleTanx(rom);
    case 'NCUE':
      if (rom[0x3f] !== 0) throw new Error(`Cruis'n USA (U) revision ${rom[0x3f]} is not supported: only revision 0 is.`);
      return openCruisnUsa(rom);
    case 'NCUP':
      throw new Error("Cruis'n USA (E) is not supported: only Cruis'n USA (U) revision 0 is.");
    case 'NBQE':
      return openBattleTanxGA(rom);
    case 'NX2E':
      return openGex64(rom);
    case 'NX3E':
      return openGex3(rom);
    case 'NYSJ':
      return openYoshiStory(rom);
    case 'NFXE':
      return openStarFox64(rom);
    case 'NGEE':
      return openGoldenEye(rom);
    case 'NGVE':
      if (rom[0x3f] !== 0) throw new Error(`Glover (U) revision ${rom[0x3f]} is not supported: only revision 0 is.`);
      return openGlover(rom);
    case 'NGVP':
      throw new Error('Glover (E) is not supported: only Glover (U) revision 0 is.');
    case 'NK4E':
      if (rom[0x3f] !== 0) throw new Error(`Kirby 64: The Crystal Shards (U) revision ${rom[0x3f]} is not supported: only revision 0 is.`);
      return openKirby64(rom);
    case 'NKTE':
      if (rom[0x3f] !== 0) throw new Error(`Mario Kart 64 (U) V1.${rom[0x3f]} is not supported: only the V1.0 ROM (revision 0) is.`);
      return openMarioKart64(rom);
    case 'NKTP':
    case 'NKTJ':
      throw new Error(`Mario Kart 64 (${code === 'NKTP' ? 'E' : 'J'}) is not supported: only Mario Kart 64 (U) (V1.0) is.`);
    case 'CLBJ':
      if (rom[0x3f] !== 0) throw new Error(`Mario Party (J) revision ${rom[0x3f]} is not supported: only revision 0 is.`);
      return openMarioParty(rom);
    case 'CLBE':
    case 'NLBP':
      throw new Error(`Mario Party (${code === 'CLBE' ? 'U' : 'E'}) is not supported: only Mario Party (J) revision 0 is.`);
    case 'NOFE':
    case 'NOFP':
      return openOffRoadChallenge(rom);
    case 'NPFE':
      return openPokemonSnap(rom);
    case 'NPFJ':
    case 'NPFP':
    case 'NPFF':
    case 'NPFD':
    case 'NPFI':
    case 'NPFS':
    case 'NPFU':
    case 'NPHE':
      throw new Error(`Pokémon Snap (${code}) is not supported: only Pokémon Snap (U) is currently supported.`);
    case 'NPWE':
    case 'NPWP':
    case 'NPWJ':
      return openPilotwings(rom);
    case 'NSLE':
      return openSpiderMan(rom);
    case 'NR3E':
      if (rom[0x3f] !== 0) throw new Error(`Stunt Racer 64 (U) revision ${rom[0x3f]} is not supported: only revision 0 is.`);
      return openStuntRacer64(rom);
    case 'NV8E':
      if (rom[0x3f] !== 0) throw new Error(`Vigilante 8 (U) revision ${rom[0x3f]} is not supported: only revision 0 is.`);
      return openVigilante8(rom);
    case 'NVGE':
      if (rom[0x3f] !== 0) throw new Error(`Vigilante 8: 2nd Offense (U) revision ${rom[0x3f]} is not supported: only revision 0 is.`);
      return openVigilante8SecondOffense(rom);
    case 'NSWE':
    case 'NSWP':
      return openShadowsOfTheEmpire(rom);
    case 'NO7E':
    case 'NO7P':
      return openTwine(rom);
    case 'NPDE':
      if (rom[0x3f] !== 0) throw new Error(`Perfect Dark (U) V1.${rom[0x3f]} is not supported: only the V1.0 ROM (revision 0) is.`);
      return openPerfectDark(rom);
    case 'NPDP':
    case 'NPDJ':
      throw new Error(`Perfect Dark (${code === 'NPDP' ? 'E' : 'J'}) is not supported: only Perfect Dark (U) (V1.0) is.`);
    default: {
      // Zelda 64 (Ocarina of Time, Majora's Mask; retail and debug builds): by structure, not by game code.
      const zelda = findZeldaBuild(rom);
      if (zelda) return openZelda64(rom, zelda);
      throw new Error(`Unsupported ROM (game code "${code.replace(/[^\x20-\x7e]/g, '?')}"). ` +
        'Supported: San Francisco Rush 2049 (U), San Francisco Rush: Extreme Racing (U), Bomberman 64 (U), ' +
        'Bomberman 64: The Second Attack! (U), Bomberman Hero (U), BattleTanx (U), BattleTanx: Global Assault (U), ' +
        "Cruis'n USA (U) (revision 0), " +
        'Gex 64: Enter the Gecko (U), Gex 3: Deep Cover Gecko (U), Yoshi\'s Story (J), Star Fox 64 (U), GoldenEye 007 (U), ' +
        'Glover (U) (revision 0), ' +
        'Kirby 64: The Crystal Shards (U) (revision 0), ' +
        `A Bug's Life (U/E/F/G/I), ` +
        'Air Boarder 64 (J/E), ' +
        'Banjo-Kazooie (U) (V1.0), ' +
        'Off Road Challenge (U/E), ' +
        'Pokémon Snap (U), ' +
        'Mario Kart 64 (U) (V1.0), ' +
        'Mario Party (J) (revision 0), ' +
        'Pilotwings 64 (U/E/J), Spider-Man (U), Stunt Racer 64 (U) (revision 0), Vigilante 8 (U) (revision 0), Vigilante 8: 2nd Offense (U) (revision 0), Star Wars: Shadows of the Empire (U V1.0–V1.2/E), ' +
        'The World Is Not Enough (U/E), Perfect Dark (U) (V1.0), ' +
        'The Legend of Zelda: Ocarina of Time and Majora\'s Mask.');
    }
  }
}
