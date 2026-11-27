import com.google.ai.edge.litertlm.*;
import java.io.*;
import java.lang.reflect.Constructor;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.CountDownLatch;

/**
 * Runs a prompt set through LiteRT-LM's Android library (litertlm-android, any version) the way
 * LlmEngine.kt does: one Engine, a one-token check, then a fresh Conversation with the system
 * prompt per case, streamed. One JSON line per case: first-word time, total, token speeds, peak
 * memory (VmHWM) and the answer. See bench/README.md "Chat models".
 * Usage: app_process ... Main <model> <cpu|gpu> <prompts.jsonl> <imageDir> <out.jsonl> [ids,...]
 * Env: MC_CACHE (compiled-weights cache dir), MC_NOVISION (text-only model),
 * MC_SAMPLER "topK,topP,temp" (else the model file's own), MC_RENDER (print the chat template).
 */
public class Main {
  static long hwmKb() {
    try {
      for (String l : Files.readAllLines(Paths.get("/proc/self/status")))
        if (l.startsWith("VmHWM:")) return Long.parseLong(l.replaceAll("[^0-9]", ""));
    } catch (IOException e) {}
    return -1;
  }

  static Backend backend(String b) { return b.equals("gpu") ? new Backend.GPU() : new Backend.CPU(); }

  static ConversationConfig convConfig(String system) throws Exception {
    Constructor<?> k = null;
    for (Constructor<?> c : ConversationConfig.class.getConstructors())
      if (c.getParameterCount() == 17) k = c;
    Class<?>[] t = k.getParameterTypes();
    Object[] a = new Object[17];
    for (int i = 0; i < 15; i++) a[i] = t[i] == boolean.class ? false : null;
    a[0] = Contents.Companion.of(Collections.singletonList(new Content.Text(system)));
    a[15] = ~1; // every argument but the system prompt takes its default
    String sm = System.getenv("MC_SAMPLER"); // "topK,topP,temp"
    if (sm != null) {
      String[] v = sm.split(",");
      a[3] = new SamplerConfig(Integer.parseInt(v[0]), Double.parseDouble(v[1]), Double.parseDouble(v[2]), 0);
      a[15] = ~(1 | 8);
    }
    a[16] = null;
    return (ConversationConfig) k.newInstance(a);
  }

  static String jget(String json, String key) {
    // Minimal JSON string field reader (the prompt file is ours).
    String pat = "\"" + key + "\":";
    int i = json.indexOf(pat);
    if (i < 0) return null;
    i += pat.length();
    if (json.charAt(i) != '"') {
      int j = i;
      while (j < json.length() && ",}".indexOf(json.charAt(j)) < 0) j++;
      return json.substring(i, j);
    }
    StringBuilder sb = new StringBuilder();
    for (int j = i + 1; j < json.length(); j++) {
      char c = json.charAt(j);
      if (c == '\\') {
        char n = json.charAt(++j);
        switch (n) {
          case 'n': sb.append('\n'); break;
          case 't': sb.append('\t'); break;
          case 'u': sb.append((char) Integer.parseInt(json.substring(j + 1, j + 5), 16)); j += 4; break;
          default: sb.append(n);
        }
      } else if (c == '"') break;
      else sb.append(c);
    }
    return sb.toString();
  }

  static String esc(String s) {
    StringBuilder sb = new StringBuilder();
    for (char c : s.toCharArray()) {
      if (c == '"' || c == '\\') sb.append('\\').append(c);
      else if (c == '\n') sb.append("\\n");
      else if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
      else sb.append(c);
    }
    return sb.toString();
  }

  public static void main(String[] args) throws Exception {
    String model = args[0], be = args[1], prompts = args[2], imgDir = args[3], out = args[4];
    Set<String> only = args.length > 5 ? new HashSet<>(Arrays.asList(args[5].split(","))) : null;
    ExperimentalFlags.INSTANCE.setEnableBenchmark(true);
    long t0 = System.nanoTime();
    EngineConfig cfg = new EngineConfig(model, backend(be), System.getenv("MC_NOVISION") != null ? null : backend(be), null, 4096, null, System.getenv("MC_CACHE") != null ? System.getenv("MC_CACHE") : "/data/local/tmp/mc/cache");
    Engine e = new Engine(cfg);
    e.initialize();
    try (Conversation w = e.createConversation(convConfig("You are a helpful assistant."))) {
      w.sendMessage("Hi", java.util.Collections.emptyMap(), null, null, null, 1); // same one-token check as LlmEngine.load
    }
    if (System.getenv("MC_RENDER") != null) {
      try (Conversation w = e.createConversation(convConfig("SYSTEM TEXT"))) {
        System.out.println("PREFACE<<" + w.renderPrefaceIntoString() + ">>");
        System.out.println("USER<<" + w.renderMessageIntoString(Message.Companion.of("USER TEXT"), java.util.Collections.emptyMap()) + ">>");
      }
      return;
    }
    double loadS = (System.nanoTime() - t0) / 1e9;
    long hwmLoad = hwmKb();
    PrintWriter pw = new PrintWriter(new FileWriter(out, true));
    pw.println("{\"event\":\"load\",\"model\":\"" + esc(model) + "\",\"backend\":\"" + be + "\",\"load_s\":" + loadS + ",\"hwm_kb\":" + hwmLoad + "}");
    pw.flush();
    for (String line : Files.readAllLines(Paths.get(prompts))) {
      if (line.isBlank()) continue;
      String id = jget(line, "id");
      if (only != null && !only.contains(id)) continue;
      String system = jget(line, "system"), prompt = jget(line, "prompt"), image = jget(line, "image");
      int max = Integer.parseInt(jget(line, "max").trim());
      List<Content> parts = new ArrayList<>();
      if (image != null && !image.equals("null")) parts.add(new Content.ImageFile(imgDir + "/" + image));
      parts.add(new Content.Text(prompt));
      StringBuilder text = new StringBuilder();
      long[] first = {0};
      String[] err = {null};
      CountDownLatch done = new CountDownLatch(1);
      long s = System.nanoTime();
      try (Conversation c = e.createConversation(convConfig(system))) {
        c.sendMessageAsync(Contents.Companion.of(parts), new MessageCallback() {
          public void onMessage(Message m) {
            String t = m.toString();
            if (!t.isEmpty() && first[0] == 0) first[0] = System.nanoTime();
            text.append(t);
          }
          public void onDone() { done.countDown(); }
          public void onError(Throwable t) { err[0] = String.valueOf(t); done.countDown(); }
        }, java.util.Collections.emptyMap(), null, null, null, max);
        done.await();
        long end = System.nanoTime();
        BenchmarkInfo b = null;
        try { b = c.getBenchmarkInfo(); } catch (Throwable t) {}
        String r = "{\"id\":\"" + id + "\",\"first_s\":" + (first[0] == 0 ? -1 : (first[0] - s) / 1e9)
            + ",\"total_s\":" + (end - s) / 1e9
            + (b != null ? ",\"prefill_tok\":" + b.getLastPrefillTokenCount() + ",\"prefill_tps\":" + b.getLastPrefillTokensPerSecond()
                + ",\"decode_tok\":" + b.getLastDecodeTokenCount() + ",\"decode_tps\":" + b.getLastDecodeTokensPerSecond() : "")
            + ",\"hwm_kb\":" + hwmKb() + (err[0] != null ? ",\"error\":\"" + esc(err[0]) + "\"" : "")
            + ",\"text\":\"" + esc(text.toString()) + "\"}";
        pw.println(r);
        pw.flush();
        System.out.println(id + " " + String.format("%.1fs", (end - s) / 1e9));
      }
    }
    pw.close();
    e.close();
  }
}
