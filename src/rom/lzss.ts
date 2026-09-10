// LZSS as used by Rush 2049 (boot code lz_decode @ 0x80004AFC).
// Flag byte, bits consumed LSB-first: 1 = literal byte, 0 = two-byte match
// b0 b1 with distance ((b0 & 0xF0) << 4) | b1 and length (b0 & 0x0F) + 2.
// A match with distance 0 and length nibble 0 terminates the stream.

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
