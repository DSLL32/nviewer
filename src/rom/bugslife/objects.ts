import type { LevelLayer, Marker } from '../types';

// One-based order of the 41 model stems registered by the executable at
// ROM 0x7dc44..0x7de7f. Mapping creatNN.bin +0x0c onto this list fits the
// complete corpus, but remains a research hypothesis rather than code proof.
const CREATURES = [
  'chars/gypsy', 'chars/manny', 'chars/fran', 'chars/rosie', 'chars/slim', 'chars/fly', 'chars/heim', 'chars/dim',
  'chars/badbug', 'chars/mos', 'bits/seed', 'chars/grub', 'chars/wasp', 'chars2/dot', 'chars2/ggrassh', 'chars2/thumper',
  'chars2/hspider', 'chars2/taxibug', 'chars2/roach', 'chars2/tuckroll', 'chars2/attaflik', 'chars2/hopper', 'chars2/tuck',
  'chars2/roll', 'chars2/gypsy', 'chars2/manny2', 'chars2/franslim', 'chars3/atta', 'chars3/molt', 'chars3/bbird',
  'chars3/acorn', 'chars3/bluescot', 'chars3/fdim', 'chars3/dragfly', 'chars3/flikharv', 'chars3/thud', 'chars3/weevil',
  'chars3/soil', 'chars3/protect', 'chars4/badworm', 'chars4/badcent',
] as const;

export function creatureMarkers(data: Uint8Array, levelId: number, layers: LevelLayer[]): Marker[] {
  if (data.length !== 0x700) throw new Error(`creat${levelId.toString().padStart(2, '0')}.bin must contain 64 records`);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const layer = layers.push({ name: 'creatures', kind: 'markers', instances: [] }) - 1;
  const markers: Marker[] = [];
  for (let record = 0; record < 64; record++) {
    const p = record * 0x1c, type = data[p + 0x0c];
    if (type < 1 || type > CREATURES.length) continue; // type zero remains intentionally unresolved
    markers.push({
      label: `candidate ${CREATURES[type - 1].split('/').at(-1)!}`,
      position: [dv.getInt32(p), -dv.getInt32(p + 4), dv.getInt32(p + 8)],
      layer,
      info: { file: `creat/creat${levelId.toString().padStart(2, '0')}.bin`, record, type,
        candidateModel: CREATURES[type - 1], mapping: 'hypothesis: +0x0c as one-based model type', animation: 'not decoded' },
    });
  }
  if (!markers.length) layers.splice(layer, 1);
  return markers;
}
