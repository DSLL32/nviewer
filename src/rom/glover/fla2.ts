// Glover's FLA2 stream: a little-endian decoded size followed by an MSB-first
// 4 KiB-window LZSS stream. A zero high byte in a match token ends the stream.
export function decodeFla2(src: Uint8Array, offset = 0): Uint8Array {
  if (src[offset] !== 0x46 || src[offset + 1] !== 0x4c || src[offset + 2] !== 0x41 || src[offset + 3] !== 0x32)
    throw new Error(`invalid Glover FLA2 stream at 0x${offset.toString(16)}`);
  const size = (src[offset + 4] | src[offset + 5] << 8 | src[offset + 6] << 16 | src[offset + 7] << 24) >>> 0;
  const out = new Uint8Array(size);
  const window = new Uint8Array(0x1000);
  let input = offset + 8;
  let output = 0;
  let cursor = 0;
  for (;;) {
    if (input >= src.length) throw new Error('truncated Glover FLA2 stream');
    let flags = src[input++];
    for (let bit = 0; bit < 8; bit++, flags <<= 1) {
      let count = 1;
      let back = 0;
      if (flags & 0x80) {
        const hi = src[input++];
        if (hi === 0) {
          if (output !== size) throw new Error(`Glover FLA2 size mismatch: ${output} != ${size}`);
          return out;
        }
        back = 0x1000 - (((hi & 0xf0) << 4) | src[input++]);
        count = (hi & 0x0f) + 2;
      }
      while (count-- > 0) {
        const value = back ? window[(cursor + back) & 0xfff] : src[input++];
        if (output >= size) throw new Error('Glover FLA2 stream exceeds declared size');
        out[output++] = value;
        window[cursor] = value;
        cursor = (cursor + 1) & 0xfff;
      }
    }
  }
}
