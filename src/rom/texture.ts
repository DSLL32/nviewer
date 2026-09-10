// N64 texture decoding to RGBA8.

// RDP image formats as packed in G_SETTILE: fmt << 21 | siz << 19.
export const enum ImFmt { RGBA = 0, YUV = 1, CI = 2, IA = 3, I = 4 }
export const enum ImSiz { B4 = 0, B8 = 1, B16 = 2, B32 = 3 }
// G_SETOTHERMODE_H TEXTLUT values.
export const enum Tlut { None = 0, Rgba16 = 2, Ia16 = 3 }

export interface TextureDesc {
  fmt: ImFmt;
  siz: ImSiz;
  width: number;
  height: number;
  image: number; // offset of texel data in the source buffer
  palette: number; // offset of the TLUT (CI formats), -1 if none
  tlut: Tlut;
}

const ext5 = (v: number) => (v << 3) | (v >> 2);

function rgba16(src: Uint8Array, o: number, out: Uint8Array, d: number) {
  const v = (src[o] << 8) | src[o + 1];
  out[d] = ext5((v >> 11) & 0x1f);
  out[d + 1] = ext5((v >> 6) & 0x1f);
  out[d + 2] = ext5((v >> 1) & 0x1f);
  out[d + 3] = v & 1 ? 255 : 0;
}

function ia16(src: Uint8Array, o: number, out: Uint8Array, d: number) {
  out[d] = out[d + 1] = out[d + 2] = src[o];
  out[d + 3] = src[o + 1];
}

export function decodeTexture(src: Uint8Array, t: TextureDesc): Uint8Array {
  const n = t.width * t.height;
  const out = new Uint8Array(n * 4);
  const img = t.image;
  const byte = (i: number) => (img + i < src.length ? src[img + i] : 0);
  const safe = (o: number) => o >= 0 && o + 1 < src.length;
  switch ((t.fmt << 4) | t.siz) {
    case (ImFmt.CI << 4) | ImSiz.B4:
    case (ImFmt.CI << 4) | ImSiz.B8: {
      const four = t.siz === ImSiz.B4;
      const toColor = t.tlut === Tlut.Ia16 ? ia16 : rgba16;
      for (let i = 0; i < n; i++) {
        const idx = four ? (byte(i >> 1) >> (i & 1 ? 0 : 4)) & 0xf : byte(i);
        const p = t.palette + idx * 2;
        if (safe(p)) toColor(src, p, out, i * 4);
      }
      break;
    }
    case (ImFmt.RGBA << 4) | ImSiz.B16:
      for (let i = 0; i < n; i++) if (img + i * 2 + 1 < src.length) rgba16(src, img + i * 2, out, i * 4);
      break;
    case (ImFmt.RGBA << 4) | ImSiz.B32:
      out.set(src.subarray(img, img + Math.min(n * 4, src.length - img)));
      break;
    case (ImFmt.IA << 4) | ImSiz.B4:
      for (let i = 0; i < n; i++) {
        const v = (byte(i >> 1) >> (i & 1 ? 0 : 4)) & 0xf;
        out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = ((v >> 1) & 7) * 0x24 + ((v >> 1) & 7 ? 3 : 0);
        out[i * 4 + 3] = v & 1 ? 255 : 0;
      }
      break;
    case (ImFmt.IA << 4) | ImSiz.B8:
      for (let i = 0; i < n; i++) {
        const v = byte(i);
        out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = (v >> 4) * 0x11;
        out[i * 4 + 3] = (v & 0xf) * 0x11;
      }
      break;
    case (ImFmt.IA << 4) | ImSiz.B16:
      for (let i = 0; i < n; i++) if (img + i * 2 + 1 < src.length) ia16(src, img + i * 2, out, i * 4);
      break;
    case (ImFmt.I << 4) | ImSiz.B4:
      for (let i = 0; i < n; i++) {
        const v = ((byte(i >> 1) >> (i & 1 ? 0 : 4)) & 0xf) * 0x11;
        out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = out[i * 4 + 3] = v;
      }
      break;
    case (ImFmt.I << 4) | ImSiz.B8:
      for (let i = 0; i < n; i++) {
        const v = byte(i);
        out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = out[i * 4 + 3] = v;
      }
      break;
    default:
      // Unknown format: magenta so it stands out.
      for (let i = 0; i < n; i++) out.set([255, 0, 255, 255], i * 4);
  }
  return out;
}
