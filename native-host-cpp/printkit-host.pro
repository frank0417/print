# qmake project — PrintKit C++ native host (QtWebKit + QPrinter)
#   qmake && make            # Linux / macOS
#   qmake && nmake|mingw32-make   # Windows (Qt 5.x with qtwebkit 5.212)
TEMPLATE = app
TARGET = printkit-host
CONFIG += c++17 console
CONFIG -= app_bundle

QT += core gui widgets printsupport webkit webkitwidgets

SOURCES += \
    src/main.cpp \
    src/protocol.cpp \
    src/paper.cpp \
    src/sentinel.cpp \
    src/htmldoc.cpp \
    src/job.cpp \
    src/render.cpp \
    src/actions.cpp

HEADERS += \
    src/protocol.h \
    src/paper.h \
    src/sentinel.h \
    src/htmldoc.h \
    src/job.h \
    src/render.h \
    src/actions.h \
    src/version.h
