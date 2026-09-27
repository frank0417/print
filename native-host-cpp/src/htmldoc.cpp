#include "htmldoc.h"

#include <cmath>
#include <sstream>

namespace printkit {

namespace {

// CSS reference pixel: exactly 96 px/inch, independent of any platform DPI.
// Emitting page geometry in px (converted here) instead of mm keeps the
// engine's own mm↔px mapping out of the pipeline — the #1 cause of 跑版.
double mmToPx(double mm) {
  return std::round(mm * 96.0 / 25.4 * 100.0) / 100.0;
}

}  // namespace

std::string escapeHtml(const std::string& in) {
  std::string out;
  out.reserve(in.size());
  for (char c : in) {
    switch (c) {
      case '&': out += "&amp;"; break;
      case '<': out += "&lt;"; break;
      case '>': out += "&gt;"; break;
      case '"': out += "&quot;"; break;
      default: out += c;
    }
  }
  return out;
}

std::string buildHtmlDocument(const std::string& title,
                              const std::vector<PageHtml>& pages,
                              const std::vector<Stylesheet>& stylesheets,
                              const JobSettings& settings) {
  const PaperBox paper = resolvePaper(settings);
  const double scale = clampContentScale(settings.contentScalePct) / 100.0;
  const MarginsMm& m = settings.margins;
  const OffsetMm& off = settings.offset;

  std::ostringstream style;
  for (const Stylesheet& s : stylesheets) {
    if (s.inlineCss) {
      style << "<style>" << s.css << "</style>\n";
    } else if (!s.href.empty()) {
      style << "<link rel=\"stylesheet\" href=\"" << escapeHtml(s.href) << "\" />\n";
    }
  }

  std::ostringstream body;
  int index = 1;
  for (const PageHtml& p : pages) {
    body << "<section class=\"pk-page\" data-page=\"" << index++ << "\" data-map=\""
         << escapeHtml(p.id) << "\"><div class=\"pk-fit\">" << p.html << "</div></section>\n";
  }

  std::ostringstream doc;
  doc << "<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"utf-8\" />\n<title>"
      << escapeHtml(title.empty() ? "PrintKit" : title) << "</title>\n"
      << style.str() << "<style>\n"
      << "@page { size: " << paper.widthMm << "mm " << paper.heightMm << "mm; margin: 0; }\n"
      << "html, body { margin: 0; padding: 0; background: #fff; color: #000;\n"
      << "  -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }\n"
      << ".pk-page {\n"
      << "  width: " << mmToPx(paper.widthMm) << "px;\n"
      << "  height: " << mmToPx(paper.heightMm) << "px;\n"
      << "  box-sizing: border-box;\n"
      << "  padding: " << mmToPx(m.top) << "px " << mmToPx(m.right) << "px " << mmToPx(m.bottom)
      << "px " << mmToPx(m.left) << "px;\n"
      << "  overflow: hidden;\n"
      << "  page-break-after: always;\n"
      << "  position: relative;\n"
      << "  display: block;\n"
      << "  margin: 0;\n"
      << "}\n"
      << ".pk-page:last-child { page-break-after: auto; }\n"
      << ".pk-fit {\n"
      << "  width: 100%;\n"
      << "  margin: 0;\n"
      << "  -webkit-transform: translate(" << mmToPx(off.x) << "px, " << mmToPx(off.y) << "px);\n"
      << "  transform: translate(" << mmToPx(off.x) << "px, " << mmToPx(off.y) << "px);\n"
      << "  zoom: " << scale << ";\n"
      << "}\n"
      << "img, canvas, svg { max-width: 100%; }\n"
      << "* { scrollbar-width: none !important; }\n"
      << "*::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }\n"
      << "</style>\n</head>\n<body>\n"
      << body.str() << "</body>\n</html>\n";
  return doc.str();
}

}  // namespace printkit
