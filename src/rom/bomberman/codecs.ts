// Decompressors used by the Hudson Bomberman games.

// LZSS with a 1,024-byte ring (Bomberman 64 and The Second Attack): Okumura-style with
// F = 66, threshold 2, and absolute ring positions. The ring starts zeroed with the
// write position at 0x3BE. A flag byte is read least significant bit first: 1 = literal,
// 0 = match `b0 b1` with position b0 | (b1 & 0xC0) << 2 and length (b1 & 0x3F) + 3.
// There is no end marker: the stream stops at the size stored in the container.
export function lzss1kDecode(src: Uint8Array, pos: number, size: number): Uint8Array {
  const out = new Uint8Array(size);
  const ring = new Uint8Array(1024);
  let r = 0x3be;
  let flags = 0;
  let o = 0;
  while (o < size && pos < src.length) {
    flags >>= 1;
    if ((flags & 0x100) === 0) flags = src[pos++] | 0xff00;
    if (flags & 1) {
      const c = src[pos++];
      out[o++] = c;
      ring[r] = c;
      r = (r + 1) & 0x3ff;
    } else {
      const b0 = src[pos++];
      const b1 = src[pos++];
      const p = b0 | ((b1 & 0xc0) << 2);
      const len = (b1 & 0x3f) + 3;
      for (let k = 0; k < len && o < size; k++) {
        const c = ring[(p + k) & 0x3ff];
        out[o++] = c;
        ring[r] = c;
        r = (r + 1) & 0x3ff;
      }
    }
  }
  return out;
}

// LZSS with a 4,096-byte ring (Bomberman Hero): Okumura LZSS.C (F = 18, threshold 2) with
// a zeroed window and the write position at 0xFEE. A match `b0 b1` has position
// b0 | (b1 & 0xF0) << 4 and length (b1 & 0x0F) + 3. The stream is `u32 little-endian n`
// followed by n compressed bytes; the decompressed size is not stored.
export function lzss4kDecode(src: Uint8Array, start: number): Uint8Array {
  const n = src[start] | (src[start + 1] << 8) | (src[start + 2] << 16) | (src[start + 3] << 24);
  let pos = start + 4;
  const end = Math.min(src.length, pos + (n >>> 0));
  let out = new Uint8Array(Math.max(1024, (n >>> 0) * 4));
  const ring = new Uint8Array(4096);
  let r = 0xfee;
  let flags = 0;
  let o = 0;
  const emit = (c: number) => {
    if (o === out.length) {
      const grown = new Uint8Array(out.length * 2);
      grown.set(out);
      out = grown;
    }
    out[o++] = c;
    ring[r] = c;
    r = (r + 1) & 0xfff;
  };
  while (pos < end) {
    flags >>= 1;
    if ((flags & 0x100) === 0) {
      flags = src[pos++] | 0xff00;
      if (pos >= end) break;
    }
    if (flags & 1) {
      emit(src[pos++]);
    } else {
      if (pos + 1 >= end) break;
      const b0 = src[pos++];
      const b1 = src[pos++];
      const p = b0 | ((b1 & 0xf0) << 4);
      const len = (b1 & 0x0f) + 3;
      for (let k = 0; k < len; k++) emit(ring[(p + k) & 0xfff]);
    }
  }
  return out.slice(0, o);
}

// Nintendo Yay0 (The Second Attack): header 'Yay0', u32 size, u32 link table offset,
// u32 chunk offset (relative to the magic), then flag words most significant bit first.
export function yay0Decode(src: Uint8Array, start: number): Uint8Array {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const size = dv.getUint32(start + 4);
  let link = start + dv.getUint32(start + 8);
  let chunk = start + dv.getUint32(start + 12);
  let flagPos = start + 16;
  const out = new Uint8Array(size);
  let o = 0;
  let flags = 0;
  let bits = 0;
  while (o < size) {
    if (bits === 0) {
      flags = dv.getUint32(flagPos);
      flagPos += 4;
      bits = 32;
    }
    if (flags & 0x80000000) {
      out[o++] = src[chunk++];
    } else {
      const l = dv.getUint16(link);
      link += 2;
      const dist = (l & 0xfff) + 1;
      const n = l >> 12;
      const len = n === 0 ? src[chunk++] + 18 : n + 2;
      for (let k = 0; k < len && o < size; k++, o++) out[o] = out[o - dist];
    }
    flags <<= 1;
    bits--;
  }
  return out;
}
