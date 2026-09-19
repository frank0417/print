#include "sentinel.h"

#include <chrono>

namespace printkit {

namespace {
const char kScheme[] = "chrome-extension://";
}

std::string extensionIdFromOrigin(const std::string& origin) {
  const size_t schemeLen = sizeof(kScheme) - 1;
  if (origin.compare(0, schemeLen, kScheme) != 0) return "";
  std::string id = origin.substr(schemeLen);
  while (!id.empty() && (id.back() == '/' || id.back() == '\r' || id.back() == '\n')) {
    id.pop_back();
  }
  return id;
}

SentinelVerdict checkCaller(const std::vector<std::string>& argv,
                            const std::vector<std::string>& allowedIds) {
  const auto t0 = std::chrono::steady_clock::now();
  SentinelVerdict verdict;

  std::string id;
  for (const std::string& arg : argv) {
    id = extensionIdFromOrigin(arg);
    if (!id.empty()) break;
  }
  verdict.origin = id;

  if (id.empty()) {
    // No extension origin at all: direct CLI invocation (self-test), allow.
    verdict.allowed = true;
  } else {
    for (const std::string& allowed : allowedIds) {
      if (id == allowed) {
        verdict.allowed = true;
        break;
      }
    }
  }

  verdict.elapsedMs =
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  return verdict;
}

const std::vector<std::string>& defaultAllowedIds() {
  static const std::vector<std::string> ids = {
      "memmopnlapcegennpipheiadaonehljd",  // PrintKit extension (fixed key)
  };
  return ids;
}

}  // namespace printkit
