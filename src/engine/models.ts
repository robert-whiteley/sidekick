/** Files the app downloads, pinned by SHA-256 so a tampered or corrupt file is never loaded. */
export type ModelFile = { name: string; url: string; sha256: string; bytes: number };

const HF = 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main';

export const MODEL_FILES = {
  gemmaGeneric: {
    name: 'gemma-4-E2B-it.litertlm',
    url: `${HF}/gemma-4-E2B-it.litertlm`,
    sha256: '181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c',
    bytes: 2588147712,
  },
  gemmaTensorG5: {
    name: 'gemma-4-E2B-it_Google_Tensor_G5.litertlm',
    url: `${HF}/gemma-4-E2B-it_Google_Tensor_G5.litertlm`,
    sha256: '72d056066f34362adcecf6b76995de67ad899f6f33dfe9079593c1acd2984191',
    bytes: 3206299658,
  },
  gemmaTensorG6: {
    name: 'gemma-4-E2B-it_Google_Tensor_G6.litertlm',
    url: `${HF}/gemma-4-E2B-it_Google_Tensor_G6.litertlm`,
    sha256: 'd6cbe8d625f4965a8c32565f65ae774d19598d0d967a4c2101a7e04988daaf58',
    bytes: 3453960202,
  },
  benchPhoto: {
    name: 'test.jpg',
    url: 'https://raw.githubusercontent.com/robert-whiteley/sidekick/main/assets/bench/test.jpg',
    sha256: '1ff925eb7fc6cd39ababdfede93b2103a26638c26350a00f3da96157bd8c9ac9',
    bytes: 44731,
  },
} satisfies Record<string, ModelFile>;

/** "1.2 / 2.6 GB (46%)" */
export function formatProgress(bytes: number, total: number): string {
  const gb = (n: number) => (n / 1e9).toFixed(1);
  if (total <= 0) return `${gb(bytes)} GB`;
  return `${gb(bytes)} / ${gb(total)} GB (${Math.floor((bytes / total) * 100)}%)`;
}
