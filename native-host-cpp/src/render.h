// QtWebKit rendering: QWebPage laid out at the exact page box, painted
// straight onto QPrinter via QWebFrame::print(). One paint pipeline, no
// intermediate PDF, no headless browser — 预览与出纸同一套矢量指令.
#pragma once

#include <QString>

#include "job.h"

namespace printkit {

struct RenderResult {
  bool ok = false;
  QString error;
  QString printer;     // resolved target printer (or output file)
  QString method;      // "qtwebkit-qprinter" / "qtwebkit-pdf"
  int copies = 1;
  double renderMs = 0;
};

// Print the job. When `pdfOutPath` is non-empty the same paint path targets a
// PDF file instead of a device — used by --cli self-tests and 无纸 验证.
RenderResult renderAndPrint(const PrintJob& job, const QString& pdfOutPath = QString());

}  // namespace printkit
