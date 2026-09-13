// Air Boarder 64 uses the same early Software Creations libmus revision as Gex 64.
// The J and PAL sequence/bank bytes are identical; PAL shifts them by 0x940 and
// advances the player at 50 rather than 60 video interrupts per second.
import type { DecodedMusic, MusicTrack } from '../types';
import { decodeLibmus64Music, type Libmus64Profile, type Libmus64SongDef } from '../music/libmus64';

const NAMES = [
  'Front-end music 1',
  'Tutorial / Giant House',
  'Sunset Island',
  'Green Park (1 Player)',
  'Front-end music 2',
  'Green Park (2 Players)',
  'Lost Forest',
  "Snow Festival '64",
];

const J_STARTS = [0xa4750, 0xa5510, 0xa6be0, 0xa9810, 0xabb90, 0xae8e0, 0xb10e0, 0xb2af0];
const J_END = 0xb5b00;

interface RegionProfile {
  delta: number;
  pointerBank: number;
  waveBank: number;
  player: Libmus64Profile;
}

const REGIONS: Record<'J' | 'P', RegionProfile> = {
  J: {
    delta: 0,
    pointerBank: 0xb5b00,
    waveBank: 0xc29a0,
    player: {
      outputRate: 32000,
      vsyncs: 60,
      eqpowerRom: 0x28340,
      maxVoices: 24,
      masterSongVolume: 0x3fff,
      playbackGain: 2.25,
    },
  },
  P: {
    delta: 0x940,
    pointerBank: 0xb6440,
    waveBank: 0xc32e0,
    player: {
      outputRate: 32000,
      vsyncs: 50,
      eqpowerRom: 0x282f0,
      maxVoices: 16,
      masterSongVolume: 0x3fff,
      playbackGain: 2.25,
    },
  },
};

function regionProfile(rom: Uint8Array): RegionProfile {
  const country = String.fromCharCode(rom[0x3e]);
  if (country !== 'J' && country !== 'P') throw new Error(`unsupported Air Boarder 64 music region ${country}`);
  return REGIONS[country];
}

function songDefs(region: RegionProfile): Libmus64SongDef[] {
  return J_STARTS.map((start, index) => ({
    start: start + region.delta,
    end: (J_STARTS[index + 1] ?? J_END) + region.delta,
    compressed: false,
    bank: region.pointerBank,
    samples: region.waveBank,
    // The game explicitly sets 112 for gameplay. Its front-end starts retain the
    // player's default handle volume of 128.
    volume: index === 0 || index === 4 ? 128 : 112,
  }));
}

export function airBoarderMusic(rom: Uint8Array): { tracks: MusicTrack[]; decode(index: number): DecodedMusic } {
  const region = regionProfile(rom);
  const defs = songDefs(region);
  const tracks = NAMES.map((name, index) => ({ index, name: `${String(index).padStart(2, '0')} ${name}` }));
  return {
    tracks,
    decode(index: number) {
      const def = defs[index];
      if (!def) throw new Error(`No Air Boarder 64 music track ${index}`);
      return decodeLibmus64Music(rom, def, region.player);
    },
  };
}
