// Compression used by the Shadows of the Empire boot loader. The two scene
// codecs are distinct: scene 0 has an absolute-position LZSS ring, while the
// other scenes use adaptive-Huffman symbols and a fixed position code.

const SYMBOLS = 314;
const NODES = SYMBOLS * 2 - 1;
const ROOT = NODES - 1;

class Bits {
  private at = 0;

  constructor(private readonly data: Uint8Array) {}

  bit(): number {
    if (this.at >= this.data.length * 8) throw new Error('Shadows LZHUF input ended early');
    const value = (this.data[this.at >>> 3] >>> (7 - (this.at & 7))) & 1;
    this.at++;
    return value;
  }

  byte(): number {
    let value = 0;
    for (let i = 0; i < 8; i++) value = (value << 1) | this.bit();
    return value;
  }
}

class Tree {
  private readonly frequency = new Uint16Array(NODES + 1);
  private readonly child = new Uint16Array(NODES);
  private readonly parent = new Uint16Array(NODES + SYMBOLS);

  constructor() {
    for (let i = 0; i < SYMBOLS; i++) {
      this.frequency[i] = 1;
      this.child[i] = i + NODES;
      this.parent[i + NODES] = i;
    }
    for (let i = SYMBOLS, j = 0; i < NODES; i++, j += 2) {
      this.frequency[i] = this.frequency[j] + this.frequency[j + 1];
      this.child[i] = j;
      this.parent[j] = this.parent[j + 1] = i;
    }
    this.frequency[NODES] = 0xffff;
  }

  private reconstruct(): void {
    let leaves = 0;
    for (let i = 0; i < NODES; i++) {
      if (this.child[i] < NODES) continue;
      this.frequency[leaves] = (this.frequency[i] + 1) >>> 1;
      this.child[leaves++] = this.child[i];
    }
    if (leaves !== SYMBOLS) throw new Error('invalid Shadows LZHUF tree');
    for (let j = SYMBOLS; j < NODES; j++) {
      const pair = (j - SYMBOLS) * 2;
      const value = this.frequency[pair] + this.frequency[pair + 1];
      let k = j - 1;
      while (value < this.frequency[k]) k--;
      k++;
      for (let x = j; x > k; x--) {
        this.frequency[x] = this.frequency[x - 1];
        this.child[x] = this.child[x - 1];
      }
      this.frequency[k] = value;
      this.child[k] = pair;
    }
    for (let i = 0; i < NODES; i++) {
      const next = this.child[i];
      this.parent[next] = i;
      if (next < NODES) this.parent[next + 1] = i;
    }
  }

  symbol(bits: Bits): number {
    let node = this.child[ROOT];
    while (node < NODES) node = this.child[node + bits.bit()];
    const value = node - NODES;
    if (this.frequency[ROOT] === 0x8000) this.reconstruct();
    let current = this.parent[node];
    while (true) {
      this.frequency[current]++;
      const frequency = this.frequency[current];
      let other = current + 1;
      if (frequency > this.frequency[other]) {
        while (frequency > this.frequency[other + 1]) other++;
        this.frequency[current] = this.frequency[other];
        this.frequency[other] = frequency;
        const a = this.child[current];
        this.parent[a] = other;
        if (a < NODES) this.parent[a + 1] = other;
        const b = this.child[other];
        this.child[other] = a;
        this.parent[b] = current;
        if (b < NODES) this.parent[b + 1] = current;
        this.child[current] = b;
        current = other;
      }
      current = this.parent[current];
      if (current === 0) break;
    }
    return value;
  }
}

const be32 = (data: Uint8Array, at: number) =>
  ((data[at] * 0x1000000) + (data[at + 1] << 16) + (data[at + 2] << 8) + data[at + 3]) >>> 0;

export function decodeLzhuf(block: Uint8Array, positionCode: Uint8Array, positionLength: Uint8Array): Uint8Array {
  if (block.length < 5 || positionCode.length !== 256 || positionLength.length !== 256)
    throw new Error('invalid Shadows LZHUF input or position tables');
  const size = be32(block, 0);
  if (size < 0x50 || size > 0x2000000) throw new Error(`invalid Shadows LZHUF decoded size ${size}`);
  const output = new Uint8Array(size);
  const bits = new Bits(block.subarray(4));
  const tree = new Tree();
  let at = 0;
  while (at < size) {
    const symbol = tree.symbol(bits);
    if (symbol < 256) {
      output[at++] = symbol;
      continue;
    }
    let prefix = bits.byte();
    let distance = positionCode[prefix] << 6;
    const extra = positionLength[prefix] - 2;
    if (extra < 0 || extra > 8) throw new Error('invalid Shadows LZHUF position code');
    for (let i = 0; i < extra; i++) prefix = (prefix << 1) | bits.bit();
    distance |= prefix & 63;
    // The final match can extend beyond the declared output length; the boot
    // decoder stops copying once the destination reaches that length.
    const count = Math.min(symbol - 253, size - at);
    for (let i = 0; i < count; i++) {
      const source = at - distance - 1;
      output[at++] = source < 0 ? 0x20 : output[source];
    }
  }
  return output;
}

export function decodeIntroLzss(block: Uint8Array): Uint8Array {
  const ring = new Uint8Array(4096);
  let output = new Uint8Array(0x40000);
  let at = 0, read = 0, write = 1;
  const append = (value: number) => {
    if (at === output.length) {
      if (output.length >= 0x2000000) throw new Error('Shadows intro exceeds decoded size limit');
      const grown = new Uint8Array(output.length * 2);
      grown.set(output);
      output = grown;
    }
    output[at++] = value;
    ring[write] = value;
    write = (write + 1) & 0xfff;
  };
  while (read < block.length) {
    const flags = block[read++];
    for (let bit = 0; bit < 8; bit++) {
      if (flags & (1 << bit)) {
        if (read >= block.length) throw new Error('Shadows intro literal is truncated');
        append(block[read++]);
      } else {
        if (read + 2 > block.length) throw new Error('Shadows intro match is truncated');
        const first = block[read++], second = block[read++];
        const position = ((first & 15) << 8) | second;
        if (!position) return output.slice(0, at);
        for (let i = 0, count = (first >>> 4) + 2; i < count; i++) append(ring[(position + i) & 0xfff]);
      }
    }
  }
  throw new Error('Shadows intro has no end marker');
}
