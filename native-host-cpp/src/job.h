// Parse the extension's `print` payload (QJson) into render inputs.
#pragma once

#include <QJsonObject>
#include <QString>

#include <vector>

#include "htmldoc.h"
#include "paper.h"

namespace printkit {

struct PrintJob {
  QString title;
  std::vector<PageHtml> pages;
  std::vector<Stylesheet> stylesheets;
  JobSettings settings;
};

// payload = { title, pages: [{id, html}], stylesheets: [{type, css|href}], settings: {...} }
PrintJob parsePrintJob(const QJsonObject& payload);

}  // namespace printkit
