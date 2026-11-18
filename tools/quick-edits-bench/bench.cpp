// usage: qe-bench <model.onnx> <input.f32> <d0,d1,d2,d3> <threads> <loops> <out.f32>
//        qe-bench post <threads ignored>
// First input and first output of the session; 2 untimed warm-ups; writes the first output as raw float32.
#include <onnxruntime_cxx_api.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
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

// ---- post mode: the cut-out's pre and post steps in plain C++, one thread, buffers allocated once ----
static const int SW = 4000, SH = 3000, M = 320;
static volatile uint32_t sink;

// Box-average each destination pixel's source rectangle, then (v / 255 - mean) / std into planar RGB.
static void downscale(const uint8_t* src, float* dst) {
  const float mean[3] = {0.485f, 0.456f, 0.406f}, inv_std[3] = {1 / 0.229f, 1 / 0.224f, 1 / 0.225f};
  for (int y = 0; y < M; y++) {
    const int y0 = y * SH / M, y1 = std::max(y0 + 1, (y + 1) * SH / M);
    for (int x = 0; x < M; x++) {
      const int x0 = x * SW / M, x1 = std::max(x0 + 1, (x + 1) * SW / M);
      uint32_t sum[3] = {0, 0, 0};
      for (int sy = y0; sy < y1; sy++)
        for (const uint8_t* p = src + (size_t(sy) * SW + x0) * 4; p < src + (size_t(sy) * SW + x1) * 4; p += 4) {
          sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2];
        }
      const float n = float((y1 - y0) * (x1 - x0)) * 255.f;
      for (int c = 0; c < 3; c++) dst[(c * M + y) * M + x] = (sum[c] / n - mean[c]) * inv_std[c];
    }
  }
}

// 320x320 float mask -> SWxSH uint8 (bilinear, half-pixel centres), then a separable 5-tap box blur (radius 2).
static void feather(const float* mask, uint8_t* alpha, uint8_t* tmp) {
  std::vector<int> xi(SW); std::vector<float> xf(SW);
  for (int x = 0; x < SW; x++) {
    const float fx = std::min(std::max((x + .5f) * M / SW - .5f, 0.f), M - 1.f);
    xi[x] = std::min(int(fx), M - 2); xf[x] = fx - xi[x];
  }
  for (int y = 0; y < SH; y++) {
    const float fy = std::min(std::max((y + .5f) * M / SH - .5f, 0.f), M - 1.f);
    const int yi = std::min(int(fy), M - 2);
    const float yf = fy - yi;
    const float *r0 = mask + yi * M, *r1 = r0 + M;
    uint8_t* o = tmp + size_t(y) * SW;
    for (int x = 0; x < SW; x++) {
      const float t = r0[xi[x]] + (r0[xi[x] + 1] - r0[xi[x]]) * xf[x];
      const float b = r1[xi[x]] + (r1[xi[x] + 1] - r1[xi[x]]) * xf[x];
      o[x] = uint8_t(std::min(std::max(t + (b - t) * yf, 0.f), 1.f) * 255.f + .5f);
    }
  }
  for (int y = 0; y < SH; y++) {  // horizontal: tmp -> alpha
    const uint8_t* s = tmp + size_t(y) * SW;
    uint8_t* o = alpha + size_t(y) * SW;
    for (int x = 0; x < SW; x++) {
      int sum = 0;
      for (int k = -2; k <= 2; k++) sum += s[std::min(std::max(x + k, 0), SW - 1)];
      o[x] = uint8_t(sum / 5);
    }
  }
  for (int y = 0; y < SH; y++) {  // vertical: alpha -> tmp, whose result is the final mask
    uint8_t* o = tmp + size_t(y) * SW;
    for (int x = 0; x < SW; x++) {
      int sum = 0;
      for (int k = -2; k <= 2; k++) sum += alpha[size_t(std::min(std::max(y + k, 0), SH - 1)) * SW + x];
      o[x] = uint8_t(sum / 5);
    }
  }
  std::memcpy(alpha, tmp, size_t(SW) * SH);
}

static int post() {
  std::vector<uint8_t> rgba(size_t(SW) * SH * 4), alpha(size_t(SW) * SH), tmp(size_t(SW) * SH);
  std::vector<float> tensor(3 * M * M), mask(M * M);
  uint32_t s = 12345;
  for (auto& b : rgba) { s = s * 1664525u + 1013904223u; b = uint8_t(s >> 24); }
  for (auto& m : mask) { s = s * 1664525u + 1013904223u; m = (s >> 8) / float(1 << 24); }
  std::vector<double> ta, tb, tc;
  for (int i = 0; i < 10; i++) {
    auto t0 = clk::now();
    downscale(rgba.data(), tensor.data());
    auto t1 = clk::now();
    feather(mask.data(), alpha.data(), tmp.data());
    auto t2 = clk::now();
    for (size_t p = 0; p < alpha.size(); p++) rgba[p * 4 + 3] = alpha[p];
    auto t3 = clk::now();
    ta.push_back(ms(t0, t1)); tb.push_back(ms(t1, t2)); tc.push_back(ms(t2, t3));
    sink = sink + rgba[3] + uint32_t(tensor[0] * 1000);
  }
  std::printf("post median_ms of 10: pre_downscale_%dx%d_to_%d=%.1f feather_upscale_blur=%.1f write_alpha=%.1f\n",
              SW, SH, M, median(ta), median(tb), median(tc));
  return 0;
}

int main(int argc, char** argv) {
  if (argc == 3 && std::strcmp(argv[1], "post") == 0) return post();
  if (argc != 7) {
    std::fprintf(stderr, "usage: qe-bench <model.onnx> <input.f32> <d0,d1,d2,d3> <threads> <loops> <out.f32> | qe-bench post <threads>\n");
    return 2;
  }
  std::vector<int64_t> shape;
  size_t count = 1;
  for (char* p = argv[3]; *p;) {
    char* end;
    const long d = std::strtol(p, &end, 10);
    if (end == p || d <= 0 || (*end && *end != ',')) { std::fprintf(stderr, "bad shape %s\n", argv[3]); return 2; }
    shape.push_back(d); count *= d;
    p = *end ? end + 1 : end;
  }
  if (shape.size() != 4) { std::fprintf(stderr, "shape needs 4 dims: %s\n", argv[3]); return 2; }
  const int threads = std::atoi(argv[4]);
  const size_t loops = std::max(1, std::atoi(argv[5]));

  std::ifstream in(argv[2], std::ios::binary | std::ios::ate);
  if (!in || static_cast<size_t>(in.tellg()) != count * sizeof(float)) {
    std::fprintf(stderr, "%s: expected %zu bytes for shape %s\n", argv[2], count * sizeof(float), argv[3]);
    return 1;
  }
  std::vector<float> input(count);  // one exact allocation
  in.seekg(0).read(reinterpret_cast<char*>(input.data()), count * sizeof(float));

  Ort::Env env(ORT_LOGGING_LEVEL_WARNING, "qe-bench");
  Ort::SessionOptions so;
  so.SetIntraOpNumThreads(threads);
  so.SetInterOpNumThreads(1);
  so.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
  const long rss_before_kb = status_kb("VmRSS:");
  auto t0 = clk::now();
  Ort::Session session(env, argv[1], so);
  const double load = ms(t0, clk::now());

  Ort::AllocatorWithDefaultOptions alloc;
  auto in_name = session.GetInputNameAllocated(0, alloc);
  auto out_name = session.GetOutputNameAllocated(0, alloc);
  const char* in_names[] = {in_name.get()};
  const char* out_names[] = {out_name.get()};
  auto mem = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);

  auto run = [&]() {
    Ort::Value x = Ort::Value::CreateTensor<float>(mem, input.data(), count, shape.data(), shape.size());
    return std::move(session.Run(Ort::RunOptions{nullptr}, in_names, &x, 1, out_names, 1)[0]);
  };

  for (int w = 0; w < 2; w++) run();

  std::vector<double> times(loops);
  std::vector<int64_t> out_shape;
  for (size_t j = 0; j < loops; j++) {
    auto a = clk::now();
    Ort::Value y = run();
    times[j] = ms(a, clk::now());
    if (j == 0) {
      auto info = y.GetTensorTypeAndShapeInfo();
      if (info.GetElementType() != ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT) { std::fprintf(stderr, "output is not float32\n"); return 1; }
      out_shape = info.GetShape();
      std::ofstream(argv[6], std::ios::binary).write(reinterpret_cast<const char*>(y.GetTensorData<float>()), info.GetElementCount() * sizeof(float));
    }
  }

  std::vector<double> sorted = times;
  std::sort(sorted.begin(), sorted.end());
  const size_t k = std::min<size_t>(20, loops);
  const long hwm_kb = status_kb("VmHWM:");
  std::string shp;
  for (size_t i = 0; i < out_shape.size(); i++) shp += (i ? "x" : "") + std::to_string(out_shape[i]);
  std::printf("load_ms=%.0f runs=%zu median_ms=%.1f p90_ms=%.1f first20_ms=%.1f last20_ms=%.1f "
              "rss_before_session_kb=%ld vm_hwm_kb=%ld model_kb=%ld out_shape=%s\n",
              load, loops, median(times), sorted[std::min(loops - 1, loops * 9 / 10)],
              median({times.begin(), times.begin() + k}), median({times.end() - k, times.end()}),
              rss_before_kb, hwm_kb, hwm_kb - rss_before_kb, shp.c_str());
  return 0;
}
