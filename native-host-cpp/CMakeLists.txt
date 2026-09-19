cmake_minimum_required(VERSION 3.16)
project(printkit-host LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Qt5 REQUIRED COMPONENTS Core Gui Widgets PrintSupport)
# QtWebKit 5.212 (reborn) ships Qt5WebKit / Qt5WebKitWidgets CMake configs.
find_package(Qt5WebKit REQUIRED)
find_package(Qt5WebKitWidgets REQUIRED)

add_executable(printkit-host
  src/main.cpp
  src/protocol.cpp
  src/paper.cpp
  src/sentinel.cpp
  src/htmldoc.cpp
  src/job.cpp
  src/render.cpp
  src/actions.cpp
)

target_link_libraries(printkit-host
  Qt5::Core Qt5::Gui Qt5::Widgets Qt5::PrintSupport
  Qt5::WebKit Qt5::WebKitWidgets
)

# Protocol / layout unit tests: no Qt required.
add_executable(printkit-host-tests
  tests/test_core.cpp
  src/protocol.cpp
  src/paper.cpp
  src/sentinel.cpp
  src/htmldoc.cpp
)
target_include_directories(printkit-host-tests PRIVATE src)

# Long-run render loop: RSS creep + jobId dedupe (needs Qt, offscreen).
add_executable(printkit-render-loop-test
  tests/test_render_loop.cpp
  src/protocol.cpp
  src/paper.cpp
  src/sentinel.cpp
  src/htmldoc.cpp
  src/job.cpp
  src/render.cpp
  src/actions.cpp
)
target_include_directories(printkit-render-loop-test PRIVATE src)
target_link_libraries(printkit-render-loop-test
  Qt5::Core Qt5::Gui Qt5::Widgets Qt5::PrintSupport
  Qt5::WebKit Qt5::WebKitWidgets
)

enable_testing()
add_test(NAME core COMMAND printkit-host-tests)
add_test(NAME render-loop COMMAND printkit-render-loop-test)
