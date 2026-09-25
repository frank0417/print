// Compose the print HTML document from mapped DIV pages. Pure C++ string
// building (no Qt) so layout rules are unit-testable; the CSS mirrors the
// preview window and the legacy Node host so 预览 == 出纸.
#pragma once

#include <string>
#include <vector>

#include "paper.h"

namespace printkit {

struct PageHtml {
  std::string id;    // mapped DIV id, e.g. "page1"
  std::string html;  // outerHTML snapshot
};

struct Stylesheet {
  bool inlineCss = false;  // true → css holds <style> body, false → href link
  std::string css;
  std::string href;
};

std::string escapeHtml(const std::string& in);

// Build the standalone document: @page box, per-page section, mm offset
// translate, content scale zoom. Margins are applied as page padding.
std::string buildHtmlDocument(const std::string& title,
                              const std::vector<PageHtml>& pages,
                              const std::vector<Stylesheet>& stylesheets,
                              const JobSettings& settings);

}  // namespace printkit
