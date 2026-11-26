cmake_minimum_required(VERSION 3.22.1)
project(sidekick_ort C CXX)

# JNI bridge to the libonnxruntime.so that sherpa-onnx already ships (see ort_shim.cpp).
add_library(sidekick_ort SHARED ort_shim.cpp)
set_target_properties(sidekick_ort PROPERTIES CXX_STANDARD 17)
target_link_libraries(sidekick_ort dl log)
# 16 KB pages (Android 15+ devices; Play requires it for targetSdk 35+).
target_link_options(sidekick_ort PRIVATE "-Wl,-z,max-page-size=16384")

# Picture making: stable-diffusion.cpp (MIT) and its ggml (MIT), compiled from source here at a
# pinned commit (archive checked by SHA-256), never a prebuilt binary. 64-bit ARM only: a 1 GB
# model doesn't fit a 32-bit process, and x86 is only the emulator. Built for ARMv8.2 with dot
# product and FP16 (every phone with the 6 GB RAM this is offered on); ImageGen.kt loads the
# library only after checking the CPU has them, so older chips never run it.
if(ANDROID_ABI STREQUAL "arm64-v8a")
  include(FetchContent)
  set(SD_COMMIT e637c7bccd35aa8841d67fb942ba72918176826c) # master-1141, 26 Nov 2026
  set(GGML_COMMIT eeda9ec48fc84a3df0bb9dcc19ae9053075a2539) # the ggml submodule of that commit
  FetchContent_Declare(sidekick_sdcpp
    URL https://github.com/leejet/stable-diffusion.cpp/archive/${SD_COMMIT}.tar.gz
    URL_HASH SHA256=b4ee260e48667e96cf6065dc1e116007c63dcebcccb8ecc97e6b9c77edd94979)
  FetchContent_Declare(sidekick_ggml
    URL https://github.com/leejet/ggml/archive/${GGML_COMMIT}.tar.gz
    URL_HASH SHA256=8bd7adc7eb1366d31670467951d21eb1a5f55e8f6d89b9b91909ffb0246ac5d2)
  FetchContent_GetProperties(sidekick_ggml)
  if(NOT sidekick_ggml_POPULATED)
    FetchContent_Populate(sidekick_ggml)
  endif()
  FetchContent_GetProperties(sidekick_sdcpp)
  if(NOT sidekick_sdcpp_POPULATED)
    FetchContent_Populate(sidekick_sdcpp)
  endif()

  set(SD_GGML_SOURCE_DIR "${sidekick_ggml_SOURCE_DIR}" CACHE PATH "" FORCE)
  set(SD_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
  set(SD_WEBP OFF CACHE BOOL "" FORCE)
  set(SD_WEBM OFF CACHE BOOL "" FORCE)
  set(SD_BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
  set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
  set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
  set(GGML_CCACHE OFF CACHE BOOL "" FORCE)
  set(GGML_CPU_ARM_ARCH "armv8.2-a+dotprod+fp16" CACHE STRING "" FORCE)
  set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
  # The debug variant compiles the same optimised code (unoptimised ggml is far too slow to try).
  set(CMAKE_BUILD_TYPE Release)
  add_subdirectory("${sidekick_sdcpp_SOURCE_DIR}" sdcpp EXCLUDE_FROM_ALL)
  # Only CLIP's tokenizer file is compiled in (see sd_vocab.cpp): 41 MB -> ~11 MB library.
  get_target_property(SIDEKICK_SD_SOURCES stable-diffusion SOURCES)
  list(FILTER SIDEKICK_SD_SOURCES EXCLUDE REGEX "tokenizers/vocab/vocab\\.cpp$")
  list(APPEND SIDEKICK_SD_SOURCES "${CMAKE_CURRENT_SOURCE_DIR}/sd_vocab.cpp")
  set_target_properties(stable-diffusion PROPERTIES SOURCES "${SIDEKICK_SD_SOURCES}")
  target_include_directories(stable-diffusion PRIVATE "${sidekick_sdcpp_SOURCE_DIR}/src/tokenizers/vocab")

  add_library(sidekick_sd SHARED sd_jni.cpp)
  set_target_properties(sidekick_sd PROPERTIES CXX_STANDARD 17)
  target_link_libraries(sidekick_sd stable-diffusion log)
  target_link_options(sidekick_sd PRIVATE "-Wl,-z,max-page-size=16384" "-Wl,--gc-sections" "-Wl,--exclude-libs,ALL")
endif()
