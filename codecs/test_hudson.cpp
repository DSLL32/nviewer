/* Compile: c++ -std=c++17 -O2 -Wall -Wextra -Werror codecs/test_hudson.cpp -o codec-hudson-test */
#include "hudson_lzss.hpp"
#include <cassert>
#include <cstdio>
#include <cstring>

template<unsigned Bits> void roundtrip() {
    uint8_t input[8192], compressed[16384], output[8192];
    for (size_t size = 1; size <= sizeof input; size += size < 64 ? 1 : 127) {
        for (size_t i = 0; i < size; i++) input[i] = (i / 7 + i * 13) & 31;
        size_t packed = 0, unpacked = 0;
        assert(hudson_encode<Bits>(input, size, compressed, sizeof compressed, &packed) == 0);
        assert(hudson_decode<Bits>(compressed, packed, output, sizeof output, &unpacked, size) == 0);
        assert(unpacked == size && std::memcmp(input, output, size) == 0);
        assert(hudson_decode<Bits>(compressed, packed, output, sizeof output, &unpacked) == 0);
        assert(unpacked == size && std::memcmp(input, output, size) == 0);
    }
}

int main() {
    roundtrip<4>(); roundtrip<6>();
    std::puts("Hudson LZSS parameterized round trips passed");
}
