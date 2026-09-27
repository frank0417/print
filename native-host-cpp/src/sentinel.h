// IP-Sentinel: millisecond-level legitimacy check of the calling browser
// extension. Chrome passes the caller as `chrome-extension://<id>/` in argv;
// anything not on the allowlist is refused before any JSON is parsed.
#pragma once

#include <string>
#include <vector>

namespace printkit {

struct SentinelVerdict {
  bool allowed = false;
  std::string origin;     // normalized extension id, e.g. "memmopn..."
  double elapsedMs = 0;   // time the check took
};

// Extract the extension id from a chrome-extension:// origin (empty if not one).
std::string extensionIdFromOrigin(const std::string& origin);

// Check argv against the allowlist. An empty argv (e.g. --cli runs) is allowed.
SentinelVerdict checkCaller(const std::vector<std::string>& argv,
                            const std::vector<std::string>& allowedIds);

// Built-in allowlist (the PrintKit extension id).
const std::vector<std::string>& defaultAllowedIds();

}  // namespace printkit
