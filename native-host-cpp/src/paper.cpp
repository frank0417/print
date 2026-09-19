#include "paper.h"

#include <algorithm>
#include <cmath>

namespace printkit {

namespace {

struct Preset {
  const char* name;
  double w;
  double h;
};

// 针式连续纸: 宽 9.5"（含孔）× 走纸方向长度
const Preset kPresets[] = {
    {"A3", 297, 420},     {"A4", 210, 297},    {"A5", 148, 210},
    {"B4", 250, 353},     {"B5", 176, 250},    {"Letter", 216, 279},
    {"Legal", 216, 356},  {"Tabloid", 279, 432},
    {"Pin2", 241, 140},   {"Pin3", 241, 93},   {"PinFull", 241, 279},
};

bool isPinSheet(const std::string& name) {
  return name == "Pin2" || name == "Pin3" || name == "PinFull";
}

}  // namespace

bool paperPreset(const std::string& name, double& widthMm, double& heightMm) {
  for (const Preset& p : kPresets) {
    if (name == p.name) {
      widthMm = p.w;
      heightMm = p.h;
      return true;
    }
  }
  return false;
}

PaperBox resolvePaper(const JobSettings& s) {
  PaperBox box;
  double presetW = 210;
  double presetH = 297;
  const bool named = paperPreset(s.paperName, presetW, presetH);
  box.name = named ? s.paperName : "Custom";

  box.widthMm = s.pageWidth > 0 ? s.pageWidth : presetW;
  box.heightMm = s.pageHeight > 0 ? s.pageHeight : presetH;
  box.orientation = s.orientation == 2 ? 2 : 1;

  if (named && isPinSheet(s.paperName)) {
    // Pin-feed sheets ARE the physical ticket; never rotate again.
    box.widthMm = presetW;
    box.heightMm = presetH;
    box.orientation = 2;
    return box;
  }

  if (!s.lockPageBox) {
    if (box.orientation == 2 && box.widthMm < box.heightMm) {
      std::swap(box.widthMm, box.heightMm);
    } else if (box.orientation == 1 && box.widthMm > box.heightMm) {
      std::swap(box.widthMm, box.heightMm);
    }
  }
  return box;
}

double clampContentScale(double pct) {
  if (!(pct > 0) || std::isnan(pct)) return 100;
  return std::min(200.0, std::max(50.0, std::round(pct)));
}

}  // namespace printkit
