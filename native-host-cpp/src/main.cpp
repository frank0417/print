// PrintKit C++ native host: Chrome Native Messaging ⇄ QtWebKit ⇄ QPrinter.
// No Node.js / Python middle layer — one small native process.
//
//   printkit-host                          # native-messaging loop (Chrome spawns it)
//   printkit-host --cli ping               # self test
//   printkit-host --cli getPrinters
//   printkit-host --cli print job.json [out.pdf]

#include <QApplication>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>

#include <csignal>
#include <cstdio>
#include <string>
#include <vector>

#include "actions.h"
#include "job.h"
#include "protocol.h"
#include "render.h"
#include "sentinel.h"

namespace {

using namespace printkit;

// stdout carries ONLY framed protocol bytes. Any stray qDebug/qWarning that
// lands on stdout corrupts a frame and Chrome reports "host not responding"
// (looks like the host cannot start). Route every Qt message to stderr.
void stderrMessageHandler(QtMsgType, const QMessageLogContext&, const QString& msg) {
  std::fprintf(stderr, "%s\n", msg.toLocal8Bit().constData());
}

void ensureGuiPlatform() {
#if !defined(_WIN32) && !defined(__APPLE__)
  // Headless Linux (no X/Wayland): fall back to the offscreen platform so
  // QtWebKit can still lay out and QPrinter can still spool via CUPS.
  if (qEnvironmentVariableIsEmpty("QT_QPA_PLATFORM") &&
      qEnvironmentVariableIsEmpty("DISPLAY") &&
      qEnvironmentVariableIsEmpty("WAYLAND_DISPLAY")) {
    qputenv("QT_QPA_PLATFORM", "offscreen");
  }
#endif
}

int runCli(const std::vector<std::string>& args) {
  const std::string cmd = args.empty() ? "ping" : args[0];

  if (cmd == "ping" || cmd == "getHostInfo") {
    const QJsonDocument doc(hostInfo());
    std::puts(doc.toJson(QJsonDocument::Indented).constData());
    return 0;
  }
  if (cmd == "getPrinters") {
    const QJsonDocument doc(listPrinters());
    std::puts(doc.toJson(QJsonDocument::Indented).constData());
    return 0;
  }
  if (cmd == "print") {
    if (args.size() < 2) {
      std::fprintf(stderr, "usage: printkit-host --cli print job.json [out.pdf]\n");
      return 2;
    }
    QFile file(QString::fromStdString(args[1]));
    if (!file.open(QIODevice::ReadOnly)) {
      std::fprintf(stderr, "cannot read %s\n", args[1].c_str());
      return 2;
    }
    const QJsonDocument doc = QJsonDocument::fromJson(file.readAll());
    const PrintJob job = parsePrintJob(doc.object().value(QLatin1String("payload")).isObject()
                                           ? doc.object().value(QLatin1String("payload")).toObject()
                                           : doc.object());
    const QString outPdf = args.size() >= 3 ? QString::fromStdString(args[2]) : QString();
    const RenderResult res = renderAndPrint(job, outPdf);
    QJsonObject reply;
    reply.insert(QLatin1String("ok"), res.ok);
    reply.insert(QLatin1String("printer"), res.printer);
    reply.insert(QLatin1String("method"), res.method);
    reply.insert(QLatin1String("copies"), res.copies);
    reply.insert(QLatin1String("renderMs"), res.renderMs);
    if (!res.ok) reply.insert(QLatin1String("error"), res.error);
    std::puts(QJsonDocument(reply).toJson(QJsonDocument::Indented).constData());
    return res.ok ? 0 : 1;
  }

  std::fprintf(stderr, "unknown --cli command: %s\n", cmd.c_str());
  return 2;
}

int runNativeLoop() {
  setBinaryStdio();
  std::string raw;
  while (readMessage(stdin, raw)) {
    const QJsonDocument doc =
        QJsonDocument::fromJson(QByteArray(raw.data(), static_cast<int>(raw.size())));
    QJsonObject reply;
    if (!doc.isObject()) {
      reply.insert(QLatin1String("ok"), false);
      reply.insert(QLatin1String("error"), QLatin1String("请求不是 JSON 对象"));
    } else {
      reply = handleRequest(doc.object());
    }
    const QByteArray body = QJsonDocument(reply).toJson(QJsonDocument::Compact);
    if (!writeMessage(stdout, std::string(body.constData(), static_cast<size_t>(body.size())))) {
      break;
    }
  }
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  std::vector<std::string> args(argv + 1, argv + argc);

  // IP-Sentinel: refuse extensions that are not on the allowlist before any
  // payload is parsed. Millisecond-level, no network round-trip.
  const SentinelVerdict verdict = checkCaller(args, defaultAllowedIds());
  if (!verdict.allowed) {
    std::fprintf(stderr, "IP-Sentinel: origin %s rejected (%.3f ms)\n",
                 verdict.origin.c_str(), verdict.elapsedMs);
    return 3;
  }

  ensureGuiPlatform();
  qInstallMessageHandler(stderrMessageHandler);
#ifndef _WIN32
  // Chrome closing the pipe must end the loop via fwrite failure, not SIGPIPE.
  std::signal(SIGPIPE, SIG_IGN);
#endif
  QApplication app(argc, argv);
  app.setApplicationName(QStringLiteral("printkit-host"));

  for (size_t i = 0; i < args.size(); ++i) {
    if (args[i] == "--cli") {
      return runCli(std::vector<std::string>(args.begin() + i + 1, args.end()));
    }
  }
  return runNativeLoop();
}
