// Qt-free unit tests for the C++ host core: framing, paper math, sentinel,
// HTML composition. Build: g++ -std=c++17 -Isrc tests/test_core.cpp src/{protocol,paper,sentinel,htmldoc}.cpp
#include <cassert>
#include <cstdio>
#include <cstring>
#include <string>

#include "htmldoc.h"
#include "paper.h"
#include "protocol.h"
#include "sentinel.h"

using namespace printkit;

static int failures = 0;

#define CHECK(name, cond)                                    \
  do {                                                       \
    if (cond) {                                              \
      std::printf("ok  %s\n", name);                         \
    } else {                                                 \
      ++failures;                                            \
      std::printf("FAIL  %s (line %d)\n", name, __LINE__);   \
    }                                                        \
  } while (0)

static void testFraming() {
  unsigned char header[4];
  encodeLength(0x01020304u, header);
  CHECK("length header is little-endian",
        header[0] == 0x04 && header[1] == 0x03 && header[2] == 0x02 && header[3] == 0x01);
  CHECK("decode round-trips", decodeLength(header) == 0x01020304u);

  // Round-trip through a temp file (works on Linux/macOS/Windows CRT).
  std::FILE* f = std::tmpfile();
  const std::string msg = "{\"action\":\"ping\"}";
  CHECK("writeMessage succeeds", writeMessage(f, msg));
  std::rewind(f);
  std::string got;
  CHECK("readMessage succeeds", readMessage(f, got));
  CHECK("payload round-trips", got == msg);
  CHECK("EOF returns false", !readMessage(f, got));
  std::fclose(f);

  std::FILE* g = std::tmpfile();
  unsigned char bogus[4];
  encodeLength(kMaxMessageBytes + 1, bogus);
  std::fwrite(bogus, 1, 4, g);
  std::rewind(g);
  CHECK("oversized frame rejected", !readMessage(g, got));
  std::fclose(g);
}

static void testPaper() {
  JobSettings s;
  s.paperName = "A4";
  PaperBox box = resolvePaper(s);
  CHECK("A4 portrait 210x297", box.widthMm == 210 && box.heightMm == 297);

  s.orientation = 2;
  box = resolvePaper(s);
  CHECK("A4 landscape swaps to 297x210", box.widthMm == 297 && box.heightMm == 210);

  JobSettings pin;
  pin.paperName = "Pin3";
  pin.orientation = 1;  // must be ignored: pin sheets never rotate again
  box = resolvePaper(pin);
  CHECK("Pin3 stays 241x93 landscape",
        box.widthMm == 241 && box.heightMm == 93 && box.orientation == 2);

  JobSettings custom;
  custom.pageWidth = 100;
  custom.pageHeight = 180;
  custom.lockPageBox = true;
  custom.orientation = 2;
  box = resolvePaper(custom);
  CHECK("locked box never swaps", box.widthMm == 100 && box.heightMm == 180);

  CHECK("content scale clamps low", clampContentScale(10) == 50);
  CHECK("content scale clamps high", clampContentScale(500) == 200);
  CHECK("content scale default", clampContentScale(0) == 100);
}

static void testSentinel() {
  CHECK("origin parses id",
        extensionIdFromOrigin("chrome-extension://memmopnlapcegennpipheiadaonehljd/") ==
            "memmopnlapcegennpipheiadaonehljd");
  CHECK("non-extension origin rejected", extensionIdFromOrigin("https://evil.example/").empty());

  SentinelVerdict ok = checkCaller({"chrome-extension://memmopnlapcegennpipheiadaonehljd/"},
                                   defaultAllowedIds());
  CHECK("allowlisted extension passes", ok.allowed);
  CHECK("sentinel is millisecond-level", ok.elapsedMs < 50.0);

  SentinelVerdict bad =
      checkCaller({"chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"}, defaultAllowedIds());
  CHECK("unknown extension refused", !bad.allowed);

  SentinelVerdict cli = checkCaller({"--cli", "ping"}, defaultAllowedIds());
  CHECK("cli invocation allowed", cli.allowed);
}

static void testHtmlDoc() {
  JobSettings s;
  s.paperName = "A5";
  s.orientation = 2;
  s.margins = {5, 5, 5, 5};
  s.offset = {1.5, -0.8};
  s.contentScalePct = 100;

  std::vector<PageHtml> pages = {{"page1", "<div id=\"page1\">发票</div>"},
                                 {"page2", "<div id=\"page2\">副本</div>"}};
  std::vector<Stylesheet> sheets;
  Stylesheet inlineSheet;
  inlineSheet.inlineCss = true;
  inlineSheet.css = ".x{color:#000}";
  sheets.push_back(inlineSheet);

  const std::string html = buildHtmlDocument("发票", pages, sheets, s);
  CHECK("landscape A5 page box", html.find("size: 210mm 148mm") != std::string::npos);
  CHECK("margins applied as padding", html.find("padding: 5mm 5mm 5mm 5mm") != std::string::npos);
  CHECK("mm offset translate", html.find("translate(1.5mm, -0.8mm)") != std::string::npos);
  CHECK("both mapped pages present", html.find("data-map=\"page1\"") != std::string::npos &&
                                         html.find("data-map=\"page2\"") != std::string::npos);
  CHECK("inline stylesheet included", html.find(".x{color:#000}") != std::string::npos);
  CHECK("html escaped in title", buildHtmlDocument("<b>", {}, {}, s).find("<title>&lt;b&gt;") !=
                                     std::string::npos);
}

int main() {
  testFraming();
  testPaper();
  testSentinel();
  testHtmlDoc();
  if (failures) {
    std::printf("%d failed\n", failures);
    return 1;
  }
  std::printf("all passed\n");
  return 0;
}
