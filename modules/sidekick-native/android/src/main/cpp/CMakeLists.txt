cmake_minimum_required(VERSION 3.22.1)
project(sidekick_ort CXX)

# JNI bridge to the libonnxruntime.so that sherpa-onnx already ships (see ort_shim.cpp).
add_library(sidekick_ort SHARED ort_shim.cpp)
set_target_properties(sidekick_ort PROPERTIES CXX_STANDARD 17)
target_link_libraries(sidekick_ort dl log)
# 16 KB pages (Android 15+ devices; Play requires it for targetSdk 35+).
target_link_options(sidekick_ort PRIVATE "-Wl,-z,max-page-size=16384")
