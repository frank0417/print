// Chrome Native Messaging framing: uint32 little-endian length + UTF-8 JSON.
// Pure C++ (no Qt) so the protocol layer is unit-testable with a bare g++.
#pragma once

#include <cstdint>
#include <cstdio>
#include <string>

namespace printkit {

// Chrome caps a single native message at 64 MB host→browser, 4 GB browser→host;
// we clamp both directions to 64 MB.
constexpr uint32_t kMaxMessageBytes = 64u * 1024u * 1024u;

// Encode 4-byte little-endian length header for a payload.
void encodeLength(uint32_t length, unsigned char out[4]);

// Decode 4-byte little-endian length header.
uint32_t decodeLength(const unsigned char in[4]);

// Read one framed message from a stdio stream. Returns false on EOF or
// oversized/short frame. `raw` receives the JSON body (not the header).
bool readMessage(std::FILE* in, std::string& raw);

// Write one framed message. Returns false on I/O error.
bool writeMessage(std::FILE* out, const std::string& raw);

// Put stdin/stdout into binary mode (no-op outside Windows).
void setBinaryStdio();

}  // namespace printkit
