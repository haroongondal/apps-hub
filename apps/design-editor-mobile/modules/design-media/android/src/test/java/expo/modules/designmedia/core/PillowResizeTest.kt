package expo.modules.designmedia.core

import org.junit.Assert.assertArrayEquals
import org.junit.Test

// Expected values are Pillow 13.0.0, each band resized as an "L" image (the C core works per channel).
class PillowResizeTest {
  private fun src(w: Int, h: Int) = IntArray(w * h) { i ->
    val x = i % w
    val y = i / w
    (0 until 4).fold(0) { acc, c -> (acc shl 8) or ((x * 37 + y * y * 11 + c * 71 + x * y * 5) % 256) }
  }

  @Test
  fun lanczosVerticalFirstMatchesPillow() {
    // 6x20 -> 5x4: (20 - 4) > 2 * (6 - 5), so Pillow runs the vertical pass first.
    val expected = longArrayOf(
      0x4486A580, 0x6B8E9867, 0x8E738079, 0x95926B78, 0x865E878B, 0x757E6D85, 0x7F768696, 0x838A9B90, 0x9180826F, 0x8074827F,
      0x569B9D31, 0xA18A4CA5, 0x827DA670, 0x95AB7173, 0x8F6C82A6, 0x798B8E8C, 0x80767F8A, 0x97818A7E, 0x8F6F9D89, 0x7C6C9871,
    ).map { it.toInt() }.toIntArray()
    assertArrayEquals(expected, resize(src(6, 20), 6, 20, 5, 4, Filter.LANCZOS))
  }

  @Test
  fun bilinearShrinkOneAxisGrowOtherMatchesPillow() {
    val expected = longArrayOf(
      0x2C73BAA7, 0x8D8C8064, 0x694484BC, 0x609B6E6A, 0x9C4F5797, 0x46799C4F, 0x93963C68, 0x357CB57F, 0x929B6F72, 0x5D5A9393,
      0x78A3666D, 0x765C7886, 0x68937E57, 0xA378619A, 0x4486AC51, 0x979A6085, 0x55779769, 0x89A06374, 0x556E976F, 0x8A9D656A,
      0xA8697EBA, 0x5D8E9C3E, 0x975A6D9B, 0x67956F68, 0x71727485, 0x6B848E5A, 0x90607B9B, 0x7CA86073, 0x838F8658, 0x935F8A82,
      0x758A6F75, 0x647A9173, 0x717B8871, 0x84779285, 0x668E747A, 0xA08B767F, 0x8A779D68, 0x7877797F, 0x668E9E66, 0x7370848B,
      0x71949C67, 0x686F848E, 0x9B827FA5, 0x7C85837D, 0x5E797A76, 0x8E94728D, 0x77858A85, 0x5E75827C, 0x9A9E5B80, 0x7C848A92,
      0x6F7A7D88, 0x65717378, 0x82836B81, 0x8B797E7B, 0x7B887079, 0x93AA7F68, 0x5D899176, 0x656B7C8D, 0x71696B7C, 0x6B716E6B,
      0x9E677173, 0x9CA26371, 0x7EAAAD53,
    ).map { it.toInt() }.toIntArray()
    assertArrayEquals(expected, resize(src(20, 6), 20, 6, 7, 9, Filter.BILINEAR))
  }

  @Test
  fun sameSizeIsACopy() {
    val a = src(5, 3)
    assertArrayEquals(a, resize(a, 5, 3, 5, 3, Filter.LANCZOS))
  }
}
