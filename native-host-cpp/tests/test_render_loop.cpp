// Long-run regression: render the same 2-page job N times in one process and
// assert RSS does not creep (the "越打越卡 / 内存泄露" class of bug). Also
// checks the jobId dedupe path in handleRequest.
#include <QApplication>
#include <QDir>
#include <QJsonArray>
#include <QJsonObject>

#include <cstdio>
#include <string>

#include "actions.h"
#include "job.h"
#include "render.h"

using namespace printkit;

namespace {

#ifdef __linux__
long rssKb() {
  std::FILE* f = std::fopen("/proc/self/status", "r");
  if (!f) return -1;
  char line[256];
  long kb = -1;
  while (std::fgets(line, sizeof(line), f)) {
    if (std::sscanf(line, "VmRSS: %ld kB", &kb) == 1) break;
  }
  std::fclose(f);
  return kb;
}
#else
long rssKb() { return -1; }
#endif

PrintJob makeJob() {
  PrintJob job;
  job.title = QStringLiteral("loop");
  for (int i = 1; i <= 2; ++i) {
    PageHtml p;
    p.id = "page" + std::to_string(i);
    p.html = "<div id=\"" + p.id +
             "\"><h1>发票 " + std::to_string(i) +
             "</h1><table border=\"1\"><tr><td>价税合计</td><td>¥318.00</td></tr></table></div>";
    job.pages.push_back(p);
  }
  job.settings.paperName = "A5";
  job.settings.orientation = 2;
  job.settings.margins = {5, 5, 5, 5};
  job.settings.offset = {1.0, -0.5};
  return job;
}

QJsonObject printRequest(const QString& jobId, const QString& outPdf) {
  QJsonArray pages;
  for (int i = 1; i <= 2; ++i) {
    QJsonObject p;
    p.insert("id", QStringLiteral("page%1").arg(i));
    p.insert("html", QStringLiteral("<div>第 %1 页</div>").arg(i));
    pages.append(p);
  }
  QJsonObject settings;
  settings.insert("paperName", "A5");
  QJsonObject payload;
  payload.insert("jobId", jobId);
  payload.insert("outPdf", outPdf);
  payload.insert("pages", pages);
  payload.insert("settings", settings);
  QJsonObject req;
  req.insert("action", "print");
  req.insert("requestId", "nm_test");
  req.insert("payload", payload);
  return req;
}

}  // namespace

int main(int argc, char** argv) {
  qputenv("QT_QPA_PLATFORM", "offscreen");
  QApplication app(argc, argv);
  int failures = 0;

  const QString outDir = QDir::tempPath() + QStringLiteral("/printkit-loop");
  QDir().mkpath(outDir);

  const PrintJob job = makeJob();
  constexpr int kWarmup = 4;
  constexpr int kTotal = 24;
  long rssAfterWarmup = -1;

  for (int i = 1; i <= kTotal; ++i) {
    const QString pdf = outDir + QStringLiteral("/job-%1.pdf").arg(i);
    const RenderResult res = renderAndPrint(job, pdf);
    if (!res.ok) {
      std::printf("FAIL  render %d: %s\n", i, res.error.toUtf8().constData());
      return 1;
    }
    if (i == kWarmup) rssAfterWarmup = rssKb();
  }
  const long rssEnd = rssKb();
  std::printf("ok  %d renders completed\n", kTotal);

  if (rssAfterWarmup > 0 && rssEnd > 0) {
    const long growthKb = rssEnd - rssAfterWarmup;
    std::printf("ok  RSS after warmup %ld kB → end %ld kB (growth %ld kB over %d jobs)\n",
                rssAfterWarmup, rssEnd, growthKb, kTotal - kWarmup);
    if (growthKb > 32 * 1024) {
      std::printf("FAIL  RSS grew more than 32 MB across %d jobs\n", kTotal - kWarmup);
      ++failures;
    }
  } else {
    std::printf("ok  RSS check skipped (non-Linux)\n");
  }

  // jobId dedupe: same job delivered twice must not render twice.
  const QString dupPdf = outDir + QStringLiteral("/dup.pdf");
  const QJsonObject first = handleRequest(printRequest("job_dup_1", dupPdf));
  const QJsonObject second = handleRequest(printRequest("job_dup_1", dupPdf));
  const QJsonObject other = handleRequest(printRequest("job_dup_2", dupPdf));
  if (!(first.value("ok").toBool() && !first.value("duplicate").toBool())) {
    std::printf("FAIL  first delivery should print\n");
    ++failures;
  }
  if (!(second.value("ok").toBool() && second.value("duplicate").toBool())) {
    std::printf("FAIL  duplicate delivery should be dropped (duplicate:true)\n");
    ++failures;
  }
  if (other.value("duplicate").toBool()) {
    std::printf("FAIL  a different jobId must still print\n");
    ++failures;
  }
  if (!failures) std::printf("ok  duplicate jobId is not re-printed\n");

  QDir(outDir).removeRecursively();
  if (failures) {
    std::printf("%d failed\n", failures);
    return 1;
  }
  std::printf("all passed\n");
  return 0;
}
