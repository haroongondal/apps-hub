package com.arthenica.smartexception.java

import java.io.PrintWriter
import java.io.StringWriter

// shortcut: a stand-in for com.arthenica:smart-exception-java, which ffmpeg-kit-min 8.1.7 calls (FFmpegKitConfig, AbstractSession,
// NativeLoader, AsyncFFmpegExecuteTask) but its POM never declares, so the class is missing from the APK and every FFmpeg job died
// with NoClassDefFoundError. Only these two static methods are called (checked with javap on the AAR). If a later fork version
// declares the real artifact, the build fails with a duplicate class and this file is deleted.
object Exceptions {
  @JvmStatic fun registerRootPackage(@Suppress("UNUSED_PARAMETER") rootPackage: String) = Unit

  @JvmStatic fun getStackTraceString(error: Throwable): String = StringWriter().also { error.printStackTrace(PrintWriter(it)) }.toString()
}
