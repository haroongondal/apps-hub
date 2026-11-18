// Phone only (android.jar): stand-in for the extra loadThumbnail(512) per photo, kept apart so Bench runs on the Mac JVM.
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import java.util.Arrays;

public class Decode {
  public static void main(String[] a) {
    if (a.length != 2) { System.err.println("usage: Decode <jpeg> <loops>"); System.exit(2); }
    int loops = Integer.parseInt(a[1]);
    long[][] t = new long[4][loops];
    long sink = 0;
    BitmapFactory.Options o = new BitmapFactory.Options();
    o.inSampleSize = 4;
    int sw = 0, sh = 0;
    for (int k = 0; k < loops; k++) {
      long s = System.nanoTime();
      Bitmap big = BitmapFactory.decodeFile(a[0], o);
      if (big == null) { System.err.println("Decode: cannot decode " + a[0]); System.exit(1); }
      long d = System.nanoTime();
      int lg = Math.max(big.getWidth(), big.getHeight());
      sw = (big.getWidth() * 1024 + lg) / (2 * lg);
      sh = (big.getHeight() * 1024 + lg) / (2 * lg);
      Bitmap small = Bitmap.createScaledBitmap(big, sw, sh, true);
      long c = System.nanoTime();
      int[] argb = new int[sw * sh];
      small.getPixels(argb, 0, sw, 0, 0, sw, sh);
      long p = System.nanoTime();
      sink += argb[k % argb.length];
      big.recycle();
      small.recycle();
      t[0][k] = d - s; t[1][k] = c - d; t[2][k] = p - c; t[3][k] = p - s;
    }
    String[] names = {"decode", "scale", "pixels", "total"};
    System.out.printf("decode %s inSampleSize 4 -> %dx%d: first, then median and p90 of the other %d (ms)%n", a[0], sw, sh, loops - 1);
    for (int i = 0; i < names.length; i++) {
      long[] m = Arrays.copyOfRange(t[i], 1, loops);
      Arrays.sort(m);
      System.out.printf("  %-6s first=%8.3f median=%7.3f p90=%7.3f%n", names[i], t[i][0] / 1e6,
          m.length > 0 ? m[m.length / 2] / 1e6 : 0, m.length > 0 ? m[(int) Math.ceil(m.length * 0.9) - 1] / 1e6 : 0);
    }
    System.out.println("checksum " + Long.toHexString(sink));
  }
}
