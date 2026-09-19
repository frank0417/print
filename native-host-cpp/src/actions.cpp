#include "actions.h"

#include <QCoreApplication>
#include <QJsonArray>
#include <QPrinterInfo>
#include <QSysInfo>

#include "job.h"
#include "render.h"
#include "version.h"

namespace printkit {

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
    const PrintJob job = parsePrintJob(request.value(QLatin1String("payload")).toObject());
    const RenderResult res = renderAndPrint(job);
    reply.insert(QLatin1String("ok"), res.ok);
    if (res.ok) {
      reply.insert(QLatin1String("printer"), res.printer);
      reply.insert(QLatin1String("method"), res.method);
      reply.insert(QLatin1String("copies"), res.copies);
      reply.insert(QLatin1String("renderMs"), res.renderMs);
      reply.insert(QLatin1String("version"), QLatin1String(kHostVersion));
    } else {
      reply.insert(QLatin1String("error"), res.error);
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
