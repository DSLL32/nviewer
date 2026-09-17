# EDL

[007: The World Is Not Enough](../WORLDISNOTENOUGH.md) stores EDL streams in
its model and level archive. The codec has three methods: stored data (0),
block Huffman LZ (1), and fixed-code LZ (2). Retail USA and Europe use methods
1 and 2; the executable also implements method 0.

## Header

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 3 | char[3] | `magic` | ASCII `EDL`. |
| `0x03` | 1 | u8 | `flags` | Low seven bits select method 0, 1, or 2. Bit 7 selects big-endian size fields when set, little-endian when clear. |
| `0x04` | 4 | u32 | `compressedSize` | Entire stream size, including this 12-byte header. |
| `0x08` | 4 | u32 | `decodedSize` | Number of output bytes. |
| `0x0C` | variable | u8[] | `payload` | Method-specific data; ends at `compressedSize`. |

All catalogued retail streams set bit 7. Methods 1 and 2 read the payload as
big-endian 32-bit words, consuming the **least significant bit first** within
each word. An `n`-bit integer is assembled from its bits in read order,
least-significant bit first. The last word may contain unused padding bits.
Method 0 copies `decodedSize` bytes from `+0x0C` without a bitstream.
Every catalogued USA and European EDL header begins at a ROM offset divisible
by four, but not necessarily by sixteen. `compressedSize` includes the
whole-word padding, so no additional per-stream alignment is needed when
comparing encoded sizes.

## Method 1: block Huffman LZ

A stream consists of blocks. Each block begins with a one-bit kind. Kind 0 is
a stored run: a 15-bit byte count followed by that many eight-bit bytes. Kind
1 supplies or reuses two canonical Huffman tables, then Huffman-coded literals
and matches. A one-bit flag after every block ends the stream when set;
otherwise another block follows.

For each Huffman block, the literal/length table precedes the distance table.
Each table starts with a nine-bit symbol count `n`. Zero retains that table
from the preceding block. Otherwise, for each symbol `0..n−1`, read a one-bit
update flag. If set, read a new four-bit code length; if clear, reuse the last
code length. The last length begins at zero and persists across both tables
and all blocks. Length zero leaves a symbol unused. Nonzero codes are canonical
by `(code length, symbol number)`; the first extracted bit of a code is its
most significant bit.

| Literal/length symbol | Meaning |
|---:|---|
| `0..255` | Emit the corresponding byte. |
| `256` | End the Huffman block. |
| `257..285` | Copy `3 + lengthBase[s−257] + extraBits(lengthExtra[s−257])` bytes. Read a distance symbol and copy from `1 + distanceBase[d] + extraBits(distanceExtra[d])` bytes before the current output. |

The base and extra-bit arrays, in symbol order, are:

```text
lengthBase:  0,1,2,3,4,5,6,7,8,10,12,14,16,20,24,28,32,40,48,
             56,64,80,96,112,128,160,192,224,255
lengthExtra: 0×8, 1×4, 2×4, 3×4, 4×4, 5×4, 0
distanceBase: 0,1,2,3,4,6,8,12,16,24,32,48,64,96,128,192,256,
              384,512,768,1024,1536,2048,3072,4096,6144,8192,
              12288,16384,24576
distanceExtra: 0×4, 1×2, 2×2, ... , 13×2
```

The maximum distance is 32 KiB. Copies may overlap their source bytes.

## Method 2: fixed-code LZ

The following bit patterns are in **read order**, not numerical bit order.
`b8` means an eight-bit integer or byte; `D` is the distance code below.

| Prefix and fields | Meaning |
|---|---|
| `0 b8` | One literal byte. |
| `1 1 0 b8` | Copy two bytes from distance `b8 + 1`. |
| `1 1 1 0 D` | Copy three bytes. |
| `1 0 x 0 D` | Copy `4 + x` bytes. |
| `1 0 x 1 y D` | Copy `2(3 + x) + y` bytes when the result is 6, 7, or 8. |
| `1 0 1 1 1 b4 [b8 × (12 + 4b4)]` | Emit a raw run of 12, 16, …, 72 bytes. |
| `1 1 1 1 b8 D` | If `b8` is nonzero, copy `b8 + 8` bytes (9..263). |
| `1 1 1 1 0x00` | End of stream; no distance follows. |

`D` always ends in an eight-bit low distance field `lo`. The prefix selects
the high byte `hi`, and the distance is `(hi << 8) + lo + 1`:

| Distance prefix (read order) | `hi` |
|---|---:|
| `0` | 0 |
| `1 1 0` | 1 |
| `1 0 0 c` | `2 + c` |
| `1 a 1 c 1` | `4 + 2a + c` |
| `1 a 1 c 0 d` | `2(4 + 2a + c) + d` |

Thus method 2 reaches back at most 4 KiB. Copies may overlap. The raw-run
escape is selected by the otherwise reserved length-nine pattern; it is not
a match.

## Reference codec and validation

The [C++17 reference](https://github.com/DSLL32/nviewer/blob/master/codecs/edl.cpp)
decodes methods 0, 1, and 2 with input/output bounds checks. Its encoder
chooses the smallest complete representation it produces: stored method 0,
Huffman/LZ method 1, or fixed-code LZ method 2. It searches prior matches,
then evaluates literal, match, and (for method 2) raw-run costs. Method 1
constructs canonical trees and considers whole-stream, 4 KiB, and 16 KiB
Huffman blocks. There is no compression-level setting. The encoder does not
attempt to reproduce a particular retail byte sequence.

`edl_decode` takes source and destination capacities and reports decoded and
consumed sizes separately. `edl_encode` takes source and destination capacities
and reports the complete encoded size. Both return zero on success and `-1`
on malformed input or insufficient destination capacity. The decoder uses
fixed-size Huffman tables; the encoder allocates match/parse state proportional
to the input size.

The entire EDL corpus in the USA release has 696 method-1 and 10,498 method-2
streams; the European release has 697 and 10,498, respectively. All 22,389
retail streams decode to their declared size and consume their declared
compressed size in whole bitstream words. Each round-trips through the
reference encoder and independently verified Python and TypeScript decoders;
every re-encoded stream is at or below its retail compressed size. The
encoder may choose a different method from the retail stream.

## Reference source

<<< ../../codecs/edl.cpp{cpp}
