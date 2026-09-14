// Mario Kart 64 (N64; US, EU V1.0/V1.1, J V1.0/V1.1) file access for the viewer research.
//
// There is no file table. Everything a course needs is reached from gCourseTable (20 entries of 0x30 bytes in the
// racing code segment), whose ROM ranges point at:
//   dl MIO0      -> segment 6   course data (section DLs in real F3DEX, TrackSections, paths, object models, lights)
//   offsets raw  -> segment 9   texture list (16-byte entries) + section DL pointer tables
//   vertex blob  -> segment F   MIO0 stream of 14-byte CourseVtx, followed by the packed display-list bytecode
//                  segment 4   expanded 16-byte Vtx (built by the loader from the CourseVtx stream)
//                  segment 7   unpacked F3DEX Gfx (built by the loader from the packed bytecode)
//                  segment 5   course textures: every list entry MIO0-decoded and laid out back to back
// Common data: segment 2 (data_segment2, raw) and segment D (common textures, MIO0). Credits/ceremony data: segment B
// (MIO0), startup logo: segment 6 (MIO0).
//
// No dependencies; big-endian ROMs (.z64). Port of decomp src/racing/memory.c (load_course, decompress_vtx,
// displaylist_unpack, decompress_textures), checked against the ROM.

export const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const align16 = (n: number) => (n + 15) & ~15;

// ---------------------------------------------------------------------------------------------------------------
// MIO0
// ---------------------------------------------------------------------------------------------------------------

export interface Mio0Info {
  size: number; // decompressed size (header +4)
  backrefOffset: number; // header +8, from the header start
  literalOffset: number; // header +C
  end: number; // bytes of the stream actually consumed (control words, back-references and literals), from `at`
}

// Header {"MIO0", u32 size, u32 backrefOffset, u32 literalOffset}; control bits from +0x10 as u32 BE words, MSB first:
// 1 = copy one literal byte, 0 = read u16 v from the back-reference stream and copy (v >> 12) + 3 bytes from
// out[pos - (v & 0xFFF) - 1] one at a time (overlapping copies repeat).
export function mio0(src: Uint8Array, at = 0, info?: Partial<Mio0Info>): Uint8Array {
  const d = dv(src);
  if (d.getUint32(at) !== 0x4d494f30) throw new Error(`No MIO0 stream at 0x${at.toString(16)}`);
  const out = new Uint8Array(d.getUint32(at + 4));
  let bits = at + 16, br = at + d.getUint32(at + 8), lit = at + d.getUint32(at + 12);
  let word = 0, left = 0;
  for (let pos = 0; pos < out.length;) {
    if (left === 0) { word = d.getUint32(bits); bits += 4; left = 32; }
    const bit = word & 0x80000000;
    word = (word << 1) >>> 0;
    left--;
    if (bit) {
      out[pos++] = src[lit++];
    } else {
      const v = d.getUint16(br);
      br += 2;
      const dist = (v & 0xfff) + 1;
      if (dist > pos) throw new Error(`MIO0 at 0x${at.toString(16)}: back-reference before the start`);
      for (let n = (v >> 12) + 3; n > 0 && pos < out.length; n--, pos++) out[pos] = out[pos - dist];
    }
  }
  if (info) {
    info.size = out.length;
    info.backrefOffset = d.getUint32(at + 8);
    info.literalOffset = d.getUint32(at + 12);
    info.end = Math.max(bits, br, lit) - at;
  }
  return out;
}

export function isMio0(src: Uint8Array, at: number) {
  return at >= 0 && at + 16 <= src.length && src[at] === 0x4d && src[at + 1] === 0x49 && src[at + 2] === 0x4f && src[at + 3] === 0x30;
}

// ---------------------------------------------------------------------------------------------------------------
// ROM identification and per-version layout
// ---------------------------------------------------------------------------------------------------------------

export type Mk64Version = 'us' | 'eu10' | 'eu11' | 'jp10' | 'jp11';

export interface Mk64Layout {
  version: Mk64Version;
  gameCode: string; // NKTE / NKTP / NKTJ
  versionByte: number; // header 0x3F
  courseTable: number; // ROM offset of gCourseTable
  courseTableRam: number; // its RAM address (racing segment, vram 0x8028DF00)
  racingRom: number; // ROM offset of the racing segment (vram 0x8028DF00)
  endingRom: number; // ROM offset of the ending segment (vram 0x80280000); it ends where data_segment2 starts
  otherTexturesRom: number; // ROM base of segment-0x0F texture pointers (course texture MIO0 streams)
  dataSegment2: [number, number]; // ROM range, raw, segment 2
  commonTextures: [number, number]; // ROM range, MIO0, segment D
  ceremonyData: [number, number]; // ROM range, MIO0, segment B
  startupLogo: [number, number]; // ROM range, MIO0, segment 6 on the logo screen
}

export const RACING_VRAM = 0x8028df00;
export const COURSE_ENTRY_SIZE = 0x30;
export const COURSE_COUNT = 20; // gCourseTable entries (ids 0..19); id 20 (award ceremony) reuses Royal Raceway (7)

export function romHeader(rom: Uint8Array) {
  const d = dv(rom);
  const str = (o: number, n: number) => String.fromCharCode(...rom.subarray(o, o + n));
  return {
    pi: d.getUint32(0), clock: d.getUint32(4), entry: d.getUint32(8), release: d.getUint32(12),
    crc1: d.getUint32(0x10), crc2: d.getUint32(0x14), title: str(0x20, 20).trimEnd(), gameCode: str(0x3b, 4), versionByte: rom[0x3f],
  };
}

// gCourseTable by content: entry 0's dl and vertex ROM starts are MIO0 streams, +0x18 vertexStart = 0x0F000000,
// +0x28 textures = 0x09000000, and entry 1's dl start = entry 0's dl end (streams are contiguous).
export function findCourseTable(rom: Uint8Array): number {
  const d = dv(rom);
  for (let o = 0xc0000; o < Math.min(0x200000, rom.length - 0x30 * 20); o += 4) {
    if (d.getUint32(o + 0x18) !== 0x0f000000 || d.getUint32(o + 0x28) !== 0x09000000) continue;
    const dl0 = d.getUint32(o), dl1 = d.getUint32(o + 4), vtx0 = d.getUint32(o + 8);
    if (!isMio0(rom, dl0) || !isMio0(rom, vtx0) || d.getUint32(o + 0x30) !== dl1) continue;
    return o;
  }
  return -1;
}

export interface CourseTableEntry {
  id: number;
  at: number; // ROM offset of the entry
  dlRomStart: number; dlRomEnd: number; // MIO0 -> segment 6
  vertexRomStart: number; vertexRomEnd: number; // raw copy -> segment F (MIO0 CourseVtx + packed DL)
  offsetsRomStart: number; offsetsRomEnd: number; // raw -> segment 9
  vertexStart: number; // segmented (0x0F000000): the CourseVtx MIO0 stream
  vertexCount: number;
  packedStart: number; // segmented (0x0F......): packed display-list bytecode
  finalDisplaylistOffset: number; // unpacked Gfx size in bytes (the game allocates align16(n) + 8)
  textures: number; // segmented (0x09000000): texture list
  unknown1: number; // u16 +0x2C (0/1; passed to the combiner unpackers, unused)
  pad: number; // u16 +0x2E
}

export function readCourseTable(rom: Uint8Array, at: number, count = COURSE_COUNT): CourseTableEntry[] {
  const d = dv(rom);
  const out: CourseTableEntry[] = [];
  for (let i = 0; i < count; i++) {
    const o = at + i * COURSE_ENTRY_SIZE, u = (k: number) => d.getUint32(o + k);
    out.push({
      id: i, at: o, dlRomStart: u(0), dlRomEnd: u(4), vertexRomStart: u(8), vertexRomEnd: u(12), offsetsRomStart: u(16), offsetsRomEnd: u(20),
      vertexStart: u(24), vertexCount: u(28), packedStart: u(32), finalDisplaylistOffset: u(36), textures: u(40),
      unknown1: d.getUint16(o + 44), pad: d.getUint16(o + 46),
    });
  }
  return out;
}

// Texture list (segment 9 at CourseTableEntry.textures): 16-byte entries {u32 image (0x0F offset into the
// other_textures ROM block), u32 compressedSize, u32 size, u32 0}, ended by image == 0.
export interface CourseTextureEntry {
  index: number;
  image: number; // 0x0F...... as stored
  compressedSize: number;
  size: number; // decompressed; 0x800 (32x32 / RGBA16) or 0x1000 (64x32, 32x64)
  zero: number;
  rom: number; // ROM offset of the MIO0 stream
  seg5: number; // offset in segment 5 (sum of align16(size) of the previous entries)
}

export function readTextureList(seg9: Uint8Array, offset: number, otherTexturesRom: number): CourseTextureEntry[] {
  const d = dv(seg9);
  const out: CourseTextureEntry[] = [];
  let seg5 = 0;
  for (let i = 0; offset + i * 16 + 16 <= seg9.length; i++) {
    const o = offset + i * 16, image = d.getUint32(o);
    if (image === 0) break;
    const e = { index: i, image, compressedSize: d.getUint32(o + 4), size: d.getUint32(o + 8), zero: d.getUint32(o + 12), rom: otherTexturesRom + (image & 0xffffff), seg5 };
    out.push(e);
    seg5 += align16(e.size);
  }
  return out;
}

// The other_textures base: the one ROM offset for which every entry of Mario Raceway's texture list starts a MIO0
// stream with the listed decompressed size.
function findOtherTextures(rom: Uint8Array, table: CourseTableEntry[]): number {
  const e = table[0];
  const seg9 = rom.subarray(e.offsetsRomStart, e.offsetsRomEnd);
  const list = readTextureList(seg9, e.textures & 0xffffff, 0);
  const d = dv(rom);
  const first = list[0];
  for (let p = rom.indexOf(0x4d, 0x100000); p >= 0 && p < rom.length - 16; p = rom.indexOf(0x4d, p + 1)) {
    if (!isMio0(rom, p) || d.getUint32(p + 4) !== first.size) continue;
    const base = p - (first.image & 0xffffff);
    if (list.every((t) => isMio0(rom, base + (t.image & 0xffffff)) && d.getUint32(base + (t.image & 0xffffff) + 4) === t.size)) return base;
  }
  return -1;
}

// ROM range constants the main code loads with lui/addiu (or lui/ori) pairs: setup_game_memory and the segment
// loaders keep {ending start, ending end = data_segment2 start, data_segment2 end = common textures start, common
// textures end} and the racing segment's ROM start. Returns every constant in [lo, hi) with its code offset.
export function codeConstants(rom: Uint8Array, lo: number, hi: number, from = 0x1000, to = 0x40000): { at: number; value: number }[] {
  const d = dv(rom);
  const out: { at: number; value: number }[] = [];
  for (let o = from; o < to; o += 4) {
    const w = d.getUint32(o);
    if (w >>> 26 !== 0x0f) continue; // lui
    const rt = (w >>> 16) & 31, imm = w & 0xffff;
    for (let k = 1; k < 12; k++) {
      const w2 = d.getUint32(o + 4 * k), op = w2 >>> 26;
      if ((op === 0x09 || op === 0x0d) && ((w2 >>> 21) & 31) === rt) {
        const v = ((imm << 16) + (op === 0x09 ? d.getInt16(o + 4 * k + 2) : w2 & 0xffff)) >>> 0;
        if (v >= lo && v < hi) out.push({ at: o, value: v });
        break;
      }
    }
  }
  return out;
}

export function detectLayout(rom: Uint8Array): Mk64Layout {
  const h = romHeader(rom);
  if (!['NKTE', 'NKTP', 'NKTJ'].includes(h.gameCode)) throw new Error(`Not Mario Kart 64 (game code ${h.gameCode})`);
  const version: Mk64Version = h.gameCode === 'NKTE' ? 'us' : h.gameCode === 'NKTP' ? (h.versionByte ? 'eu11' : 'eu10') : h.versionByte ? 'jp11' : 'jp10';
  const courseTable = findCourseTable(rom);
  if (courseTable < 0) throw new Error('gCourseTable not found');
  const table = readCourseTable(rom, courseTable);
  const d = dv(rom);
  const otherTexturesRom = findOtherTextures(rom, table);
  // common textures: the first MIO0 stream after the course table (verified in all five ROMs)
  let commonStart = -1;
  for (let p = courseTable; p < table[0].dlRomStart; p += 4) if (isMio0(rom, p)) { commonStart = p; break; }
  // data_segment2 start / common textures end: the constants loaded next to commonStart in main
  const consts = codeConstants(rom, courseTable, table[0].dlRomStart);
  const i = consts.findIndex((c, k) => c.value === commonStart && k > 0 && consts[k - 1].value < commonStart && consts[k - 1].at === c.at - 4);
  const seg2Start = i > 0 ? consts[i - 1].value : -1;
  const commonEnd = consts.find((c) => c.at > consts[i].at && c.value > commonStart)?.value ?? -1;
  // racing and ending segments: init_segment_racing / init_segment_ending load ROM [racing, ending) and
  // [ending, data_segment2) with two adjacent lui constants (US code 0x1CF0 and 0x1C78).
  const all = codeConstants(rom, 0x1000, table[0].dlRomStart, 0x1000, 0x10000);
  const pairAt = (value: number) => all.filter((c) => c.value === value).map((c) => all.find((q) => q.at === c.at - 4)).filter((q): q is { at: number; value: number } => !!q);
  const endingStart = pairAt(seg2Start)[0]?.value ?? -1;
  const racingRom = pairAt(endingStart)[0]?.value ?? -1;
  // ceremony data and startup logo: decompress_segments(start, end) constant pairs (two adjacent lui) whose start
  // is a MIO0 stream and whose end is that stream's align16 end, excluding course and common streams. The ceremony
  // pair is loaded by the ending code, the logo pair by menu_items in main. US ceremony 0x821D10, logo 0x825800;
  // J V1.1 moves both behind the common textures (0x144CC0, 0x1487D0).
  const end = (at: number) => { if (at < 0) return -1; const info: Partial<Mio0Info> = {}; mio0(rom, at, info); return align16(at + info.end!); };
  const streamPairs = (from: number, to: number) => {
    const cs = codeConstants(rom, 0x100000, rom.length, from, to);
    return cs.filter((c) => isMio0(rom, c.value) && c.value !== commonStart && !table.some((e) => e.dlRomStart === c.value || e.vertexRomStart === c.value)
      && cs.some((q) => q.at === c.at + 4 && q.value === end(c.value))).map((c) => c.value);
  };
  const ceremony = streamPairs(endingStart, seg2Start)[0] ?? -1;
  const logo = streamPairs(0x1000, racingRom).find((v) => v !== ceremony) ?? -1;
  return {
    version, gameCode: h.gameCode, versionByte: h.versionByte, courseTable,
    courseTableRam: racingRom >= 0 ? RACING_VRAM + courseTable - racingRom : -1, racingRom, otherTexturesRom,
    dataSegment2: [seg2Start, commonStart],
    commonTextures: [commonStart, commonEnd],
    ceremonyData: [ceremony, end(ceremony)],
    startupLogo: [logo, end(logo)],
    endingRom: endingStart,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Vertices: 14-byte CourseVtx {s16 x, y, z; s16 s, t; s8 ca[4]} -> 16-byte Vtx {s16 x, y, z; u16 flag; s16 s, t; u8 r, g, b, a}
// (func_802A86A8): flag = (ca0 & 3) | ((ca1 & 3) << 2); r = ca0 & 0xFC, g = ca1 & 0xFC, b = ca2, a = 0xFF; ca3 unused;
// x negated in mirror mode; y *= vtxStretchY (1.0 in retail, f32 -> s16 truncation).
// ---------------------------------------------------------------------------------------------------------------

export function expandVertices(courseVtx: Uint8Array, count: number, opts: { mirror?: boolean; stretchY?: number } = {}): Uint8Array {
  const s = dv(courseVtx);
  const out = new Uint8Array(align16(count * 16));
  const o = dv(out);
  const sy = opts.stretchY ?? 1;
  for (let i = 0; i < count; i++) {
    const a = i * 14, b = i * 16;
    const x = s.getInt16(a);
    o.setInt16(b, opts.mirror ? -x : x);
    o.setInt16(b + 2, Math.trunc(s.getInt16(a + 2) * sy));
    o.setInt16(b + 4, s.getInt16(a + 4));
    const ca0 = courseVtx[a + 10], ca1 = courseVtx[a + 11];
    o.setUint16(b + 6, (ca0 & 3) | ((ca1 << 2) & 0xc));
    o.setInt16(b + 8, s.getInt16(a + 6));
    o.setInt16(b + 10, s.getInt16(a + 8));
    out[b + 12] = ca0 & 0xfc;
    out[b + 13] = ca1 & 0xfc;
    out[b + 14] = courseVtx[a + 12];
    out[b + 15] = 0xff;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Packed display lists (displaylist_unpack). One opcode byte, then its argument bytes; 0xFF ends the stream.
// Undefined opcodes are skipped (they have no arguments).
// ---------------------------------------------------------------------------------------------------------------

export const PackedOp = {
  LIGHTS_0: 0x00, // 0x00..0x14: gsSPNumLights(1) + 2 x G_MOVEMEM (light k at 0x09000008 + 0x18k, ambient at 0x09000000 + 0x18k)
  COMBINE_MODULATERGBA: 0x15, COMBINE_MODULATERGBDECALA: 0x16, COMBINE_SHADE: 0x17,
  RMODE_OPA: 0x18, RMODE_TEXEDGE: 0x19,
  TILE_32x32_RGBA: 0x1a, TILE_64x32_RGBA: 0x1b, TILE_32x64_RGBA: 0x1c, TILE_32x32_IA: 0x1d, TILE_64x32_IA: 0x1e, TILE_32x64_IA: 0x1f,
  LOAD_32x32_RGBA: 0x20, LOAD_64x32_RGBA: 0x21, LOAD_32x64_RGBA: 0x22, LOAD_32x32_IA: 0x23, LOAD_64x32_IA: 0x24, LOAD_32x64_IA: 0x25,
  TEXTURE_ON: 0x26, TEXTURE_OFF: 0x27, VTX: 0x28, TRI1: 0x29, ENDDL: 0x2a, DL: 0x2b, TILE_32x32_RGBA_TMEM100: 0x2c, CULLDL: 0x2d,
  COMBINE_MODULATERGBDECALA_2: 0x2e, RMODE_XLU: 0x2f, QUAD: 0x30, VTX_N: 0x32 /* 0x33..0x52: n = op - 0x32 */,
  COMBINE_DECALRGBA: 0x53, RMODE_OPA_DECAL: 0x54, RMODE_XLU_DECAL: 0x55, SETGEOMETRYMODE_CULL_BACK: 0x56, CLEARGEOMETRYMODE_CULL_BACK: 0x57, TRI2: 0x58,
  END: 0xff,
} as const;

// Words the unpacker emits (F3DEX 0.95 GBI: F3DEX_GBI + F3D_OLD; values from the decomp's gbi.h, fs/tools/gbiconst.c).
export const W = {
  NUMLIGHTS_1: [0xbc000002, 0x80000040],
  CC_MODULATERGBA: [0xfc121824, 0xff33ffff], // = G_CC_MODULATEIA
  CC_MODULATERGBDECALA: [0xfc127e24, 0xfffff3f9], // = G_CC_MODULATEIDECALA
  CC_SHADE: [0xfcffffff, 0xfffe793c],
  CC_DECALRGBA: [0xfcffffff, 0xfffcf279],
  RM_AA_ZB_OPA_SURF: [0xb900031d, 0x00552078],
  RM_AA_ZB_TEX_EDGE: [0xb900031d, 0x00553078],
  RM_AA_ZB_XLU_SURF: [0xb900031d, 0x005049d8],
  RM_AA_ZB_OPA_DECAL: [0xb900031d, 0x00442d58],
  RM_AA_ZB_XLU_DECAL: [0xb900031d, 0x00404dd8],
  TILESYNC: [0xe8000000, 0], LOADSYNC: [0xe6000000, 0],
  TEXTURE_ON: [0xbb000001, 0xffffffff], TEXTURE_OFF: [0xbb000000, 0x00010001],
  SET_CULL_BACK: [0xb7000000, 0x2000], CLEAR_CULL_BACK: [0xb6000000, 0x2000],
  CULLDL_0_7: [0xbe000000, 0x140],
  ENDDL: [0xb8000000, 0],
} as const;

export interface UnpackResult {
  gfx: Uint8Array; // big-endian Gfx words
  commands: number; // Gfx count
  packedLength: number; // bytes consumed including the 0xFF terminator
  opcodes: Map<number, number>; // packed opcode histogram
  unknown: number[]; // offsets of undefined opcodes
}

export function unpackDisplayList(packed: Uint8Array, start = 0, opts: { mirror?: boolean } = {}): UnpackResult {
  const words: number[] = [];
  const push = (w0: number, w1: number) => words.push(w0 >>> 0, w1 >>> 0);
  const opcodes = new Map<number, number>();
  const unknown: number[] = [];
  const mirror = opts.mirror === true;
  let p = start;
  const arg = () => packed[p++];
  for (;;) {
    if (p >= packed.length) throw new Error('packed display list runs past its buffer');
    const at = p;
    const op = arg();
    if (op === 0xff) break;
    opcodes.set(op, (opcodes.get(op) ?? 0) + 1);
    if (op <= 0x14) {
      push(W.NUMLIGHTS_1[0], W.NUMLIGHTS_1[1]);
      push(0x03860010, 0x09000008 + op * 0x18);
      push(0x03880010, 0x09000000 + op * 0x18);
    } else if (op === 0x15) push(W.CC_MODULATERGBA[0], W.CC_MODULATERGBA[1]);
    else if (op === 0x16 || op === 0x2e) push(W.CC_MODULATERGBDECALA[0], W.CC_MODULATERGBDECALA[1]);
    else if (op === 0x17) push(W.CC_SHADE[0], W.CC_SHADE[1]);
    else if (op === 0x53) push(W.CC_DECALRGBA[0], W.CC_DECALRGBA[1]);
    else if (op === 0x18) push(W.RM_AA_ZB_OPA_SURF[0], W.RM_AA_ZB_OPA_SURF[1]);
    else if (op === 0x19) push(W.RM_AA_ZB_TEX_EDGE[0], W.RM_AA_ZB_TEX_EDGE[1]);
    else if (op === 0x2f) push(W.RM_AA_ZB_XLU_SURF[0], W.RM_AA_ZB_XLU_SURF[1]);
    else if (op === 0x54) push(W.RM_AA_ZB_OPA_DECAL[0], W.RM_AA_ZB_OPA_DECAL[1]);
    else if (op === 0x55) push(W.RM_AA_ZB_XLU_DECAL[0], W.RM_AA_ZB_XLU_DECAL[1]);
    else if ((op >= 0x1a && op <= 0x1f) || op === 0x2c) {
      // unpack_tile_sync: G_RDPTILESYNC, G_SETTILE (render tile 0), G_SETTILESIZE
      const k = op === 0x2c ? 0 : (op - 0x1a) % 3;
      const width = k === 1 ? 64 : 32, height = k === 2 ? 64 : 32, fmt = op === 0x2c ? 0 : op - 0x1a >= 3 ? 3 : 0, tmem = op === 0x2c ? 256 : 0;
      const line = (width * 2 + 7) >> 3;
      const b0 = arg(), b1 = arg();
      const cms = b0 & 0xf, masks = b0 >> 4, cmt = b1 & 0xf, maskt = b1 >> 4;
      push(W.TILESYNC[0], 0);
      push((0xf5 << 24) | (fmt << 21) | (2 << 19) | (line << 9) | tmem, (cmt << 18) | (maskt << 14) | (cms << 8) | (masks << 4));
      push(0xf2 << 24, (((width - 1) << 2) << 12) | ((height - 1) << 2));
    } else if (op >= 0x20 && op <= 0x25) {
      // unpack_tile_load_sync: G_SETTIMG (segment 5, texture index << 11), G_RDPTILESYNC, G_SETTILE (load tile),
      // G_RDPLOADSYNC, G_LOADBLOCK
      const k = (op - 0x20) % 3, fmt = op - 0x20 >= 3 ? 3 : 0;
      const width = k === 1 ? 64 : 32, height = k === 2 ? 64 : 32;
      const addr = 0x05000000 + (arg() << 11);
      arg(); // unused byte
      const b2 = arg();
      const tmem = b2 & 0xf, tile = b2 >> 4;
      const words16 = Math.max(1, (width * 2) >> 3);
      const dxt = Math.trunc(((1 << 11) + words16 - 1) / words16);
      push((0xfd << 24) | (fmt << 21) | (2 << 19), addr);
      push(W.TILESYNC[0], 0);
      push((0xf5 << 24) | (fmt << 21) | (2 << 19) | tmem, tile << 24);
      push(W.LOADSYNC[0], 0);
      push(0xf3 << 24, (tile << 24) | (Math.min(width * height - 1, 0x7ff) << 12) | dxt);
    } else if (op === 0x26) push(W.TEXTURE_ON[0], W.TEXTURE_ON[1]);
    else if (op === 0x27) push(W.TEXTURE_OFF[0], W.TEXTURE_OFF[1]);
    else if (op === 0x28) {
      const lo = arg(), hi = arg();
      const n = arg() & 0x3f, v0 = arg() & 0x3f;
      push((0x04 << 24) | ((v0 * 2) << 16) | ((n << 10) + (16 * n - 1)), 0x04000000 + ((hi << 8) | lo) * 16);
    } else if (op >= 0x33 && op <= 0x52) {
      const n = op - 0x32, lo = arg(), hi = arg();
      push((0x04 << 24) | ((n << 10) + (16 * n - 1)), 0x04000000 + ((hi << 8) | lo) * 16);
    } else if (op === 0x29) {
      const b0 = arg(), b1 = arg();
      const first = b0 & 0x1f, mid = ((b0 >> 5) & 7) | ((b1 & 3) << 3), last = (b1 >> 2) & 0x1f;
      const [a, c] = mirror ? [last, first] : [first, last];
      push(0xbf << 24, ((a * 2) << 16) | ((mid * 2) << 8) | (c * 2));
    } else if (op === 0x58) {
      const b0 = arg(), b1 = arg(), b2 = arg(), b3 = arg();
      const t = (x0: number, x1: number) => {
        const first = x0 & 0x1f, mid = ((x0 >> 5) & 7) | ((x1 & 3) << 3), last = (x1 >> 2) & 0x1f;
        return mirror ? [last, mid, first] : [first, mid, last];
      };
      const [a0, a1, a2] = t(b0, b1), [c0, c1, c2] = t(b2, b3);
      push((0xb1 << 24) | ((a0 * 2) << 16) | ((a1 * 2) << 8) | (a2 * 2), ((c0 * 2) << 16) | ((c1 * 2) << 8) | (c2 * 2));
    } else if (op === 0x30) {
      const b0 = arg(), b1 = arg(), b2 = arg();
      const x0 = b0 & 0x1f, x1 = ((b0 >> 5) & 7) | ((b1 & 3) << 3), x2 = (b1 >> 2) & 0x1f, x3 = ((b1 >> 7) & 1) | ((b2 & 0xf) << 1);
      // non-mirror: t0 = x0, a3 = x1, a2 = x2, a0 = x3; mirror: a0 = x0, a2 = x1, a3 = x2, t0 = x3
      const [a0, t0, a3, a2] = mirror ? [x0, x3, x2, x1] : [x3, x0, x1, x2];
      push(0xb5 << 24, ((a0 * 2) << 24) | ((t0 * 2) << 16) | ((a3 * 2) << 8) | (a2 * 2));
    } else if (op === 0x2d) push(W.CULLDL_0_7[0], W.CULLDL_0_7[1]);
    else if (op === 0x2a) push(W.ENDDL[0], 0);
    else if (op === 0x56) push(W.SET_CULL_BACK[0], W.SET_CULL_BACK[1]);
    else if (op === 0x57) push(W.CLEAR_CULL_BACK[0], W.CLEAR_CULL_BACK[1]);
    else if (op === 0x2b) {
      const lo = arg(), hi = arg();
      push(0x06000000, 0x07000000 + ((hi << 8) | lo) * 8);
    } else {
      unknown.push(at);
    }
  }
  const gfx = new Uint8Array(words.length * 4);
  const g = dv(gfx);
  words.forEach((w, i) => g.setUint32(i * 4, w));
  return { gfx, commands: words.length / 2, packedLength: p - start, opcodes, unknown };
}

// ---------------------------------------------------------------------------------------------------------------
// Segment space: segment files in one buffer, resolved by segmented address, with a scratch area for synthesised lists.
// ---------------------------------------------------------------------------------------------------------------

export const SCRATCH_SEGMENT = 0x01; // the game's gfx pool segment; never referenced by asset data

export class SegmentSpace {
  buf: Uint8Array;
  dv: DataView;
  base = new Array<number>(16).fill(-1);
  size = new Array<number>(16).fill(0);
  scratch: number; // next free byte of the scratch area (buffer offset)
  private scratch0: number;

  constructor(segments: Partial<Record<number, Uint8Array>>, scratchBytes = 0x80000) {
    let total = 0;
    for (const [k, v] of Object.entries(segments)) if (v) total += align16(v.length) + 16;
    this.buf = new Uint8Array(total + scratchBytes);
    this.dv = dv(this.buf);
    let o = 0;
    for (const [k, v] of Object.entries(segments)) {
      if (!v) continue;
      this.buf.set(v, o);
      this.base[+k] = o;
      this.size[+k] = v.length;
      o += align16(v.length) + 16;
    }
    this.scratch0 = this.scratch = o;
    this.base[SCRATCH_SEGMENT] = o;
    this.size[SCRATCH_SEGMENT] = scratchBytes;
  }

  // Buffer offset of a segmented address, -1 when not mapped. KSEG0 addresses are not mapped.
  resolve = (addr: number): number => {
    addr >>>= 0;
    if (addr >= 0x80000000) return -1;
    const seg = addr >>> 24, off = addr & 0xffffff;
    if (seg > 15 || this.base[seg] < 0 || off >= this.size[seg]) return -1;
    return this.base[seg] + off;
  };

  has(addr: number) { return this.resolve(addr) >= 0; }
  u32(addr: number) { const o = this.resolve(addr); return o < 0 ? 0 : this.dv.getUint32(o); }
  segment(seg: number): Uint8Array | null { return this.base[seg] < 0 ? null : this.buf.subarray(this.base[seg], this.base[seg] + this.size[seg]); }

  // Writes Gfx words into the scratch area; returns their segmented address.
  emit(words: (readonly [number, number] | number[])[]): number {
    const at = this.scratch;
    for (const [w0, w1] of words) { this.dv.setUint32(this.scratch, w0 >>> 0); this.dv.setUint32(this.scratch + 4, w1 >>> 0); this.scratch += 8; }
    return (SCRATCH_SEGMENT << 24) | (at - this.scratch0);
  }
  alloc(bytes: number): number {
    const at = this.scratch;
    this.scratch += align16(bytes);
    return (SCRATCH_SEGMENT << 24) | (at - this.scratch0);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Course loading (load_course)
// ---------------------------------------------------------------------------------------------------------------

export interface CourseFiles {
  entry: CourseTableEntry;
  seg6: Uint8Array; // decompressed course data
  seg6Info: Mio0Info;
  seg9: Uint8Array; // offsets (raw)
  segF: Uint8Array; // raw vertex blob (align16 of the ROM range, as dma_compressed_vtx copies it)
  courseVtx: Uint8Array; // decompressed CourseVtx stream (14 bytes per vertex)
  courseVtxInfo: Mio0Info;
  seg4: Uint8Array; // expanded Vtx
  seg7: Uint8Array; // unpacked Gfx
  unpack: UnpackResult;
  textures: CourseTextureEntry[];
  textureInfo: Mio0Info[];
  seg5: Uint8Array; // decompressed textures back to back
}

export function loadCourseFiles(rom: Uint8Array, layout: Mk64Layout, entry: CourseTableEntry, opts: { mirror?: boolean } = {}): CourseFiles {
  const seg6Info: Partial<Mio0Info> = {};
  const seg6 = mio0(rom, entry.dlRomStart, seg6Info);
  const seg9 = rom.slice(entry.offsetsRomStart, entry.offsetsRomEnd);
  const segF = rom.slice(entry.vertexRomStart, entry.vertexRomStart + align16(entry.vertexRomEnd - entry.vertexRomStart));
  const courseVtxInfo: Partial<Mio0Info> = {};
  const courseVtx = mio0(segF, entry.vertexStart & 0xffffff, courseVtxInfo);
  const seg4 = expandVertices(courseVtx, entry.vertexCount, opts);
  const unpack = unpackDisplayList(segF, entry.packedStart & 0xffffff, opts);
  const textures = readTextureList(seg9, entry.textures & 0xffffff, layout.otherTexturesRom);
  const seg5 = new Uint8Array(textures.reduce((s, t) => s + align16(t.size), 0));
  const textureInfo: Mio0Info[] = [];
  for (const t of textures) {
    const info: Partial<Mio0Info> = {};
    const img = mio0(rom, t.rom, info);
    seg5.set(img, t.seg5);
    textureInfo.push(info as Mio0Info);
  }
  return {
    entry, seg6, seg6Info: seg6Info as Mio0Info, seg9, segF, courseVtx, courseVtxInfo: courseVtxInfo as Mio0Info, seg4,
    seg7: unpack.gfx, unpack, textures, textureInfo, seg5,
  };
}

export interface CommonFiles {
  seg2: Uint8Array; // data_segment2 (raw)
  segD: Uint8Array; // common textures (MIO0)
  segB: Uint8Array; // ceremony data (MIO0)
  logo: Uint8Array; // startup logo (MIO0, segment 6 on the logo screen)
}

export function loadCommonFiles(rom: Uint8Array, layout: Mk64Layout): CommonFiles {
  return {
    seg2: rom.slice(layout.dataSegment2[0], layout.dataSegment2[1]),
    segD: mio0(rom, layout.commonTextures[0]),
    segB: mio0(rom, layout.ceremonyData[0]),
    logo: mio0(rom, layout.startupLogo[0]),
  };
}

// A resolver for one course as the game maps it during a race (segments 2, 4, 5, 6, 7, 9, D, F).
export function courseSpace(course: CourseFiles, common?: Partial<CommonFiles>, scratchBytes?: number,
  extra: Partial<Record<number, Uint8Array>> = {}): SegmentSpace {
  return new SegmentSpace({
    2: common?.seg2, 4: course.seg4, 5: course.seg5, 6: course.seg6, 7: course.seg7, 9: course.seg9, 0xb: common?.segB, 0xd: common?.segD, 0xf: course.segF,
    ...extra,
  }, scratchBytes);
}

// Retail course ids, names as the game prints them (gCourseNames), debug-menu names (gDebugCourseNames), cups
// (gCupCourseOrder) and the leak's KTn numbering (KTn = id n - 1).
export const COURSES: { id: number; name: string; debug: string; cup: string; cupIndex: number; kind: 'race' | 'battle' | 'other'; leak: string }[] = [
  { id: 0, name: 'Mario Raceway', debug: 'm circuit', cup: 'Flower Cup', cupIndex: 3, kind: 'race', leak: 'KT1' },
  { id: 1, name: 'Choco Mountain', debug: 'mountain', cup: 'Flower Cup', cupIndex: 2, kind: 'race', leak: 'KT2' },
  { id: 2, name: "Bowser's Castle", debug: 'castle', cup: 'Star Cup', cupIndex: 3, kind: 'race', leak: 'KT3' },
  { id: 3, name: 'Banshee Boardwalk', debug: 'ghost', cup: 'Special Cup', cupIndex: 2, kind: 'race', leak: 'KT4' },
  { id: 4, name: 'Yoshi Valley', debug: 'maze', cup: 'Special Cup', cupIndex: 1, kind: 'race', leak: 'KT5' },
  { id: 5, name: 'Frappe Snowland', debug: 'snow', cup: 'Flower Cup', cupIndex: 1, kind: 'race', leak: 'KT6' },
  { id: 6, name: 'Koopa Troopa Beach', debug: 'beach', cup: 'Mushroom Cup', cupIndex: 2, kind: 'race', leak: 'KT7' },
  { id: 7, name: 'Royal Raceway', debug: 'p circuit', cup: 'Star Cup', cupIndex: 2, kind: 'race', leak: 'KT8' },
  { id: 8, name: 'Luigi Raceway', debug: 'l circuit', cup: 'Mushroom Cup', cupIndex: 0, kind: 'race', leak: 'KT9' },
  { id: 9, name: 'Moo Moo Farm', debug: 'farm', cup: 'Mushroom Cup', cupIndex: 1, kind: 'race', leak: 'KT10' },
  { id: 10, name: "Toad's Turnpike", debug: 'highway', cup: 'Flower Cup', cupIndex: 0, kind: 'race', leak: 'KT11' },
  { id: 11, name: 'Kalimari Desert', debug: 'desert', cup: 'Mushroom Cup', cupIndex: 3, kind: 'race', leak: 'KT12' },
  { id: 12, name: 'Sherbet Land', debug: 'sherbet', cup: 'Star Cup', cupIndex: 1, kind: 'race', leak: 'KT13' },
  { id: 13, name: 'Rainbow Road', debug: 'rainbow', cup: 'Special Cup', cupIndex: 3, kind: 'race', leak: 'KT14' },
  { id: 14, name: 'Wario Stadium', debug: 'stadium', cup: 'Star Cup', cupIndex: 0, kind: 'race', leak: 'KT15' },
  { id: 15, name: 'Block Fort', debug: 'block', cup: 'Battle', cupIndex: 1, kind: 'battle', leak: 'KT16' },
  { id: 16, name: 'Skyscraper', debug: 'skyscraper', cup: 'Battle', cupIndex: 3, kind: 'battle', leak: 'KT17' },
  { id: 17, name: 'Double Deck', debug: 'deck', cup: 'Battle', cupIndex: 2, kind: 'battle', leak: 'KT18' },
  { id: 18, name: "D.K.'s Jungle Parkway", debug: 'jungle', cup: 'Special Cup', cupIndex: 0, kind: 'race', leak: 'KT19' },
  { id: 19, name: 'Big Donut', debug: 'doughnut', cup: 'Battle', cupIndex: 0, kind: 'battle', leak: 'KT20' },
  { id: 20, name: 'Award Ceremony', debug: '', cup: '', cupIndex: -1, kind: 'other', leak: 'RESULT' },
];
