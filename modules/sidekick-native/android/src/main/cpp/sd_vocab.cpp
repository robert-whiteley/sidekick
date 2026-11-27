// Replaces stable-diffusion.cpp's src/tokenizers/vocab/vocab.cpp in the app build. Upstream embeds
// the tokenizer files of every model family it supports (~30 MB in the library); the app's picture
// model (SDXS-512, a Stable Diffusion 1.5 derivative) uses only CLIP's, so only that one is kept.
// The others return empty strings: those model families are never loaded by the app.
#include "vocab.h"
#include "clip_merges.hpp"

std::string load_clip_merges() {
  return std::string(reinterpret_cast<const char*>(clip_merges_utf8_c_str), sizeof(clip_merges_utf8_c_str));
}

std::string load_qwen2_merges() { return {}; }
std::string load_mistral_merges() { return {}; }
std::string load_mistral_vocab_json() { return {}; }
std::string load_t5_tokenizer_json() { return {}; }
std::string load_umt5_tokenizer_json() { return {}; }
std::string load_gemma_merges() { return {}; }
std::string load_gemma_vocab_json() { return {}; }
