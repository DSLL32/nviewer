// LZARI (Haruhiko Okumura, 1989), the asset codec of BattleTanx and BattleTanx: Global Assault.
// Stream: u32 BE decoded size, then an arithmetic-coded bitstream read most significant bit first.
// Ring of 4096 bytes (all spaces but the last 60, write position 4036), match lengths 3..60,
// adaptive symbol model of 314 symbols and a static position model. There is no end marker.
const N = 4096;
const F = 60;
const THRESHOLD = 2;
const N_CHAR = 256 - THRESHOLD + F;
const M = 15;
const Q1 = 1 << M;
const Q2 = 2 * Q1;
const Q3 = 3 * Q1;
const Q4 = 4 * Q1;
const MAX_CUM = Q1 - 1;

const POSITION_CUM = (() => {
  const cum = new Int32Array(N + 1);
  for (let i = N; i >= 1; i--) cum[i - 1] = cum[i] + Math.floor(10000 / (i + 200));
  return cum;
})();

export function lzariDecode(src: Uint8Array, offset: number): Uint8Array {
  const size = ((src[offset] << 24) | (src[offset + 1] << 16) | (src[offset + 2] << 8) | src[offset + 3]) >>> 0;
  let pos = offset + 4;
  let byte = 0;
  let mask = 0;
  const getBit = () => {
    mask >>= 1;
    if (mask === 0) {
      byte = pos < src.length ? src[pos] : 0;
      pos++;
      mask = 128;
    }
    return byte & mask ? 1 : 0;
  };

  const charToSym = new Int32Array(N_CHAR);
  const symToChar = new Int32Array(N_CHAR + 1);
  const symFreq = new Int32Array(N_CHAR + 1);
  const symCum = new Int32Array(N_CHAR + 1);
  for (let sym = N_CHAR; sym >= 1; sym--) {
    charToSym[sym - 1] = sym;
    symToChar[sym] = sym - 1;
    symFreq[sym] = 1;
    symCum[sym - 1] = symCum[sym] + 1;
  }
  const posCum = POSITION_CUM;

  let value = 0;
  for (let i = 0; i < M + 2; i++) value = 2 * value + getBit();
  let low = 0;
  let high = Q4;

  const updateModel = (sym: number) => {
    if (symCum[0] >= MAX_CUM) {
      let c = 0;
      for (let i = N_CHAR; i >= 1; i--) {
        symCum[i] = c;
        symFreq[i] = (symFreq[i] + 1) >> 1;
        c += symFreq[i];
      }
      symCum[0] = c;
    }
    let i = sym;
    while (symFreq[i] === symFreq[i - 1]) i--;
    if (i < sym) {
      const chI = symToChar[i];
      const chS = symToChar[sym];
      symToChar[i] = chS;
      symToChar[sym] = chI;
      charToSym[chI] = sym;
      charToSym[chS] = i;
    }
    symFreq[i]++;
    while (--i >= 0) symCum[i]++;
  };
  const renormalise = () => {
    for (;;) {
      if (low >= Q2) {
        value -= Q2;
        low -= Q2;
        high -= Q2;
      } else if (low >= Q1 && high <= Q3) {
        value -= Q1;
        low -= Q1;
        high -= Q1;
      } else if (high > Q2) {
        break;
      }
      low += low;
      high += high;
      value = 2 * value + getBit();
    }
  };
  // Products stay far below 2^53 (range <= 2^17, cumulative counts < 2^15).
  const decodeChar = () => {
    const range = high - low;
    const x = Math.floor(((value - low + 1) * symCum[0] - 1) / range);
    let i = 1;
    let j = N_CHAR;
    while (i < j) {
      const k = (i + j) >> 1;
      if (symCum[k] > x) i = k + 1;
      else j = k;
    }
    high = low + Math.floor((range * symCum[i - 1]) / symCum[0]);
    low += Math.floor((range * symCum[i]) / symCum[0]);
    renormalise();
    const c = symToChar[i];
    updateModel(i);
    return c;
  };
  const decodePosition = () => {
    const range = high - low;
    const x = Math.floor(((value - low + 1) * posCum[0] - 1) / range);
    let i = 1;
    let j = N;
    while (i < j) {
      const k = (i + j) >> 1;
      if (posCum[k] > x) i = k + 1;
      else j = k;
    }
    const p = i - 1;
    high = low + Math.floor((range * posCum[p]) / posCum[0]);
    low += Math.floor((range * posCum[p + 1]) / posCum[0]);
    renormalise();
    return p;
  };

  const text = new Uint8Array(N).fill(0x20, 0, N - F);
  // The size is only checked between tokens, so the last match may run a little past it.
  const out = new Uint8Array(size + F);
  let r = N - F;
  let count = 0;
  while (count < size) {
    const c = decodeChar();
    if (c < 256) {
      out[count++] = c;
      text[r] = c;
      r = (r + 1) & (N - 1);
    } else {
      const from = (r - decodePosition() - 1) & (N - 1);
      const len = c - 255 + THRESHOLD;
      for (let k = 0; k < len; k++) {
        const b = text[(from + k) & (N - 1)];
        out[count++] = b;
        text[r] = b;
        r = (r + 1) & (N - 1);
      }
    }
  }
  return out.subarray(0, size);
}
