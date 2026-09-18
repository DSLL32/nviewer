# Boss tracker pattern LZ/RLE

[Stunt Racer 64](../STUNTRACER64.md) stores each song's decoded tracker-pattern
bytes in this container. Fourteen song payloads use the format.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `rawSize` | Exact decoded size. |
| `0x04` | 4 | `u32` | `packedSize` | Stream length, including its mode byte but not this header. |
| `0x08` | `packedSize` | `u8[]` | `stream` | Pattern bytes encoded as below. |

The stream begins with a one-byte mode. `0x80` copies the remaining bytes
without compression. All 14 retail streams use `0x40`, which selects the
compressed path; the decoder branches only on `0x80`. The compressed path
begins with a big-endian 16-bit control word after the mode byte. Its bits are
consumed most-significant first. A zero bit consumes one literal byte. A one
bit consumes a match or run token:

| Token bytes | Bits | Field | Meaning |
|---:|---|---|---|
| `0`–`1` | `[15:4]` | `distance` | Nonzero 12-bit backward distance, 1–4095; zero selects a run. |
| `0`–`1` | `[3:0]` | `lengthCode` | For a match, copy `lengthCode + 3` bytes, allowing overlap. |
| `2` | `[7:0]` | `runLengthLow` | If `distance == 0`, combines with `lengthCode` as a 12-bit count. |
| `3` | `[7:0]` | `value` | If `distance == 0`, repeat this byte `(lengthCode << 8) + runLengthLow + 16` times. |

After 16 tokens, the next two stream bytes are another big-endian control word.
The stream ends at `packedSize`; unused bits in its final control word are
ignored. There is no end token. The decoded output must equal `rawSize`.

The C++17 reference decoder validates bounds, distances and decoded length.
The encoder searches the available 4095-byte history and uses shortest-path
parsing with exact two-byte control-word costs. It considers all match lengths
3–18 and selected run lengths through 4111; the run-length selection means
global optimality is not claimed. It emits an uncompressed stream when that is
shorter. On the USA revision-0 ROM, all 14 retail streams decode and all 14
re-encoded streams reproduce their decoded bytes with an independent decoder.

| Sample | Decoded | Retail stream | Reference stream | Encoder time |
|---|---:|---:|---:|---:|
| Largest retail, song 5 at ROM `0xBC4238` | 34,240 | 9,883 | 5,791 | ≈0.20 s |
| All 14 songs | 309,984 | 78,155 | 49,784 | — |

Sizes exclude the eight-byte container header and alignment padding. The
largest sample's reference stream is 41.4% smaller than retail. Encoding time
is below two seconds per 10 KiB of output.

## Reference source

<<< ../../codecs/boss_pattern.cpp{cpp}
