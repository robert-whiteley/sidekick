// JNI bridge to stable-diffusion.cpp (MIT, built from source by CMakeLists.txt, pinned commit) for
// "make a picture": one context per loaded model, one generation at a time, progress reported to
// Kotlin (ImageGen.kt), Stop through sd_cancel_generation.
#include <android/log.h>
#include <jni.h>

#include <cstring>
#include <string>

#include "stable-diffusion.h"

namespace {

void throwJava(JNIEnv* env, const std::string& msg) {
  jclass c = env->FindClass("java/lang/RuntimeException");
  if (c) env->ThrowNew(c, msg.c_str());
}

std::string lastError() {
  const char* e = sd_get_last_error();
  return e && *e ? e : "unknown error";
}

void onLog(enum sd_log_level_t level, const char* text, void*) {
  if (level < SD_LOG_INFO || !text) return;
  __android_log_print(level >= SD_LOG_ERROR ? ANDROID_LOG_ERROR : ANDROID_LOG_INFO, "SidekickSd", "%s",
                      text);
}

struct Progress {
  JNIEnv* env;
  jobject listener;
  jmethodID method;
};

void onProgress(const sd_generation_progress_t* p, void* data) {
  auto* pr = static_cast<Progress*>(data);
  if (!pr || !pr->listener || !p) return;
  jstring stage = pr->env->NewStringUTF(p->stage ? p->stage : "");
  pr->env->CallVoidMethod(pr->listener, pr->method, stage, static_cast<jlong>(p->completed),
                          static_cast<jlong>(p->total));
  if (pr->env->ExceptionCheck()) pr->env->ExceptionClear();
  pr->env->DeleteLocalRef(stage);
}

bool setStr(sd_opt_t* o, const char* key, const char* v) { return sd_opt_set_string(o, key, v) == SD_STATUS_OK; }

}  // namespace

extern "C" {

// Loads nothing yet (weights load on the first generate); returns a handle.
JNIEXPORT jlong JNICALL Java_dev_sidekick_engine_ImageGen_nativeCreate(JNIEnv* env, jobject, jstring model,
                                                                      jstring taesd, jint threads) {
  sd_set_log_callback(onLog, nullptr);
  sd_ctx_opt_t* o = sd_ctx_opt_create();
  if (!o) {
    throwJava(env, "out of memory");
    return 0;
  }
  const char* m = env->GetStringUTFChars(model, nullptr);
  const char* t = taesd ? env->GetStringUTFChars(taesd, nullptr) : nullptr;
  bool good = setStr(o, "model_path", m) && (!t || setStr(o, "taesd_path", t)) &&
              sd_opt_set_int(o, "n_threads", threads) == SD_STATUS_OK;
  env->ReleaseStringUTFChars(model, m);
  if (t) env->ReleaseStringUTFChars(taesd, t);
  sd_ctx_t* ctx = nullptr;
  if (good) good = sd_ctx_create(o, &ctx) == SD_STATUS_OK;
  sd_opt_free(o);
  if (!good) {
    throwJava(env, "image model: " + lastError());
    return 0;
  }
  return reinterpret_cast<jlong>(ctx);
}

// One picture: RGB bytes, width * height * 3, row by row; null with an exception on failure
// ("cancelled" when stopped).
JNIEXPORT jbyteArray JNICALL Java_dev_sidekick_engine_ImageGen_nativeGenerate(
    JNIEnv* env, jobject, jlong handle, jstring prompt, jint width, jint height, jint steps, jfloat cfg,
    jlong seed, jobject listener) {
  auto* ctx = reinterpret_cast<sd_ctx_t*>(handle);
  if (!ctx) {
    throwJava(env, "image model not loaded");
    return nullptr;
  }
  sd_cancel_generation(ctx, SD_CANCEL_RESET);
  Progress pr{env, listener, nullptr};
  if (listener) {
    jclass c = env->GetObjectClass(listener);
    pr.method = env->GetMethodID(c, "onProgress", "(Ljava/lang/String;JJ)V");
    if (!pr.method) return nullptr;
  }
  sd_set_generation_progress_callback(ctx, listener ? onProgress : nullptr, &pr);
  sd_img_gen_opt_t* o = sd_img_gen_opt_create();
  const char* p = env->GetStringUTFChars(prompt, nullptr);
  bool good = o && setStr(o, "prompt", p) && sd_opt_set_int(o, "width", width) == SD_STATUS_OK &&
              sd_opt_set_int(o, "height", height) == SD_STATUS_OK &&
              sd_opt_set_int(o, "seed", seed) == SD_STATUS_OK &&
              sd_opt_set_int(o, "sample.steps", steps) == SD_STATUS_OK &&
              sd_opt_set_float(o, "sample.guidance.txt_cfg", cfg) == SD_STATUS_OK;
  env->ReleaseStringUTFChars(prompt, p);
  sd_result_t* result = nullptr;
  sd_status_t st = good ? sd_generate_image(ctx, o, &result) : SD_STATUS_INVALID_ARGUMENT;
  sd_opt_free(o);
  sd_set_generation_progress_callback(ctx, nullptr, nullptr);
  jbyteArray out = nullptr;
  if (st == SD_STATUS_CANCELLED) {
    throwJava(env, "cancelled");
  } else if (st != SD_STATUS_OK || !result || sd_result_get_image_count(result) < 1) {
    throwJava(env, "image generation: " + lastError());
  } else {
    const sd_tensor_t* img = sd_result_get_image(result, 0);
    // U8 [C, W, H], channels fastest: interleaved RGB rows.
    int64_t c = sd_tensor_dim(img, 0), w = sd_tensor_dim(img, 1), h = sd_tensor_dim(img, 2);
    if (c != 3 || w != width || h != height) {
      throwJava(env, "unexpected image shape");
    } else {
      size_t n = sd_tensor_byte_size(img);
      out = env->NewByteArray(static_cast<jsize>(n));
      if (out) env->SetByteArrayRegion(out, 0, static_cast<jsize>(n), static_cast<const jbyte*>(sd_tensor_data(img)));
    }
  }
  sd_result_free(result);
  return out;
}

JNIEXPORT void JNICALL Java_dev_sidekick_engine_ImageGen_nativeCancel(JNIEnv*, jobject, jlong handle) {
  auto* ctx = reinterpret_cast<sd_ctx_t*>(handle);
  if (ctx) sd_cancel_generation(ctx, SD_CANCEL_ALL);
}

JNIEXPORT void JNICALL Java_dev_sidekick_engine_ImageGen_nativeFree(JNIEnv*, jobject, jlong handle) {
  auto* ctx = reinterpret_cast<sd_ctx_t*>(handle);
  if (ctx) sd_ctx_free(ctx);
}

}  // extern "C"
