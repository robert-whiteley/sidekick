// Minimal JNI bridge to ONNX Runtime for models sherpa-onnx has no wrapper for (photo OCR).
//
// sherpa-onnx already ships libonnxruntime.so (1.28.2). Microsoft's onnxruntime-android AAR
// can't sit next to it: both contain libonnxruntime.so, and each side's code is linked to its
// own symbol version (OrtGetApiBase@VERS_1.28.2 vs @VERS_1.28.0), so whichever file Gradle keeps
// breaks the other. This bridge instead finds OrtGetApiBase at run time with dlsym (default
// version), so it uses whatever libonnxruntime.so the app ships. Headers: ort/ (MIT, v1.28.0).
#include <dlfcn.h>
#include <jni.h>

#include <mutex>
#include <string>
#include <vector>

#include "ort/onnxruntime_c_api.h"

namespace {

const OrtApi* g_api = nullptr;
OrtEnv* g_env = nullptr;
std::mutex g_mu;

struct Session {
  OrtSession* session = nullptr;
  std::string input;
  std::string output;
  std::vector<std::string> inputs;  // every input, in order (for runU8)
};

void throwJava(JNIEnv* env, const std::string& msg) {
  jclass c = env->FindClass("java/lang/RuntimeException");
  if (c) env->ThrowNew(c, msg.c_str());
}

// Returns false (with a Java exception pending) if [s] is an error.
bool ok(JNIEnv* env, OrtStatus* s) {
  if (!s) return true;
  std::string msg = std::string("onnxruntime: ") + g_api->GetErrorMessage(s);
  g_api->ReleaseStatus(s);
  throwJava(env, msg);
  return false;
}

bool init(JNIEnv* env) {
  std::lock_guard<std::mutex> lock(g_mu);
  if (g_env) return true;
  void* lib = dlopen("libonnxruntime.so", RTLD_NOW | RTLD_GLOBAL);
  if (!lib) {
    const char* e = dlerror();
    throwJava(env, std::string("can't load libonnxruntime.so: ") + (e ? e : "?"));
    return false;
  }
  using GetApiBase = const OrtApiBase* (*)();
  auto getBase = reinterpret_cast<GetApiBase>(dlsym(lib, "OrtGetApiBase"));
  const OrtApi* api = getBase ? getBase()->GetApi(ORT_API_VERSION) : nullptr;
  if (!api) {
    throwJava(env, "libonnxruntime.so is older than the ONNX Runtime API this app needs");
    return false;
  }
  g_api = api;
  OrtEnv* e = nullptr;
  if (!ok(env, g_api->CreateEnv(ORT_LOGGING_LEVEL_WARNING, "sidekick-ocr", &e))) return false;
  g_env = e;
  return true;
}

std::string ioName(JNIEnv* env, OrtSession* s, bool input, size_t index = 0) {
  OrtAllocator* alloc = nullptr;
  if (!ok(env, g_api->GetAllocatorWithDefaultOptions(&alloc))) return "";
  char* name = nullptr;
  OrtStatus* st = input ? g_api->SessionGetInputName(s, index, alloc, &name)
                        : g_api->SessionGetOutputName(s, index, alloc, &name);
  if (!ok(env, st)) return "";
  std::string out(name);
  alloc->Free(alloc, name);
  return out;
}

}  // namespace

extern "C" {

// Loads a model; returns a handle for run/release (0 with an exception on failure).
JNIEXPORT jlong JNICALL Java_dev_sidekick_engine_OrtShim_create(JNIEnv* env, jobject, jstring path,
                                                                jint threads) {
  if (!init(env)) return 0;
  const char* p = env->GetStringUTFChars(path, nullptr);
  OrtSessionOptions* opts = nullptr;
  OrtSession* session = nullptr;
  bool good = ok(env, g_api->CreateSessionOptions(&opts)) &&
              ok(env, g_api->SetIntraOpNumThreads(opts, threads)) &&
              ok(env, g_api->SetSessionGraphOptimizationLevel(opts, ORT_ENABLE_ALL)) &&
              ok(env, g_api->CreateSession(g_env, p, opts, &session));
  env->ReleaseStringUTFChars(path, p);
  if (opts) g_api->ReleaseSessionOptions(opts);
  if (!good) return 0;
  auto* s = new Session{session, ioName(env, session, true), ""};
  if (!env->ExceptionCheck()) s->output = ioName(env, session, false);
  size_t count = 0;
  if (!env->ExceptionCheck() && ok(env, g_api->SessionGetInputCount(session, &count))) {
    for (size_t i = 0; i < count && !env->ExceptionCheck(); i++) s->inputs.push_back(ioName(env, session, true, i));
  }
  if (env->ExceptionCheck()) {
    g_api->ReleaseSession(session);
    delete s;
    return 0;
  }
  return reinterpret_cast<jlong>(s);
}

// Runs the model's first input -> first output (float32). [outShape] receives the rank, then the
// dimensions (it must have room for 1 + rank values).
JNIEXPORT jfloatArray JNICALL Java_dev_sidekick_engine_OrtShim_run(JNIEnv* env, jobject, jlong handle,
                                                                   jfloatArray input, jlongArray shape,
                                                                   jlongArray outShape) {
  auto* s = reinterpret_cast<Session*>(handle);
  if (!s || !g_api) {
    throwJava(env, "OCR model not loaded");
    return nullptr;
  }
  std::vector<int64_t> dims(env->GetArrayLength(shape));
  env->GetLongArrayRegion(shape, 0, static_cast<jsize>(dims.size()), reinterpret_cast<jlong*>(dims.data()));
  jsize n = env->GetArrayLength(input);
  std::vector<float> data(n);
  env->GetFloatArrayRegion(input, 0, n, data.data());

  OrtMemoryInfo* mem = nullptr;
  OrtValue* in = nullptr;
  OrtValue* out = nullptr;
  OrtTensorTypeAndShapeInfo* info = nullptr;
  jfloatArray result = nullptr;
  const char* inName = s->input.c_str();
  const char* outName = s->output.c_str();
  if (ok(env, g_api->CreateCpuMemoryInfo(OrtArenaAllocator, OrtMemTypeDefault, &mem)) &&
      ok(env, g_api->CreateTensorWithDataAsOrtValue(mem, data.data(), data.size() * sizeof(float),
                                                    dims.data(), dims.size(),
                                                    ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT, &in)) &&
      ok(env, g_api->Run(s->session, nullptr, &inName, &in, 1, &outName, 1, &out)) &&
      ok(env, g_api->GetTensorTypeAndShape(out, &info))) {
    size_t rank = 0;
    size_t count = 0;
    float* values = nullptr;
    if (ok(env, g_api->GetDimensionsCount(info, &rank)) &&
        ok(env, g_api->GetTensorShapeElementCount(info, &count)) &&
        ok(env, g_api->GetTensorMutableData(out, reinterpret_cast<void**>(&values)))) {
      std::vector<int64_t> od(rank);
      if (ok(env, g_api->GetDimensions(info, od.data(), rank))) {
        if (env->GetArrayLength(outShape) < static_cast<jsize>(rank + 1)) {
          throwJava(env, "outShape too small");
        } else {
          jlong r = static_cast<jlong>(rank);
          env->SetLongArrayRegion(outShape, 0, 1, &r);
          env->SetLongArrayRegion(outShape, 1, static_cast<jsize>(rank), reinterpret_cast<const jlong*>(od.data()));
          result = env->NewFloatArray(static_cast<jsize>(count));
          if (result) env->SetFloatArrayRegion(result, 0, static_cast<jsize>(count), values);
        }
      }
    }
  }
  if (info) g_api->ReleaseTensorTypeAndShapeInfo(info);
  if (out) g_api->ReleaseValue(out);
  if (in) g_api->ReleaseValue(in);
  if (mem) g_api->ReleaseMemoryInfo(mem);
  return result;
}

// Runs a model whose inputs and first output are all uint8 (MI-GAN's inpainting pipeline: image +
// mask in, image out). [inputs] and [shapes] follow the model's input order; [outShape] as in run.
JNIEXPORT jbyteArray JNICALL Java_dev_sidekick_engine_OrtShim_runU8(JNIEnv* env, jobject, jlong handle,
                                                                   jobjectArray inputs, jobjectArray shapes,
                                                                   jlongArray outShape) {
  auto* s = reinterpret_cast<Session*>(handle);
  if (!s || !g_api) {
    throwJava(env, "model not loaded");
    return nullptr;
  }
  jsize n = env->GetArrayLength(inputs);
  if (n != static_cast<jsize>(s->inputs.size()) || env->GetArrayLength(shapes) != n) {
    throwJava(env, "wrong number of inputs");
    return nullptr;
  }
  std::vector<std::vector<uint8_t>> data(n);
  std::vector<std::vector<int64_t>> dims(n);
  std::vector<const char*> names(n);
  for (jsize i = 0; i < n; i++) {
    auto arr = static_cast<jbyteArray>(env->GetObjectArrayElement(inputs, i));
    auto shp = static_cast<jlongArray>(env->GetObjectArrayElement(shapes, i));
    data[i].resize(env->GetArrayLength(arr));
    env->GetByteArrayRegion(arr, 0, static_cast<jsize>(data[i].size()), reinterpret_cast<jbyte*>(data[i].data()));
    dims[i].resize(env->GetArrayLength(shp));
    env->GetLongArrayRegion(shp, 0, static_cast<jsize>(dims[i].size()), reinterpret_cast<jlong*>(dims[i].data()));
    env->DeleteLocalRef(arr);
    env->DeleteLocalRef(shp);
    names[i] = s->inputs[i].c_str();
  }
  OrtMemoryInfo* mem = nullptr;
  std::vector<OrtValue*> in(n, nullptr);
  OrtValue* out = nullptr;
  OrtTensorTypeAndShapeInfo* info = nullptr;
  jbyteArray result = nullptr;
  const char* outName = s->output.c_str();
  bool good = ok(env, g_api->CreateCpuMemoryInfo(OrtArenaAllocator, OrtMemTypeDefault, &mem));
  for (jsize i = 0; good && i < n; i++) {
    good = ok(env, g_api->CreateTensorWithDataAsOrtValue(mem, data[i].data(), data[i].size(), dims[i].data(),
                                                         dims[i].size(), ONNX_TENSOR_ELEMENT_DATA_TYPE_UINT8, &in[i]));
  }
  if (good && ok(env, g_api->Run(s->session, nullptr, names.data(), in.data(), n, &outName, 1, &out)) &&
      ok(env, g_api->GetTensorTypeAndShape(out, &info))) {
    size_t rank = 0;
    size_t count = 0;
    uint8_t* values = nullptr;
    if (ok(env, g_api->GetDimensionsCount(info, &rank)) &&
        ok(env, g_api->GetTensorShapeElementCount(info, &count)) &&
        ok(env, g_api->GetTensorMutableData(out, reinterpret_cast<void**>(&values)))) {
      std::vector<int64_t> od(rank);
      if (ok(env, g_api->GetDimensions(info, od.data(), rank))) {
        if (env->GetArrayLength(outShape) < static_cast<jsize>(rank + 1)) {
          throwJava(env, "outShape too small");
        } else {
          jlong r = static_cast<jlong>(rank);
          env->SetLongArrayRegion(outShape, 0, 1, &r);
          env->SetLongArrayRegion(outShape, 1, static_cast<jsize>(rank), reinterpret_cast<const jlong*>(od.data()));
          result = env->NewByteArray(static_cast<jsize>(count));
          if (result) env->SetByteArrayRegion(result, 0, static_cast<jsize>(count), reinterpret_cast<const jbyte*>(values));
        }
      }
    }
  }
  if (info) g_api->ReleaseTensorTypeAndShapeInfo(info);
  if (out) g_api->ReleaseValue(out);
  for (auto* v : in)
    if (v) g_api->ReleaseValue(v);
  if (mem) g_api->ReleaseMemoryInfo(mem);
  return result;
}

JNIEXPORT void JNICALL Java_dev_sidekick_engine_OrtShim_release(JNIEnv*, jobject, jlong handle) {
  auto* s = reinterpret_cast<Session*>(handle);
  if (!s) return;
  if (g_api && s->session) g_api->ReleaseSession(s->session);
  delete s;
}

}  // extern "C"
