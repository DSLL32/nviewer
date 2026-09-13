// Off Road Challenge's sky is a camera-scrolled screen panorama, not a 3D
// skybox. Each raw file holds three upper CI4 panels followed by one lower
// panel, with separate 16-colour RGBA16 palettes.
import type { PanoramaSky, Texture } from '../types';
import type { AssetFile, OffroadRom } from './fs';

const SKY_IDS = [22, 13, 32, 6, 30, 2, 23, 1, 24, 40, 20, 33] as const;
const SKY_NAMES = [
  'Blue 1', 'Blue 2', 'Blue 3',
  'Stormy 1', 'Stormy 2',
  'Dusk 1', 'Dusk 2', 'Dusk 3', 'Dusk 4',
  'Mode 5 Blue', 'Mode 5 Stormy', 'Mode 5 Dusk',
] as const;
const SKY_TINTS: readonly [number, number, number][] = [
  [255, 255, 255], [255, 255, 255], [220, 220, 255],
  [160, 160, 190], [160, 160, 190],
  [245, 225, 200], [245, 225, 200], [245, 225, 225], [245, 225, 225],
  [255, 255, 255], [220, 220, 255], [245, 225, 225],
];

const FILE_SIZE = 0x11bd0;
const PIXELS = 0x40;
const ROW_BYTES = 128;
const UPPER_WIDTH = 160;
const UPPER_HEIGHT = 154;
const UPPER_PANELS = 3;
const LOWER_ROW = 462;
const LOWER_WIDTH = 160;
const LOWER_HEIGHT = 105;

const hex = (n: number) => `0x${(n >>> 0).toString(16)}`;
const expand5 = (v: number) => (v << 3) | (v >> 2);

function validateFile(rom: OffroadRom, file: AssetFile, index: number): Uint8Array {
  const size = file.romEnd - file.romStart;
  if (size !== FILE_SIZE) throw new Error(`Off Road Challenge sky ${index} file ${file.id} has size ${hex(size)}, expected ${hex(FILE_SIZE)}`);
  const data = rom.rom.subarray(file.romStart, file.romEnd);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const descriptor = data.length - 0x10;
  if (view.getUint32(descriptor) !== 1 || view.getUint32(descriptor + 4) !== file.destination ||
      view.getUint32(descriptor + 8) !== 0x80000237 || view.getUint32(descriptor + 12) !== file.destination + PIXELS)
    throw new Error(`Off Road Challenge sky ${index} file ${file.id} has an invalid image descriptor`);
  return data;
}

function decodeTexel(data: Uint8Array, view: DataView, palette: number, row: number, x: number, rgba: Uint8Array, dst: number) {
  const packed = data[PIXELS + row * ROW_BYTES + (x >> 1)];
  const index = x & 1 ? packed & 0x0f : packed >>> 4;
  const color = view.getUint16(palette + index * 2);
  rgba[dst] = expand5((color >>> 11) & 31);
  rgba[dst + 1] = expand5((color >>> 6) & 31);
  rgba[dst + 2] = expand5((color >>> 1) & 31);
  rgba[dst + 3] = color & 1 ? 255 : 0;
}

function decodeSky(rom: OffroadRom, file: AssetFile, index: number): [Texture, Texture] {
  const data = validateFile(rom, file, index);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const upperWidth = UPPER_WIDTH * UPPER_PANELS;
  const upper = new Uint8Array(upperWidth * UPPER_HEIGHT * 4);
  for (let panel = 0; panel < UPPER_PANELS; panel++) for (let y = 0; y < UPPER_HEIGHT; y++) {
    const sourceRow = panel * UPPER_HEIGHT + y;
    for (let x = 0; x < UPPER_WIDTH; x++) {
      const dst = (y * upperWidth + panel * UPPER_WIDTH + x) * 4;
      decodeTexel(data, view, 0, sourceRow, x, upper, dst);
    }
  }
  const lower = new Uint8Array(LOWER_WIDTH * LOWER_HEIGHT * 4);
  for (let y = 0; y < LOWER_HEIGHT; y++) for (let x = 0; x < LOWER_WIDTH; x++)
    decodeTexel(data, view, 0x20, LOWER_ROW + y, x, lower, (y * LOWER_WIDTH + x) * 4);

  const source = `${rom.version.region} sky ${index} file ${file.id} ROM ${hex(file.romStart)}-${hex(file.romEnd)} raw CI4`;
  return [
    { width: upperWidth, height: UPPER_HEIGHT, rgba: upper, wrapS: 'repeat', wrapT: 'clamp', format: 'CI4/RGBA16 sky panorama', source: `${source}; palette 0; rows 0-461 as 3 panels` },
    { width: LOWER_WIDTH, height: LOWER_HEIGHT, rgba: lower, wrapS: 'repeat', wrapT: 'clamp', format: 'CI4/RGBA16 sky horizon', source: `${source}; palette 1; rows 462-566` },
  ];
}

export function buildOffroadSkies(rom: OffroadRom, textureBase: number): { textures: Texture[]; skies: PanoramaSky[] } {
  // Validate the retail code table as well as the individual raw-file headers,
  // so a same-title ROM with a different resource mapping cannot be misread.
  const table = 0x6dd3c + (rom.version.code === 'NOFP' ? 0x80 : 0);
  const tintTable = 0x6dd14 + (rom.version.code === 'NOFP' ? 0x80 : 0);
  const view = new DataView(rom.rom.buffer, rom.rom.byteOffset, rom.rom.byteLength);
  for (let i = 0; i < SKY_IDS.length; i++) {
    if (view.getUint32(table + i * 4) !== SKY_IDS[i])
      throw new Error(`Off Road Challenge ${rom.version.region} sky table entry ${i} is unsupported`);
    for (let channel = 0; channel < 3; channel++) if (rom.rom[tintTable + i * 3 + channel] !== SKY_TINTS[i][channel])
      throw new Error(`Off Road Challenge ${rom.version.region} sky tint ${i} is unsupported`);
  }

  const textures: Texture[] = [];
  const skies: PanoramaSky[] = [];
  for (let i = 0; i < SKY_IDS.length; i++) {
    const [upper, lower] = decodeSky(rom, rom.files[SKY_IDS[i]], i);
    const upperTexture = textureBase + textures.length;
    textures.push(upper);
    const lowerTexture = textureBase + textures.length;
    textures.push(lower);
    skies.push({
      name: SKY_NAMES[i], kind: 'panorama', upperTexture, lowerTexture, tint: [...SKY_TINTS[i]],
      logicalViewport: [512, 400], period: 768, panelScreen: [256, 256],
      upperSource: [UPPER_WIDTH, UPPER_HEIGHT], lowerSource: [LOWER_WIDTH, LOWER_HEIGHT],
      yawSign: -1, yawPhase: 0,
      fillAbove: { color: [0, 0, 0], overlap: 2 },
      top: { sinScale: 503.99191323202103, bias: 0, biasScale: 0.007914570160210133, offset: -48, min: -160, max: 48 },
    });
  }
  return { textures, skies };
}
