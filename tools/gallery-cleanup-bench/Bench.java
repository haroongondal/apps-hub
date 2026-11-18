// Straight port of ref.py's recipes (its docstring), fed the ARGB int[] Bitmap.getPixels gives Kotlin; Java 11 for ART.
import java.io.BufferedInputStream;
import java.io.DataInputStream;
import java.io.FileInputStream;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.List;
import java.util.Random;

public class Bench {
  static final String USAGE = "usage: Bench check <dir with expected.txt (name w h grey_sha256 dhash mean spread lap)"
      + " and <name>.argb big-endian ARGB ints> | time <w> <h> <loops> (1 first loop, 49 warm-up, then <loops>)";

  static byte[] grey(int[] argb) {
    byte[] g = new byte[argb.length];
    for (int i = 0; i < argb.length; i++) {
      int p = argb[i];
      g[i] = (byte) ((19595 * ((p >> 16) & 255) + 38470 * ((p >> 8) & 255) + 7471 * (p & 255) + 32768) >> 16);
    }
    return g;
  }

  static long dhash(byte[] g, int w, int h) {
    long[][] s = new long[8][9];
    long[] row = new long[9];
    for (int y = 0; y < h; y++) {
      Arrays.fill(row, 0);
      int base = y * w;
      for (int x = 0; x < w; x++) {
        int v = g[base + x] & 255;
        for (int j = 9 * x / w, j1 = Math.min(8, (9 * x + 8) / w); j <= j1; j++)
          row[j] += (long) (Math.min(9 * x + 9, (j + 1) * w) - Math.max(9 * x, j * w)) * v;
      }
      for (int i = 8 * y / h, i1 = Math.min(7, (8 * y + 7) / h); i <= i1; i++) {
        long wy = Math.min(8 * y + 8, (i + 1) * h) - Math.max(8 * y, i * h);
        for (int j = 0; j < 9; j++) s[i][j] += wy * row[j];
      }
    }
    long hash = 0;
    for (int i = 0; i < 8; i++)
      for (int j = 0; j < 8; j++) hash = (hash << 1) | (s[i][j] < s[i][j + 1] ? 1 : 0);
    return hash;
  }

  static double[] brightness(byte[] g) {
    long n = g.length, s1 = 0, s2 = 0;
    for (byte b : g) { int v = b & 255; s1 += v; s2 += v * v; }
    return new double[] {(double) s1 / n / 255, Math.sqrt((double) (n * s2 - s1 * s1)) / n / 255};
  }

  static double laplacianVar(byte[] g, int w, int h) {
    if (w < 3 || h < 3) return 0.0;
    long t1 = 0, t2 = 0, m = (long) (w - 2) * (h - 2);
    for (int y = 1; y < h - 1; y++) {
      int c = y * w;
      for (int x = 1; x < w - 1; x++) {
        int i = c + x;
        long o = (g[i - w] & 255) + (g[i + w] & 255) + (g[i - 1] & 255) + (g[i + 1] & 255) - 4 * (g[i] & 255);
        t1 += o;
        t2 += o * o;
      }
    }
    return (double) (m * t2 - t1 * t1) / (double) (m * m);
  }

  static boolean close(double a, double b, double rel) {
    return Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b));
  }

  static int check(String dir) throws Exception {
    List<String> lines = Files.readAllLines(Paths.get(dir, "expected.txt"));
    int fails = 0;
    for (String line : lines) {
      String[] f = line.trim().split(" ");
      int w = Integer.parseInt(f[1]), h = Integer.parseInt(f[2]);
      int[] argb = new int[w * h];
      try (DataInputStream in = new DataInputStream(new BufferedInputStream(new FileInputStream(dir + "/" + f[0] + ".argb")))) {
        for (int i = 0; i < argb.length; i++) argb[i] = in.readInt();
      }
      byte[] g = grey(argb);
      StringBuilder sha = new StringBuilder();
      for (byte b : MessageDigest.getInstance("SHA-256").digest(g)) sha.append(String.format("%02x", b));
      String hash = String.format("%016x", dhash(g, w, h));
      double[] br = brightness(g);
      double lap = laplacianVar(g, w, h);
      boolean shaOk = sha.toString().equals(f[3]);
      boolean ok = shaOk && hash.equals(f[4])
          && close(br[0], Double.parseDouble(f[5]), 1e-12) && close(br[1], Double.parseDouble(f[6]), 1e-12)
          && close(lap, Double.parseDouble(f[7]), 1e-9);
      if (!ok) fails++;
      System.out.printf("%s %-6s %dx%d dhash=%s grey_sha=%s bright=%s,%s lap=%s%n", ok ? "PASS" : "FAIL", f[0], w, h, hash,
          shaOk ? "ok" : sha, br[0], br[1], lap);
    }
    System.out.println(fails == 0 ? "check: all " + lines.size() + " PASS" : "check: " + fails + " FAIL");
    return lines.isEmpty() || fails > 0 ? 1 : 0;
  }

  static int[] synthetic(int w, int h) {
    Random r = new Random(20261118L);
    int[] argb = new int[w * h];
    int[][] rects = new int[6][7];
    for (int[] q : rects) {
      q[0] = r.nextInt(w); q[1] = r.nextInt(h); q[2] = q[0] + 10 + r.nextInt(w / 3); q[3] = q[1] + 10 + r.nextInt(h / 3);
      q[4] = r.nextInt(256); q[5] = r.nextInt(256); q[6] = r.nextInt(256);
    }
    for (int y = 0; y < h; y++)
      for (int x = 0; x < w; x++) {
        double rr = 200.0 * x / w + 30, gg = 180.0 * y / h + 40, bb = 120 + 60 * Math.sin(x * 0.03 + y * 0.02);
        for (int[] q : rects)
          if (x >= q[0] && x < q[2] && y >= q[1] && y < q[3]) { rr = q[4]; gg = q[5]; bb = q[6]; }
        int n = (int) Math.round(r.nextGaussian() * 6);
        argb[y * w + x] = 0xff000000 | clamp(rr + n) << 16 | clamp(gg + n) << 8 | clamp(bb + n);
      }
    return argb;
  }

  static int clamp(double v) { return (int) Math.max(0, Math.min(255, Math.round(v))); }

  static int time(int w, int h, int loops) {
    int[] argb = synthetic(w, h);
    String[] names = {"grey", "dhash", "bright", "laplac", "total"};
    int warm = 50;
    long[][] t = new long[names.length][warm + loops];
    long sink = 0;
    for (int k = 0; k < warm + loops; k++) {
      long a = System.nanoTime();
      byte[] g = grey(argb);
      long b = System.nanoTime();
      long d = dhash(g, w, h);
      long c = System.nanoTime();
      double[] br = brightness(g);
      long e = System.nanoTime();
      double lap = laplacianVar(g, w, h);
      long f = System.nanoTime();
      sink += d ^ g[k % g.length] ^ Double.doubleToLongBits(br[0] + br[1] + lap); // so the JIT cannot drop the work
      t[0][k] = b - a; t[1][k] = c - b; t[2][k] = e - c; t[3][k] = f - e; t[4][k] = f - a;
    }
    System.out.printf("time %dx%d: first loop, then median and p90 of %d loops after %d warm-up (ms)%n", w, h, loops, warm);
    for (int s = 0; s < names.length; s++) {
      long[] m = Arrays.copyOfRange(t[s], warm, warm + loops);
      Arrays.sort(m);
      System.out.printf("  %-6s first=%8.3f median=%7.3f p90=%7.3f%n", names[s], t[s][0] / 1e6, m[loops / 2] / 1e6,
          m[(int) Math.ceil(loops * 0.9) - 1] / 1e6);
    }
    System.out.println("checksum " + Long.toHexString(sink));
    return 0;
  }

  public static void main(String[] a) throws Exception {
    String mode = a.length > 0 ? a[0] : "";
    int rc;
    if (mode.equals("check") && a.length == 2) rc = check(a[1]);
    else if (mode.equals("time") && a.length == 4 && Integer.parseInt(a[3]) > 0)
      rc = time(Integer.parseInt(a[1]), Integer.parseInt(a[2]), Integer.parseInt(a[3]));
    else { System.err.println(USAGE); rc = 2; }
    System.exit(rc);
  }
}
