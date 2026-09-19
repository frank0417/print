#include "render.h"

#include <QElapsedTimer>
#include <QEventLoop>
#include <QPageLayout>
#include <QPageSize>
#include <QPainter>
#include <QPrinter>
#include <QPrinterInfo>
#include <QTimer>
#include <QWebFrame>
#include <QWebPage>
#include <QWebSettings>

#include "htmldoc.h"

namespace printkit {

namespace {

constexpr int kLoadTimeoutMs = 30000;
// Extra settle time for webfonts/images after loadFinished.
constexpr int kSettleMs = 150;

QString stdToQ(const std::string& s) {
  return QString::fromUtf8(s.data(), static_cast<int>(s.size()));
}

bool waitForLoad(QWebPage& page, const QString& html) {
  QEventLoop loop;
  bool loaded = false;
  bool result = false;
  QObject::connect(&page, &QWebPage::loadFinished, &loop, [&](bool ok) {
    loaded = true;
    result = ok;
    loop.quit();
  });
  QTimer::singleShot(kLoadTimeoutMs, &loop, [&loop] { loop.quit(); });
  page.mainFrame()->setHtml(html);
  if (!loaded) loop.exec();
  if (!loaded || !result) return false;

  QEventLoop settle;
  QTimer::singleShot(kSettleMs, &settle, [&settle] { settle.quit(); });
  settle.exec();
  return true;
}

}  // namespace

RenderResult renderAndPrint(const PrintJob& job, const QString& pdfOutPath) {
  RenderResult out;
  QElapsedTimer timer;
  timer.start();

  if (job.pages.empty()) {
    out.error = QStringLiteral("没有可打印的页面内容（DIV ID 映射为空）");
    return out;
  }

  const PaperBox paper = resolvePaper(job.settings);
  const bool landscape = paper.widthMm > paper.heightMm;
  const double shortMm = landscape ? paper.heightMm : paper.widthMm;
  const double longMm = landscape ? paper.widthMm : paper.heightMm;

  QPrinter printer(QPrinter::HighResolution);
  if (!pdfOutPath.isEmpty()) {
    printer.setOutputFormat(QPrinter::PdfFormat);
    printer.setOutputFileName(pdfOutPath);
    out.printer = pdfOutPath;
    out.method = QStringLiteral("qtwebkit-pdf");
  } else {
    const QString wanted = stdToQ(job.settings.printer);
    if (!wanted.isEmpty()) {
      const QPrinterInfo info = QPrinterInfo::printerInfo(wanted);
      if (info.isNull()) {
        out.error = QStringLiteral("打印机不存在: %1").arg(wanted);
        return out;
      }
      printer.setPrinterName(wanted);
      out.printer = wanted;
    } else {
      const QPrinterInfo def = QPrinterInfo::defaultPrinter();
      if (def.isNull()) {
        out.error = QStringLiteral("系统没有默认打印机，且未指定 settings.printer");
        return out;
      }
      printer.setPrinterName(def.printerName());
      out.printer = def.printerName();
    }
    out.method = QStringLiteral("qtwebkit-qpainter");
  }

  QPageLayout layout(QPageSize(QSizeF(shortMm, longMm), QPageSize::Millimeter,
                               QString(), QPageSize::FuzzyOrientationMatch),
                     landscape ? QPageLayout::Landscape : QPageLayout::Portrait,
                     QMarginsF(0, 0, 0, 0), QPageLayout::Millimeter);
  printer.setPageLayout(layout);
  printer.setFullPage(true);
  printer.setCopyCount(std::max(1, job.settings.copies));
  out.copies = printer.copyCount();

  const std::string html =
      buildHtmlDocument(job.title.toStdString(), job.pages, job.stylesheets, job.settings);

  // Long-lived host: keep WebKit's global caches from creeping between jobs.
  // Print jobs rarely reuse resources, so a page/object cache is pure growth.
  QWebSettings::globalSettings()->setMaximumPagesInCache(0);
  QWebSettings::globalSettings()->setObjectCacheCapacities(0, 0, 2 * 1024 * 1024);

  QWebPage page;
  page.settings()->setAttribute(QWebSettings::JavascriptEnabled, false);
  page.settings()->setAttribute(QWebSettings::PrintElementBackgrounds, true);
  page.settings()->setAttribute(QWebSettings::AutoLoadImages, true);
  page.mainFrame()->setScrollBarPolicy(Qt::Horizontal, Qt::ScrollBarAlwaysOff);
  page.mainFrame()->setScrollBarPolicy(Qt::Vertical, Qt::ScrollBarAlwaysOff);

  // Layout in CSS reference px (96/in), one .pk-page per sheet stacked
  // vertically. htmldoc emits page geometry in the same px, so layout is
  // identical on every platform regardless of screen/printer DPI.
  const int nPages = static_cast<int>(job.pages.size());
  const int pageWpx = qRound(paper.widthMm * 96.0 / 25.4);
  const int pageHpx = qRound(paper.heightMm * 96.0 / 25.4);
  page.setViewportSize(QSize(pageWpx, pageHpx * nPages));

  if (!waitForLoad(page, QString::fromUtf8(html.c_str()))) {
    out.error = QStringLiteral("HTML 渲染失败或超时");
    return out;
  }

  // Paint each sheet ourselves instead of QWebFrame::print(): we control the
  // css-px → device-px transform explicitly, so no engine DPI heuristic can
  // rescale the output (预览与出纸差一个像素都算我们输).
  QPainter painter;
  if (!painter.begin(&printer)) {
    out.error = QStringLiteral("无法打开打印设备: %1").arg(out.printer);
    return out;
  }
  painter.setRenderHint(QPainter::Antialiasing, true);
  painter.setRenderHint(QPainter::TextAntialiasing, true);
  painter.setRenderHint(QPainter::SmoothPixmapTransform, true);

  const QRectF deviceRect = printer.pageRect(QPrinter::DevicePixel);
  const qreal scaleToDevice = deviceRect.width() / static_cast<qreal>(pageWpx);
  // Drivers that cannot do copies in hardware get manual repeats (PDF: never).
  const int repeats =
      (pdfOutPath.isEmpty() && !printer.supportsMultipleCopies())
          ? std::max(1, job.settings.copies)
          : 1;

  bool firstSheet = true;
  for (int copy = 0; copy < repeats; ++copy) {
    for (int i = 0; i < nPages; ++i) {
      if (!firstSheet) printer.newPage();
      firstSheet = false;
      painter.save();
      painter.scale(scaleToDevice, scaleToDevice);
      painter.translate(0, -static_cast<qreal>(i) * pageHpx);
      page.mainFrame()->render(&painter,
                               QRegion(0, i * pageHpx, pageWpx, pageHpx));
      painter.restore();
    }
  }
  painter.end();

  // Release decoded images / fonts / parsed sheets before the next job.
  QWebSettings::clearMemoryCaches();

  out.ok = true;
  out.renderMs = static_cast<double>(timer.elapsed());
  return out;
}

}  // namespace printkit
