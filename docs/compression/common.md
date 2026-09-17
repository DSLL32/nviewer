# Bounded match search helper

The repository includes a bounded, stack-only search for repeated byte strings.
`Window`, `MaxLength`, candidate `Depth`, and optional `MaxDistance` are compile-time
parameters. `find` returns a length and backward distance; `advance` records bytes
after each emitted token. The current reference codecs do not use this helper;
they implement their own match searches.

This helper does not allocate, perform entropy coding, or inspect game-specific
containers. Its source is [codecs/common/match_finder.hpp](https://github.com/DSLL32/nviewer/blob/master/codecs/common/match_finder.hpp).

<<< ../../codecs/common/match_finder.hpp{cpp}
