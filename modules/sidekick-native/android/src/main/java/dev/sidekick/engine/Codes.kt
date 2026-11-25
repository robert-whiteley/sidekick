package dev.sidekick.engine

import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.wifi.WifiNetworkSuggestion
import android.os.Build
import android.provider.Settings
import android.util.Log
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.NotFoundException
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.multi.GenericMultipleBarcodeReader
import org.json.JSONArray
import org.json.JSONObject

/**
 * QR codes and barcodes in a picture, read on the phone with ZXing (Apache-2.0; no network, no
 * Google services). Also the Wi-Fi hand-off for a Wi-Fi QR code: Android's own "Save network?"
 * sheet, so Sidekick needs no Wi-Fi permission and never joins by itself.
 */
object Codes {
  private const val TAG = "SidekickCodes"
  private const val MAX_SIDE = 1600

  /** JSON array of {format, text} for every code found in the JPEG at [path] (empty if none). */
  fun scan(path: String): String {
    val out = JSONArray()
    try {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(path, bounds)
      var sample = 1
      while (maxOf(bounds.outWidth, bounds.outHeight) / sample > MAX_SIDE) sample *= 2
      val bmp = BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
        ?: return out.toString()
      val px = IntArray(bmp.width * bmp.height)
      bmp.getPixels(px, 0, bmp.width, 0, 0, bmp.width, bmp.height)
      val bitmap = BinaryBitmap(HybridBinarizer(RGBLuminanceSource(bmp.width, bmp.height, px)))
      bmp.recycle()
      val hints =
        mapOf(
          DecodeHintType.TRY_HARDER to true,
          DecodeHintType.POSSIBLE_FORMATS to BarcodeFormat.values().toList(),
        )
      val reader = MultiFormatReader().apply { setHints(hints) }
      val results =
        try {
          GenericMultipleBarcodeReader(reader).decodeMultiple(bitmap, hints).toList()
        } catch (e: NotFoundException) {
          emptyList()
        }
      val seen = HashSet<String>()
      for (r in results) {
        if (!seen.add(r.text)) continue
        out.put(JSONObject().put("format", r.barcodeFormat.name).put("text", r.text))
      }
    } catch (e: Exception) {
      Log.w(TAG, "scan failed", e)
    }
    return out.toString()
  }

  /** Shows the system sheet to save the network (Android 11+); false when it can't be shown. */
  fun addWifi(context: Context, ssid: String, password: String?, security: String): Boolean {
    if (Build.VERSION.SDK_INT < 30) return false
    return try {
      val b = WifiNetworkSuggestion.Builder().setSsid(ssid)
      when (security.uppercase()) {
        "WPA", "WPA2" -> if (!password.isNullOrEmpty()) b.setWpa2Passphrase(password)
        "WPA3", "SAE" -> if (!password.isNullOrEmpty()) b.setWpa3Passphrase(password)
        else -> {} // open network
      }
      val list = arrayListOf(b.build())
      context.startActivity(
        Intent(Settings.ACTION_WIFI_ADD_NETWORKS)
          .putParcelableArrayListExtra(Settings.EXTRA_WIFI_NETWORK_LIST, list)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
      true
    } catch (e: Exception) {
      Log.w(TAG, "wifi add failed", e)
      false
    }
  }
}
