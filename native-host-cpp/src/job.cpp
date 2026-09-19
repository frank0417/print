#include "job.h"

#include <QJsonArray>
#include <QJsonValue>

namespace printkit {

namespace {

double numberOr(const QJsonObject& o, const char* key, double fallback) {
  const QJsonValue v = o.value(QLatin1String(key));
  if (v.isDouble()) return v.toDouble();
  if (v.isString()) {
    bool ok = false;
    const double n = v.toString().toDouble(&ok);
    if (ok) return n;
  }
  return fallback;
}

bool truthy(const QJsonValue& v) {
  return v.toBool() || v.toInt() == 1 || v.toString() == QLatin1String("true") ||
         v.toString() == QLatin1String("1");
}

}  // namespace

PrintJob parsePrintJob(const QJsonObject& payload) {
  PrintJob job;
  job.title = payload.value(QLatin1String("title")).toString();

  for (const QJsonValue& v : payload.value(QLatin1String("pages")).toArray()) {
    PageHtml page;
    if (v.isString()) {
      page.html = v.toString().toStdString();
    } else {
      const QJsonObject o = v.toObject();
      page.id = o.value(QLatin1String("id")).toString().toStdString();
      page.html = o.value(QLatin1String("html")).toString().toStdString();
    }
    if (!page.html.empty()) job.pages.push_back(std::move(page));
  }

  for (const QJsonValue& v : payload.value(QLatin1String("stylesheets")).toArray()) {
    const QJsonObject o = v.toObject();
    Stylesheet sheet;
    const QString type = o.value(QLatin1String("type")).toString();
    if (type == QLatin1String("style")) {
      sheet.inlineCss = true;
      sheet.css = o.value(QLatin1String("css")).toString().toStdString();
      if (sheet.css.empty()) continue;
    } else {
      sheet.href = o.value(QLatin1String("href")).toString().toStdString();
      if (sheet.href.empty()) continue;
    }
    job.stylesheets.push_back(std::move(sheet));
  }

  const QJsonObject s = payload.value(QLatin1String("settings")).toObject();
  JobSettings& js = job.settings;
  js.paperName = s.value(QLatin1String("paperName")).toString().toStdString();
  js.pageWidth = numberOr(s, "pageWidth", numberOr(s, "width", 0));
  js.pageHeight = numberOr(s, "pageHeight", numberOr(s, "height", 0));
  js.orientation = static_cast<int>(numberOr(s, "orientation", 0));
  js.lockPageBox = truthy(s.value(QLatin1String("lockPageBox")));
  js.margins.top = numberOr(s, "marginTop", 0);
  js.margins.right = numberOr(s, "marginRight", 0);
  js.margins.bottom = numberOr(s, "marginBottom", 0);
  js.margins.left = numberOr(s, "marginLeft", 0);
  js.offset.x = numberOr(s, "offsetX", 0);
  js.offset.y = numberOr(s, "offsetY", 0);
  js.copies = std::max(1, static_cast<int>(numberOr(s, "copies", 1)));
  js.contentScalePct = numberOr(s, "contentScale", 100);
  QString printer = s.value(QLatin1String("printer")).toString();
  if (printer.isEmpty()) printer = s.value(QLatin1String("printerName")).toString();
  js.printer = printer.toStdString();
  return job;
}

}  // namespace printkit
