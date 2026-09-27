// Dispatch one native-messaging request to its handler.
#pragma once

#include <QJsonObject>

namespace printkit {

// { action, requestId?, payload? } → reply object (always carries ok:true/false
// and echoes requestId when present).
QJsonObject handleRequest(const QJsonObject& request);

QJsonObject hostInfo();
QJsonObject listPrinters();

}  // namespace printkit
