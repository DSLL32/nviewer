/* Compile: cc -std=c11 -O2 -Wall -Wextra -Werror codecs/test.c codecs/mio0.c codecs/yaz0.c codecs/yay0.c -o codec-test */
#include <assert.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef int codec_fn(const uint8_t *, size_t, uint8_t *, size_t, size_t *);
int mio0_decode(const uint8_t *, size_t, uint8_t *, size_t, size_t *);
int mio0_encode(const uint8_t *, size_t, uint8_t *, size_t, size_t *);
int yaz0_decode(const uint8_t *, size_t, uint8_t *, size_t, size_t *);
int yaz0_encode(const uint8_t *, size_t, uint8_t *, size_t, size_t *);
int yay0_decode(const uint8_t *, size_t, uint8_t *, size_t, size_t *);
int yay0_encode(const uint8_t *, size_t, uint8_t *, size_t, size_t *);

static void roundtrip(codec_fn *encode, codec_fn *decode) {
    uint8_t input[8192], compressed[16384], output[8192];
    for (size_t size = 0; size <= sizeof input; size += size < 64 ? 1 : 127) {
        for (size_t i = 0; i < size; i++)
            input[i] = (uint8_t)((i / 7 + i * 13) & 31);
        size_t packed = 0, unpacked = 0;
        assert(encode(input, size, compressed, sizeof compressed, &packed) == 0);
        assert(decode(compressed, packed, output, sizeof output, &unpacked) == 0);
        assert(unpacked == size && memcmp(input, output, size) == 0);
        if (size > 0) {
            assert(decode(compressed, packed - 1, output, sizeof output, &unpacked) == -1);
            assert(decode(compressed, packed, output, size - 1, &unpacked) == -1);
        }
    }
}

int main(void) {
    roundtrip(mio0_encode, mio0_decode);
    roundtrip(yaz0_encode, yaz0_decode);
    roundtrip(yay0_encode, yay0_decode);
    puts("MIO0, Yaz0, and Yay0 round trips passed");
    return 0;
}
