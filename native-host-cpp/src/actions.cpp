#include "actions.h"

#include <QCoreApplication>
#include <QDir>
#include <QJsonArray>
#include <QPrinterInfo>
#include <QSysInfo>

#include <deque>
#include <utility>

#include "job.h"
#include "render.h"
#include "version.h"

namespace printkit {

namespace {

// Recently completed job ids → cached success reply. A duplicate delivery of
// the same job (double-click, message re-send over the same port) returns the
// cached result instead of feeding the printer twice. Only successful prints
// are remembered so a failed job can always be retried.
constexpr size_t kMaxRememberedJobs = 32;
std::deque<std::pair<QString, QJsonObject>>& recentJobs() {
  static std::deque<std::pair<QString, QJsonObject>> jobs;
  return jobs;
}

const QJsonObject* findRecentJob(const QString& jobId) {
  if (jobId.isEmpty()) return nullptr;
  for (const auto& entry : recentJobs()) {
    if (entry.first == jobId) return &entry.second;
  }
  return nullptr;
}

void rememberJob(const QString& jobId, const QJsonObject& reply) {
  if (jobId.isEmpty()) return;
  recentJobs().emplace_back(jobId, reply);
  while (recentJobs().size() > kMaxRememberedJobs) recentJobs().pop_front();
}

}  // namespace

QJsonObject hostInfo() {
  QJsonObject info;
  info.insert(QLatin1String("ok"), true);
  info.insert(QLatin1String("version"), QLatin1String(kHostVersion));
  info.insert(QLatin1String("engine"), QLatin1String("cpp-qtwebkit"));
  info.insert(QLatin1String("qt"), QLatin1String(qVersion()));
  info.insert(QLatin1String("platform"), QSysInfo::productType());
  info.insert(QLatin1String("arch"), QSysInfo::currentCpuArchitecture());
  return info;
}

QJsonObject listPrinters() {
  QJsonArray printers;
  const QString defaultName = QPrinterInfo::defaultPrinterName();
  for (const QPrinterInfo& info : QPrinterInfo::availablePrinters()) {
    QJsonObject p;
    p.insert(QLatin1String("name"), info.printerName());
    p.insert(QLatin1String("id"), info.printerName());
    p.insert(QLatin1String("description"), info.description());
    p.insert(QLatin1String("location"), info.location());
    p.insert(QLatin1String("makeAndModel"), info.makeAndModel());
    p.insert(QLatin1String("isDefault"), info.printerName() == defaultName);
    p.insert(QLatin1String("source"), QLatin1String("cpp-host"));
    printers.append(p);
  }
  QJsonObject reply;
  reply.insert(QLatin1String("ok"), true);
  reply.insert(QLatin1String("printers"), printers);
  return reply;
}

QJsonObject handleRequest(const QJsonObject& request) {
  const QString action = request.value(QLatin1String("action")).toString();
  const QJsonValue requestId = request.value(QLatin1String("requestId"));
  QJsonObject reply;

  if (action == QLatin1String("ping") || action == QLatin1String("getHostInfo") ||
      action == QLatin1String("prewarm")) {
    reply = hostInfo();
  } else if (action == QLatin1String("getPrinters")) {
    reply = listPrinters();
  } else if (action == QLatin1String("getDefaultPrinter")) {
    const QPrinterInfo def = QPrinterInfo::defaultPrinter();
    reply.insert(QLatin1String("ok"), true);
    if (!def.isNull()) {
      reply.insert(QLatin1String("name"), def.printerName());
    }
  } else if (action == QLatin1String("print")) {
    const QJsonObject payload = request.value(QLatin1String("payload")).toObject();
    const QString jobId = payload.value(QLatin1String("jobId")).toString();

    // Optional paperless verification: render to a PDF under the temp dir
    // instead of a device (used by self-tests; path is confined to tmp).
    QString outPdf = payload.value(QLatin1String("outPdf")).toString();
    if (!outPdf.isEmpty() &&
        !QDir::cleanPath(outPdf).startsWith(QDir::cleanPath(QDir::tempPath()))) {
      outPdf.clear();
    }

    if (const QJsonObject* done = findRecentJob(jobId)) {
      reply = *done;
      reply.insert(QLatin1String("duplicate"), true);
    } else {
      const PrintJob job = parsePrintJob(payload);
      const RenderResult res = renderAndPrint(job, outPdf);
      reply.insert(QLatin1String("ok"), res.ok);
      if (res.ok) {
        reply.insert(QLatin1String("printer"), res.printer);
        reply.insert(QLatin1String("method"), res.method);
        reply.insert(QLatin1String("copies"), res.copies);
        reply.insert(QLatin1String("renderMs"), res.renderMs);
        reply.insert(QLatin1String("version"), QLatin1String(kHostVersion));
        rememberJob(jobId, reply);
      } else {
        reply.insert(QLatin1String("error"), res.error);
      }
    }
  } else {
    reply.insert(QLatin1String("ok"), false);
    reply.insert(QLatin1String("error"),
                 QStringLiteral("未知 action: %1").arg(action));
  }

  if (!requestId.isUndefined()) {
    reply.insert(QLatin1String("requestId"), requestId);
  }
  return reply;
}

}  // namespace printkit
