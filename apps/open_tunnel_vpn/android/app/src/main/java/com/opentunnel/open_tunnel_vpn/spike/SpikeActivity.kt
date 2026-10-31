package com.opentunnel.open_tunnel_vpn.spike

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.VpnService
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.opentunnel.open_tunnel_vpn.engines.EngineAdapter
import com.opentunnel.open_tunnel_vpn.engines.EngineConfig
import com.opentunnel.open_tunnel_vpn.engines.TunnelEngine
import com.wireguard.crypto.KeyPair

/** THROWAWAY launcher screen for the firewall spike: start, stop and copy the log. */
class SpikeActivity : Activity() {

  private lateinit var logView: TextView
  private var wireGuard: TunnelEngine? = null
  private val main = Handler(Looper.getMainLooper())
  private val refresh = object : Runnable {
    override fun run() {
      val state = if (FirewallSpikeService.isRunning()) "RUNNING" else "stopped"
      logView.text = "firewall: $state\n\n" + FirewallSpikeService.snapshot()
      main.postDelayed(this, 1000)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    FirewallSpikeService.init(filesDir)
    val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 160, 24, 24) }
    root.addView(button("Start firewall") { startFirewall() })
    root.addView(button("Stop firewall") { send(FirewallSpikeService.ACTION_STOP) })
    root.addView(button("Start WireGuard (fake peer)") { startWireGuard() })
    root.addView(button("Stop WireGuard") { stopWireGuard() })
    root.addView(button("Copy log") { copyLog() })
    logView = TextView(this).apply { setTextIsSelectable(true); textSize = 11f }
    root.addView(ScrollView(this).apply { addView(logView) })
    setContentView(root)
  }

  override fun onResume() {
    super.onResume()
    main.post(refresh)
  }

  override fun onPause() {
    main.removeCallbacks(refresh)
    super.onPause()
  }

  @Deprecated("Deprecated in Java")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode == VPN_CONSENT && resultCode == RESULT_OK) send(FirewallSpikeService.ACTION_START)
    else FirewallSpikeService.append("vpn permission not granted")
  }

  private fun startFirewall() {
    val consent = VpnService.prepare(this)
    if (consent == null) send(FirewallSpikeService.ACTION_START)
    else startActivityForResult(consent, VPN_CONSENT)
  }

  private fun send(action: String) {
    startForegroundService(Intent(this, FirewallSpikeService::class.java).setAction(action))
  }

  private fun startWireGuard() {
    Thread {
      try {
        val engine = EngineAdapter.engineFor("wireguard", applicationContext).also { wireGuard = it }
        val config = EngineConfig(
          nodeId = "spike", serverIp = "127.0.0.1", serverPort = 51820, protocol = "wireguard",
          configText = fakeWireGuardConfig(), dnsServers = listOf("1.1.1.1"),
          enableKillSwitch = false, disallowedApps = emptyList(),
        )
        val result = engine.start(config)
        FirewallSpikeService.append("wireguard start: connected=${result.connected} ${result.message ?: ""}")
      } catch (failure: Exception) {
        FirewallSpikeService.append("wireguard start failed: ${failure.javaClass.simpleName}: ${failure.message}")
      }
    }.start()
  }

  private fun stopWireGuard() {
    Thread {
      wireGuard?.stop()
      FirewallSpikeService.append("wireguard stop requested")
    }.start()
  }

  private fun fakeWireGuardConfig(): String = """
    [Interface]
    PrivateKey = ${KeyPair().privateKey.toBase64()}
    Address = 10.9.9.2/32
    DNS = 1.1.1.1

    [Peer]
    PublicKey = ${KeyPair().publicKey.toBase64()}
    AllowedIPs = 0.0.0.0/0
    Endpoint = 127.0.0.1:51820
  """.trimIndent()

  private fun copyLog() {
    val clipboard = getSystemService(ClipboardManager::class.java)
    clipboard.setPrimaryClip(ClipData.newPlainText("firewall spike log", FirewallSpikeService.snapshot()))
  }

  private fun button(label: String, onClick: () -> Unit) =
    Button(this).apply {
      text = label
      setOnClickListener {
        FirewallSpikeService.append("click: $label")
        onClick()
      }
    }

  private companion object {
    const val VPN_CONSENT = 4242
  }
}
