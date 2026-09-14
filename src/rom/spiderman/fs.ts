// Spider-Man (N64) master directory and ERZ-v2 decompression.

const u32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset + o, 4).getUint32(0);

function tag(b: Uint8Array, o: number, s: string): boolean {
  if (o < 0 || o + s.length > b.length) return false;
  for (let i = 0; i < s.length; i++) if (b[o + i] !== s.charCodeAt(i)) return false;
  return true;
}

/** Normalise .z64/.v64/.n64 dumps to big-endian cartridge byte order. */
export function normalizeSpiderManRom(src: Uint8Array): Uint8Array {
  if (src.length < 0x40) throw new Error('Spider-Man ROM is truncated');
  const magic = u32(src, 0);
  if (magic === 0x80371240) return src;
  const out = new Uint8Array(src.length);
  if (magic === 0x37804012) {
    for (let i = 0; i + 1 < src.length; i += 2) { out[i] = src[i + 1]; out[i + 1] = src[i]; }
    return out;
  }
  if (magic === 0x40123780) {
    for (let i = 0; i + 3 < src.length; i += 4) {
      out[i] = src[i + 3]; out[i + 1] = src[i + 2]; out[i + 2] = src[i + 1]; out[i + 3] = src[i];
    }
    return out;
  }
  throw new Error('not an N64 ROM');
}

function tableRanges(data: Uint8Array, at: number, slack = 0): [number, number][] {
  if (at < 0 || at + 8 > data.length) throw new Error(`table outside data at 0x${at.toString(16)}`);
  const count = u32(data, at);
  if (count > 0xffff || at + 8 + count * 4 > data.length) throw new Error(`invalid table at 0x${at.toString(16)}`);
  const header = 4 + 4 * (count + 1);
  const rel = Array.from({ length: count + 1 }, (_, i) => u32(data, at + 4 + i * 4));
  if (rel[0] < header || rel[0] > header + slack || rel[count] > data.length - at)
    throw new Error(`invalid table extent at 0x${at.toString(16)}`);
  for (let i = 0; i < count; i++) if (rel[i] > rel[i + 1]) throw new Error(`descending table at 0x${at.toString(16)}`);
  return Array.from({ length: count }, (_, i) => [at + rel[i], at + rel[i + 1]]);
}

export const spiderManTable = tableRanges;

function erz(block: Uint8Array): boolean { return block.length >= 18 && tag(block, 0, 'ERZ') && block[3] === 2; }

/** Exact bounded transcription of the resident ERZ version-2 decoder. */
export function decodeErz2(block: Uint8Array): Uint8Array {
  if (!erz(block)) throw new Error('not an ERZ-v2 stream');
  const outSize = u32(block, 4), compSize = u32(block, 8), end = 18 + compSize;
  if (outSize > 0x1000000 || compSize === 0 || end > block.length) throw new Error('invalid ERZ-v2 sizes');
  const out = new Uint8Array(outSize);
  let input = 18, output = 0, t0 = 0, t1 = 0;
  const next = () => { if (input >= end) throw new Error('ERZ-v2 input overrun'); return block[input++]; };
  const put = (v: number) => { if (output >= out.length) throw new Error('ERZ-v2 output overrun'); out[output++] = v; };
  let t2 = next() * 2 + 1;
  t2 += t2;
  let t7 = (t2 >>> 8) & 1;
  const bit = () => {
    t2 += t2; t7 = (t2 >>> 8) & 1; t2 &= 0xff;
    if (t2 === 0) { t2 = next() * 2 + t7; t7 = (t2 >>> 8) & 1; }
    return t7;
  };
  let state = 0; // dispatch, gamma length, distance, copy, raw, end escape
  for (;;) {
    if (state === 0) {
      t2 += t2; t7 = (t2 >>> 8) & 1;
      if (t7 === 0) {
        put(next()); t2 += t2; t7 = (t2 >>> 8) & 1;
        if (t7 === 0) { put(next()); continue; }
      }
      t2 &= 0xff;
      if (t2 === 0) {
        t2 = next() * 2 + t7; t7 = (t2 >>> 8) & 1;
        if (t7 === 0) { put(next()); continue; }
      }
      t0 = 2; t1 = 0;
      if (bit() === 0) state = 1;
      else if (bit() === 0) state = 3;
      else { t0++; if (bit() === 0) state = 2; else { t0 = next(); state = t0 === 0 ? 5 : 2; if (state === 2) t0 += 8; } }
    } else if (state === 1) {
      t0 = t0 * 2 + bit();
      if (bit() === 0) { state = 2; continue; }
      t0 = (t0 - 1) * 2 + bit();
      state = t0 === 9 ? 4 : 2;
    } else if (state === 2) {
      if (bit() === 0) { state = 3; continue; }
      t1 = t1 * 2 + bit();
      if (bit() !== 0) {
        t1 = t1 * 2 + bit(); t1 |= 4;
        if (bit() === 0) t1 = t1 * 2 + bit();
      } else if (t1 === 0) t1 = 2 + bit();
      t1 = ((t1 << 8) & 0xff00) | ((t1 >>> 8) & 0xff);
      state = 3;
    } else if (state === 3) {
      t1 = (t1 & 0xff00) | next();
      let match = output - t1 - 1;
      if (match < 0) throw new Error('ERZ-v2 match before output');
      const odd = t0 & 1; t0 >>>= 1;
      if (odd) put(out[match++]);
      t0--;
      if (t1 === 0) {
        const fill = out[match];
        for (;;) { put(fill); t0--; put(fill); if (t0 < 0) break; }
      } else {
        for (;;) { const a = out[match], b = out[match + 1]; put(a); put(b); match += 2; t0--; if (t0 < 0) break; }
      }
      state = 0;
    } else if (state === 4) {
      t1 = 0;
      for (let i = 0; i < 4; i++) t1 = t1 * 2 + bit();
      t1 += 2;
      while (t1-- >= 0) { put(next()); put(next()); put(next()); put(next()); }
      state = 0;
    } else {
      if (bit() !== 0) { state = 0; continue; }
      if (output !== out.length) throw new Error(`ERZ-v2 ended at ${output} of ${out.length}`);
      return out;
    }
  }
}

export class SpiderManFs {
  readonly rom: Uint8Array;
  readonly groupLeaves: [number, number][][];
  private readonly streams = new Map<number, Uint8Array>();
  private readonly files = new Map<string, Uint8Array>();
  private bootCache?: Uint8Array;

  constructor(source: Uint8Array) {
    this.rom = normalizeSpiderManRom(source);
    if (this.rom.length !== 0x2000000) throw new Error(`unsupported Spider-Man ROM size 0x${this.rom.length.toString(16)} (expected 32 MiB)`);
    const code = String.fromCharCode(...this.rom.subarray(0x3b, 0x3f));
    if (code !== 'NSLE' || this.rom[0x3f] !== 0) throw new Error(`unsupported Spider-Man ROM ${code} revision ${this.rom[0x3f]}`);
    const rootPointer = u32(this.rom, 0x13b30);
    if ((rootPointer >>> 28) !== 0xb) throw new Error('invalid Spider-Man master-directory pointer');
    const roots = tableRanges(this.rom, rootPointer & 0x0fffffff, 16);
    if (roots.length !== 8) throw new Error(`invalid Spider-Man master-directory group count ${roots.length}`);
    this.groupLeaves = roots.map(([start]) => tableRanges(this.rom, start));
  }

  /** Concatenated decoded logical stream for compressed groups (0-4, 6-7). */
  groupStream(group: number): Uint8Array {
    if (!Number.isInteger(group) || group < 0 || group >= this.groupLeaves.length || group === 5)
      throw new Error(`Spider-Man group ${group} has no logical stream`);
    let stream = this.streams.get(group);
    if (stream) return stream;
    const parts = this.groupLeaves[group].filter(([a, b]) => b > a).map(([a, b]) => {
      const leaf = this.rom.subarray(a, b); return erz(leaf) ? decodeErz2(leaf) : leaf;
    });
    const size = parts.reduce((n, p) => n + p.length, 0);
    stream = new Uint8Array(size); let at = 0;
    for (const part of parts) { stream.set(part, at); at += part.length; }
    this.streams.set(group, stream);
    return stream;
  }

  /** Logical file by group and slot. Group 5 slots are the directory's independent raw leaves. */
  getFile(group: number, slot: number): Uint8Array {
    const key = `${group}:${slot}`;
    const cached = this.files.get(key); if (cached) return cached;
    let file: Uint8Array;
    if (group === 5) {
      const range = this.groupLeaves[5]?.[slot];
      if (!range) throw new Error(`Spider-Man group 5 file ${slot} is missing`);
      file = this.rom.subarray(range[0], range[1]);
    } else {
      const stream = this.groupStream(group), ranges = tableRanges(stream, 0, 4), range = ranges[slot];
      if (!range) throw new Error(`Spider-Man group ${group} file ${slot} is missing`);
      file = stream.subarray(range[0], range[1]);
    }
    this.files.set(key, file);
    return file;
  }

  /** Decompressed 0xF2EF0-byte main image loaded by the resident boot code. */
  bootImage(): Uint8Array {
    if (this.bootCache) return this.bootCache;
    const ranges = tableRanges(this.rom, 0x13b34);
    const parts = ranges.map(([a, b]) => decodeErz2(this.rom.subarray(a, b)));
    const size = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(size); let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return this.bootCache = out;
  }
}
