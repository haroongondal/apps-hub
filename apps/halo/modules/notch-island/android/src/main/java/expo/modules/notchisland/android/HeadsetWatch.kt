package expo.modules.notchisland.android

import android.Manifest
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import expo.modules.notchisland.core.Transient
import expo.modules.notchisland.core.Transients

// The audio device callback, not ACL_CONNECTED: ACL broadcasts need BLUETOOTH_CONNECT just to arrive on Android 12+ and fire for watches and cars too. The callback needs no permission and lists audio outputs only.
class HeadsetWatch(private val context: Context, private val onEvent: (Transient) -> Unit) {
  private val audio = context.getSystemService(AudioManager::class.java)
  private var known: Map<String, String?> = emptyMap()
  private val callback = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = update()
    override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = update()
  }

  fun register() {
    // Seeded first, so the callback's replay of the devices already connected stays quiet.
    known = current()
    audio.registerAudioDeviceCallback(callback, null)
  }

  fun unregister() = audio.unregisterAudioDeviceCallback(callback)

  private fun update() {
    val now = current()
    val changes = Transients.headsetChanges(known, now)
    known = now
    changes.forEach(onEvent)
  }

  private fun current(): Map<String, String?> {
    val out = mutableMapOf<String, String?>()
    for (d in audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
      val key = Transients.headsetKey(d.type, d.address) ?: continue
      out[key] = out[key] ?: if (key == Transients.WIRED_KEY) null else name(d)
    }
    return out
  }

  private fun name(d: AudioDeviceInfo): String? {
    if (context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) return null
    return runCatching { context.getSystemService(BluetoothManager::class.java).adapter?.getRemoteDevice(d.address)?.let { it.alias ?: it.name } }.getOrNull()
      ?: d.productName?.toString()
  }
}
