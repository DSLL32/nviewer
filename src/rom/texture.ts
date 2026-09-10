// N64 texture decoding to RGBA8.
//
// Rush 2049 uploads textures through the RDP's tile commands: G_LOADBLOCK copies
// texels from RAM into a 4 KB texture memory, and G_SETTILE describes how a tile's
// texels are laid out there (row length "line", start offset "tmem"). Texture memory
// is organised in 64-bit words: the RDP fetches odd texel rows with the two halves of
// each word swapped, and the block load swaps them for odd rows too when its row
// counter (dxt) is set. See loadBlock() and the addressing in decodeTexture().

// RDP image formats as packed in G_SETTILE / G_SETTIMG: fmt << 21 | siz << 19.
export const enum ImFmt { RGBA = 0, YUV = 1, CI = 2, IA = 3, I = 4 }
export const enum ImSiz { B4 = 0, B8 = 1, B16 = 2, B32 = 3 }
// G_SETOTHERMODE_H TEXTLUT values.
export const enum Tlut { None = 0, Rgba16 = 2, Ia16 = 3 }

export const TMEM_SIZE = 0x1000;

// G_LOADBLOCK: copy `bytes` bytes from src[image] into texture memory at `tmem`.
// When dxt is non-zero, every 64-bit word advances a 1.11 fixed-point row counter
// and words of odd rows are stored with their halves swapped.
export function loadBlock(
  mem: Uint8Array, src: Uint8Array, image: number, bytes: number, tmem: number, dxt: number, siz: ImSiz,
) {
  const words = bytes >> 2;
  const swap = siz === ImSiz.B32 ? 2 : 1;
  for (let i = 0, row = 0; i < words; i += 2, row += dxt) {
    const sw = dxt && (row >> 11) & 1 ? swap : 0;
    for (let k = 0; k < 2 && i + k < words; k++) {
      const d = ((((tmem >> 2) + i + k) ^ sw) & 0x3ff) << 2;
      const s = image + (i + k) * 4;
      for (let b = 0; b < 4; b++) mem[d + b] = s + b < src.length ? src[s + b] : 0;
    }
  }
}

export interface TextureDesc {
  fmt: ImFmt;
  siz: ImSiz;
  width: number;
  height: number;
  mem: Uint8Array; // texture memory
  tmem: number; // tile start offset in texture memory
  line: number; // bytes per texel row
  palette: Uint8Array | null; // TLUT, 16-bit entries (CI formats)
  tlut: Tlut;
}

const ext5 = (v: number) => (v << 3) | (v >> 2);

function rgba16(v: number, out: Uint8Array, d: number) {
  out[d] = ext5((v >> 11) & 0x1f);
  out[d + 1] = ext5((v >> 6) & 0x1f);
  out[d + 2] = ext5((v >> 1) & 0x1f);
  out[d + 3] = v & 1 ? 255 : 0;
}

function ia16(v: number, out: Uint8Array, d: number) {
  out[d] = out[d + 1] = out[d + 2] = v >> 8;
  out[d + 3] = v & 0xff;
}

const BITS = [4, 8, 16, 32];

export function decodeTexture(t: TextureDesc): Uint8Array {
  const { width: w, height: h, mem } = t;
  const out = new Uint8Array(w * h * 4);
  const bits = BITS[t.siz];
  const line = t.line || Math.ceil((w * bits) / 8);
  // Odd rows are fetched with the word halves swapped (32-bit texels span two words).
  const oddXor = t.siz === ImSiz.B32 ? 8 : 4;
  const byte = (x: number, y: number, k = 0) =>
    mem[(((t.tmem + y * line + ((x * bits) >> 3)) ^ (y & 1 ? oddXor : 0)) + k) & (TMEM_SIZE - 1)];
  const word = (x: number, y: number) => (byte(x, y) << 8) | byte(x, y, 1);
  const pal = t.palette;
  const entry = (i: number) => (pal && i * 2 + 1 < pal.length ? (pal[i * 2] << 8) | pal[i * 2 + 1] : 0);
  const nibble = (x: number, y: number) => (byte(x, y) >> (x & 1 ? 0 : 4)) & 0xf;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = (y * w + x) * 4;
      switch ((t.fmt << 4) | t.siz) {
        case (ImFmt.CI << 4) | ImSiz.B4:
        case (ImFmt.CI << 4) | ImSiz.B8: {
          const v = entry(t.siz === ImSiz.B4 ? nibble(x, y) : byte(x, y));
          if (t.tlut === Tlut.Ia16) ia16(v, out, d);
          else rgba16(v, out, d);
          break;
        }
        case (ImFmt.RGBA << 4) | ImSiz.B16:
          rgba16(word(x, y), out, d);
          break;
        case (ImFmt.RGBA << 4) | ImSiz.B32:
          for (let c = 0; c < 4; c++) out[d + c] = byte(x, y, c);
          break;
        case (ImFmt.IA << 4) | ImSiz.B4: {
          const v = nibble(x, y);
          out[d] = out[d + 1] = out[d + 2] = (v >> 1) * 0x24 + (v >> 1 ? 3 : 0);
          out[d + 3] = v & 1 ? 255 : 0;
          break;
        }
        case (ImFmt.IA << 4) | ImSiz.B8: {
          const v = byte(x, y);
          out[d] = out[d + 1] = out[d + 2] = (v >> 4) * 0x11;
          out[d + 3] = (v & 0xf) * 0x11;
          break;
        }
        case (ImFmt.IA << 4) | ImSiz.B16:
          ia16(word(x, y), out, d);
          break;
        case (ImFmt.I << 4) | ImSiz.B4: {
          const v = nibble(x, y) * 0x11;
          out[d] = out[d + 1] = out[d + 2] = out[d + 3] = v;
          break;
        }
        case (ImFmt.I << 4) | ImSiz.B8: {
          const v = byte(x, y);
          out[d] = out[d + 1] = out[d + 2] = out[d + 3] = v;
          break;
        }
        default:
          // Unknown format: magenta so it stands out.
          out[d] = 255; out[d + 1] = 0; out[d + 2] = 255; out[d + 3] = 255;
      }
    }
  }
  return out;
}
