// LStb scene address space. Scene pointers are RDRAM addresses, not ROM offsets.
export class ShadowsSceneImage {
  readonly base: number;
  readonly view: DataView;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.base = this.u32(4);
    if (this.u32(0) !== 0x4c537462 || this.u32(8) - this.base !== bytes.length)
      throw new Error('invalid Shadows LStb scene');
  }

  contains(offset: number, length = 1): boolean {
    return Number.isInteger(offset) && offset >= 0 && length >= 0 && offset + length <= this.bytes.length;
  }

  offset(address: number, length = 1): number {
    const offset = address - this.base;
    if (!this.contains(offset, length)) throw new Error(`Shadows scene pointer 0x${address.toString(16)} is out of range`);
    return offset;
  }

  u8(offset: number): number { return this.view.getUint8(offset); }
  u16(offset: number): number { return this.view.getUint16(offset, false); }
  s16(offset: number): number { return this.view.getInt16(offset, false); }
  u32(offset: number): number { return this.view.getUint32(offset, false); }
  f32(offset: number): number { return this.view.getFloat32(offset, false); }
}
