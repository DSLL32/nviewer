// LZSS as used by Rush 2049 (boot code lz_decode @ 0x80004AFC).
// Flag byte, bits consumed LSB-first: 1 = literal byte, 0 = two-byte match
// b0 b1 with distance ((b0 & 0xF0) << 4) | b1 and length (b0 & 0x0F) + 2.
// A match with distance 0 and length nibble 0 terminates the stream.

// LZSS as used by San Francisco Rush (boot code @ 0x80003B18): same flag and match
// encoding, but matches address a 4096-byte ring buffer absolutely (write position
// starts at 1). There is no stored size; the stream ends with a zero match.
export function lzssRingDecode(src: Uint8Array, offset: number): Uint8Array {
  const ring = new Uint8Array(4096);
  let out = new Uint8Array(0x10000);
  let op = 0;
  let pos = 1;
  let ip = offset;
  const put = (c: number) => {
    if (op === out.length) {
      const bigger = new Uint8Array(out.length * 2);
      bigger.set(out);
      out = bigger;
    }
    out[op++] = c;
    ring[pos] = c;
    pos = (pos + 1) & 0xfff;
  };
  while (ip + 2 < src.length) {
    const flags = src[ip++];
    for (let bit = 0; bit < 8; bit++) {
      if (flags & (1 << bit)) {
        put(src[ip++]);
      } else {
        const b0 = src[ip++];
        const b1 = src[ip++];
        const p = ((b0 & 0xf0) << 4) | b1;
        const nib = b0 & 0x0f;
        if (p === 0 && nib === 0) return out.slice(0, op);
        for (let k = 0; k < nib + 2; k++) put(ring[(p + k) & 0xfff]);
      }
    }
  }
  return out.slice(0, op);
}

export function lzssDecode(src: Uint8Array, offset: number, outSize: number): Uint8Array {
  const out = new Uint8Array(outSize);
  let ip = offset;
  let op = 0;
  while (op < outSize) {
    const flags = src[ip++];
    for (let bit = 0; bit < 8 && op < outSize; bit++) {
      if (flags & (1 << bit)) {
        out[op++] = src[ip++];
      } else {
        const b0 = src[ip++];
        const b1 = src[ip++];
        const dist = ((b0 & 0xf0) << 4) | b1;
        const nib = b0 & 0x0f;
        if (dist === 0 && nib === 0) return out.subarray(0, op);
        let len = nib + 2;
        let from = op - dist;
        while (len-- > 0 && op < outSize) out[op++] = out[from++];
      }
    }
  }
  return out;
}
