# Chunked zlib

[Stunt Racer 64](../STUNTRACER64.md) wraps independent zlib streams in a
big-endian container:

| Offset | Size | Field |
|---:|---:|---|
| `+0x00` | 4 | Complete stored size, including this header. |
| `+0x04` | 4 | Concatenated decoded size. |
| `+0x08` | Variable | Repeated blocks. |

Each block has a big-endian `u32` compressed size, that many bytes of zlib
data, and possibly one padding byte to reach an even offset. Every non-final
block expands to 16,000 bytes; the final one expands to the remainder.

The [C reference codec](https://github.com/DSLL32/nviewer/blob/master/codecs/chunked_zlib.c)
uses zlib (`-lz`) for each block. The encoder tries level 9 with the default
strategy, `memLevel` 3–8, and 4 KiB or 32 KiB windows, keeping the smallest
stream for each fixed 16,000-byte input block. Smaller token buffers can improve
DEFLATE block boundaries; shorter windows can avoid costly long-distance matches.
The original level-9, `memLevel`-8, 32 KiB-window profile remains a candidate,
so no block grows relative to the previous encoder using the same zlib version.
The encoder uses two 16 KiB stack buffers in addition to zlib's workspace.
Destination capacity is checked against the chosen stream and its padding,
allowing an exactly sized output buffer.

With zlib 1.3.1, the largest indexed container at ROM `0x3885A0` decodes to
737,520 bytes. Its **301,186-byte** retail container re-encodes to
**296,616 bytes**, saving 4,570 bytes (1.52%), versus the previous encoder's
301,204 bytes. An `-O3` benchmark took about **0.92 seconds**. These stored
sizes include the outer header, block lengths, zlib streams, and required
two-byte block alignment; they exclude any later archive alignment.

Verification covered all **2,211** indexed containers, comprising 18,951,473
decoded bytes: **672** repacks were smaller than retail, **1,539** tied it, and
none grew. Their total stored size fell from **7,737,208** to **7,653,082** bytes.
All original and re-encoded blocks decoded byte-for-byte through the viewer's
independent TypeScript raw-DEFLATE decoder, with each zlib Adler-32 checked
separately. AddressSanitizer and UndefinedBehaviorSanitizer checks cover the
corpus and 150 synthetic cases, including empty inputs, block boundaries,
incompressible data, truncated streams, and exact or insufficient output
capacity. The slowest measured corpus case used 0.46 seconds per 10 KiB of
compressed output, below the 2-second limit. These are valid repacks, not
byte-identical reproductions of the retail compressor.

## Reference source

<<< ../../codecs/chunked_zlib.c{c}
