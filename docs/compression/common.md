# Shared encoder components

The C++ encoders share a hash-chain index for candidate back-references. The
template takes a two- or three-byte hash policy, an index type, and an optional
power-of-two link ring. It supports incremental insertion; the full-input
variant can also be prebuilt. Codecs with distinct match rules still set their
own legal window, search depth, token sequence, and bitstream.

The full-input variant allocates one link per byte; ring-backed variants use a
fixed array. The index does not perform entropy coding or inspect game-specific
containers. Its source is [codecs/common/hash_chain.hpp](https://github.com/DSLL32/nviewer/blob/master/codecs/common/hash_chain.hpp).

[Longest-match search](https://github.com/DSLL32/nviewer/blob/master/codecs/common/longest_match.hpp)
is shared by MIO0, Yaz0, Yay0, and SMSR00/CMPR. Their 4 KiB distance
window and equal-cost match prefixes make the same search valid; stream
layouts remain format-specific.

Yaz0 and Yay0 additionally share an [exact phase-aware parser](https://github.com/DSLL32/nviewer/blob/master/codecs/common/yaz_yay_parse.hpp).
Its parameters are the number of control bits per group and the group's byte
cost. RNC method 2 and ERZ2 share a [token writer and match bit-cost model](https://github.com/DSLL32/nviewer/blob/master/codecs/common/rnc2_tokens.hpp),
but retain separate headers, stream starts, match enumeration, and decoders.

<<< ../../codecs/common/hash_chain.hpp{cpp}
