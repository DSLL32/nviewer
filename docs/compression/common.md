# Shared match index

The C++ encoders share a hash-chain index for candidate back-references. The
template takes a two- or three-byte hash policy, an index type, and an optional
power-of-two link ring. It supports incremental insertion; the full-input
variant can also be prebuilt. Each codec still sets its legal window and search
depth, compares match bytes, and chooses its own token sequence and bitstream.

The full-input variant allocates one link per byte; ring-backed variants use a
fixed array. The index does not perform entropy coding or inspect game-specific
containers. Its source is [codecs/common/hash_chain.hpp](https://github.com/DSLL32/nviewer/blob/master/codecs/common/hash_chain.hpp).

<<< ../../codecs/common/hash_chain.hpp{cpp}
