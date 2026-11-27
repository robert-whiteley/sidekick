# LiteRT-LM's native code calls its Kotlin classes by name over JNI (e.g. the internal
# callback's onMessage/onDone). The AAR ships no keep rules, so R8 renames them and the app
# aborts with NoSuchMethodError on the first answer. Keep the whole API as-is.
-keep class com.google.ai.edge.litertlm.** { *; }
-keepclassmembers class com.google.ai.edge.litertlm.** { *; }

# sherpa-onnx native code builds these config/result classes through JNI.
-keep class com.k2fsa.sherpa.onnx.** { *; }

# Photo OCR's JNI bridge (src/main/cpp/ort_shim.cpp) binds these by name.
-keep class dev.sidekick.engine.OrtShim { *; }

# sherpa-onnx's TTS calls the chunk callback's invoke([F)Ljava/lang/Integer; over JNI.
-keep class dev.sidekick.engine.TtsChunks { *; }

# The picture library (src/main/cpp/sd_jni.cpp) calls the progress callback's onProgress by name.
# Renamed by R8, every picture failed with NoSuchMethodError on the phone (release build).
-keep interface dev.sidekick.engine.ImageGen$Progress { *; }
