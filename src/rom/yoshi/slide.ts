// Yoshi's Story "CMPR" + "SMSR00" slide-LZ, the ROM's only codec (port of slidec at 0x8006D950).
//
// CMPR record: {char[4] "CMPR"; u32 compSize; u32 origSize; u32 0} followed by an SMSR stream:
// {char[8] "SMSR00\0\0"; u32 size; u32 literal offset (from +0x10)}, then big-endian u16 words at +0x10
// (control words, 16 flags MSB first, 1 = literal, interleaved with match words LLLL DDDD DDDD DDDD: copy
// L + 3 bytes from D + 1 back) and the literal bytes at +0x10 + literal offset. No end marker.
import { view } from '../util';

export function slideDecode(buf: Uint8Array, off: number): Uint8Array {
  const dv = view(buf);
  if (dv.getUint32(off) !== 0x534d5352) throw new Error(`No SMSR stream at 0x${off.toString(16)}`);
  const size = dv.getUint32(off + 8);
  let ctrl = off + 16;
  let lit = off + 16 + dv.getUint32(off + 12);
  const out = new Uint8Array(size + 18); // a final match may overrun by up to 17 bytes
  let pos = 0, bits = 0, cur = 0;
  while (pos < size) {
    if (bits === 0) {
      cur = dv.getUint16(ctrl);
      ctrl += 2;
      bits = 16;
    }
    if (cur & 0x8000) {
      out[pos++] = buf[lit++];
    } else {
      const w = dv.getUint16(ctrl);
      ctrl += 2;
      let src = pos - (w & 0xfff) - 1;
      if (src < 0) throw new Error('Slide back-reference before the start of the output');
      for (let n = (w >> 12) + 3; n > 0; n--) out[pos++] = out[src++];
    }
    cur = (cur << 1) & 0xffff;
    bits--;
  }
  return out.subarray(0, size);
}

// What the game's DMA read of `size` bytes at ROM `off` yields: CMPR records come back decompressed.
export function dmaRead(rom: Uint8Array, off: number, size: number): Uint8Array {
  if (size >= 16 && off + 16 <= rom.length && view(rom).getUint32(off) === 0x434d5052) return slideDecode(rom, off + 16);
  return rom.subarray(off, off + size);
}
