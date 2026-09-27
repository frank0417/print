#include "protocol.h"

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace printkit {

void encodeLength(uint32_t length, unsigned char out[4]) {
  out[0] = static_cast<unsigned char>(length & 0xFF);
  out[1] = static_cast<unsigned char>((length >> 8) & 0xFF);
  out[2] = static_cast<unsigned char>((length >> 16) & 0xFF);
  out[3] = static_cast<unsigned char>((length >> 24) & 0xFF);
}

uint32_t decodeLength(const unsigned char in[4]) {
  return static_cast<uint32_t>(in[0]) | (static_cast<uint32_t>(in[1]) << 8) |
         (static_cast<uint32_t>(in[2]) << 16) | (static_cast<uint32_t>(in[3]) << 24);
}

bool readMessage(std::FILE* in, std::string& raw) {
  unsigned char header[4];
  if (std::fread(header, 1, 4, in) != 4) return false;
  const uint32_t length = decodeLength(header);
  if (length == 0 || length > kMaxMessageBytes) return false;
  raw.resize(length);
  size_t got = 0;
  while (got < length) {
    const size_t n = std::fread(&raw[got], 1, length - got, in);
    if (n == 0) return false;
    got += n;
  }
  return true;
}

bool writeMessage(std::FILE* out, const std::string& raw) {
  if (raw.size() > kMaxMessageBytes) return false;
  unsigned char header[4];
  encodeLength(static_cast<uint32_t>(raw.size()), header);
  if (std::fwrite(header, 1, 4, out) != 4) return false;
  if (std::fwrite(raw.data(), 1, raw.size(), out) != raw.size()) return false;
  std::fflush(out);
  return true;
}

void setBinaryStdio() {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif
}

}  // namespace printkit
