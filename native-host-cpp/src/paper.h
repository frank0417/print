// Paper/margin/offset resolution shared by render + tests. mm everywhere.
// Mirrors extension/lib/paper.js so 预览 == 出纸.
#pragma once

#include <string>

namespace printkit {

struct PaperBox {
  std::string name;   // resolved preset name or "Custom"
  double widthMm = 210;
  double heightMm = 297;
  int orientation = 1;  // 1 portrait, 2 landscape (of the resolved box)
};

struct MarginsMm {
  double top = 0;
  double right = 0;
  double bottom = 0;
  double left = 0;
};

struct OffsetMm {
  double x = 0;  // positive → right
  double y = 0;  // positive → down
};

struct JobSettings {
  std::string paperName;
  double pageWidth = 0;   // 0 = follow preset
  double pageHeight = 0;
  int orientation = 0;    // 0 = unset
  bool lockPageBox = false;
  MarginsMm margins;
  OffsetMm offset;
  int copies = 1;
  double contentScalePct = 100;  // 50..200
  std::string printer;
};

// Look up a named preset (A3/A4/A5/B4/B5/Letter/Legal/Tabloid/Pin2/Pin3/PinFull).
// Returns false when unknown.
bool paperPreset(const std::string& name, double& widthMm, double& heightMm);

// Resolve the final page box: preset/custom mm + orientation swap unless locked.
PaperBox resolvePaper(const JobSettings& s);

// Clamp the preview 内容缩放 to 50..200 (%), default 100.
double clampContentScale(double pct);

}  // namespace printkit
