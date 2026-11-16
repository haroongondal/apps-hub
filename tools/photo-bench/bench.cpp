// usage: clip-bench <model.onnx> <input.bin> <image|text> <threads> <out.f32>
// Batch 1 per run, as the app's index job runs; 2 untimed warm-ups; writes N x 512 raw float32.
#include <onnxruntime_cxx_api.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

using clk = std::chrono::steady_clock;
static double ms(clk::time_point a, clk::time_point b) { return std::chrono::duration<double, std::milli>(b - a).count(); }

static double median(std::vector<double> v) {
  std::sort(v.begin(), v.end());
  return v.empty() ? 0 : v[v.size() / 2];
}

static long status_kb(const char* key) {
  std::ifstream f("/proc/self/status");
  std::string line;
  while (std::getline(f, line))
    if (line.rfind(key, 0) == 0) return std::stol(line.substr(std::strlen(key)));
  return -1;
}

int main(int argc, char** argv) {
  if (argc != 6) {
    std::fprintf(stderr, "usage: clip-bench <model.onnx> <input.bin> <image|text> <threads> <out.f32>\n");
    return 2;
  }
  const bool image = std::strcmp(argv[3], "image") == 0;
  if (!image && std::strcmp(argv[3], "text") != 0) { std::fprintf(stderr, "kind must be image or text\n"); return 2; }
  const int threads = std::atoi(argv[4]);

  std::ifstream in(argv[2], std::ios::binary | std::ios::ate);
  std::vector<char> buf(in ? static_cast<size_t>(in.tellg()) : 0);
  in.seekg(0).read(buf.data(), buf.size());
  const size_t row_bytes = image ? 3 * 224 * 224 * sizeof(float) : 77 * sizeof(int64_t);
  if (buf.empty() || buf.size() % row_bytes) {
    std::fprintf(stderr, "%s: %zu bytes is not a whole number of %zu-byte rows\n", argv[2], buf.size(), row_bytes);
    return 1;
  }
  const size_t n = buf.size() / row_bytes;

  Ort::Env env(ORT_LOGGING_LEVEL_WARNING, "clip-bench");
  Ort::SessionOptions so;
  so.SetIntraOpNumThreads(threads);
  so.SetInterOpNumThreads(1);
  const char* opt = std::getenv("CLIP_BENCH_OPT");
  so.SetGraphOptimizationLevel(opt && *opt == '0' ? GraphOptimizationLevel::ORT_DISABLE_ALL
                               : opt && *opt == '1' ? GraphOptimizationLevel::ORT_ENABLE_BASIC
                                                    : GraphOptimizationLevel::ORT_ENABLE_ALL);
  const long rss_before_kb = status_kb("VmRSS:");
  auto t0 = clk::now();
  Ort::Session session(env, argv[1], so);
  const double load = ms(t0, clk::now());

  const char* in_name = image ? "pixel_values" : "input_ids";
  const char* out_name = image ? "image_embeds" : "text_embeds";
  auto mem = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
  const bool unpadded = std::getenv("CLIP_BENCH_UNPADDED") != nullptr;

  auto run = [&](size_t i) {
    char* row = buf.data() + i * row_bytes;
    int64_t len = 77;
    // Causal attention: tokens after the first end-of-text (49407) never reach its output, so they can be dropped.
    if (!image && unpadded) len = std::find(reinterpret_cast<int64_t*>(row), reinterpret_cast<int64_t*>(row) + 76, 49407) - reinterpret_cast<int64_t*>(row) + 1;
    const std::vector<int64_t> shape = image ? std::vector<int64_t>{1, 3, 224, 224} : std::vector<int64_t>{1, len};
    Ort::Value x = image
        ? Ort::Value::CreateTensor<float>(mem, reinterpret_cast<float*>(row), 3 * 224 * 224, shape.data(), shape.size())
        : Ort::Value::CreateTensor<int64_t>(mem, reinterpret_cast<int64_t*>(row), len, shape.data(), shape.size());
    return std::move(session.Run(Ort::RunOptions{nullptr}, &in_name, &x, 1, &out_name, 1)[0]);
  };

  for (int w = 0; w < 2; w++) run(0);

  const char* loops_env = std::getenv("CLIP_BENCH_LOOPS");
  const size_t loops = loops_env ? std::max(1, std::atoi(loops_env)) : 1;
  const size_t total = n * loops;
  std::vector<float> out(n * 512);
  std::vector<double> times(total);
  for (size_t j = 0; j < total; j++) {
    auto a = clk::now();
    Ort::Value y = run(j % n);
    times[j] = ms(a, clk::now());
    if (j < n) std::memcpy(&out[j * 512], y.GetTensorData<float>(), 512 * sizeof(float));
  }

  std::ofstream(argv[5], std::ios::binary).write(reinterpret_cast<char*>(out.data()), out.size() * sizeof(float));

  std::vector<double> sorted = times;
  std::sort(sorted.begin(), sorted.end());
  const size_t k = std::min<size_t>(20, total);
  const long hwm_kb = status_kb("VmHWM:");
  std::printf("load_ms=%.0f n=%zu runs=%zu median_ms=%.1f p90_ms=%.1f first20_ms=%.1f last20_ms=%.1f "
              "rss_before_session_kb=%ld vm_hwm_kb=%ld model_kb=%ld\n",
              load, n, total, median(times), sorted[std::min(total - 1, total * 9 / 10)],
              median({times.begin(), times.begin() + k}), median({times.end() - k, times.end()}),
              rss_before_kb, hwm_kb, hwm_kb - rss_before_kb);
  return 0;
}
