package dev.sidekick.engine

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import java.io.File
import java.security.MessageDigest

/**
 * Large-file downloads through Android's DownloadManager: survives the app being backgrounded,
 * retries on network drops, and shows a system notification.
 */
class Downloads(private val context: Context) {
  private val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

  fun start(url: String, destPath: String, title: String, wifiOnly: Boolean): Long {
    val dest = File(destPath)
    dest.parentFile?.mkdirs()
    File("$destPath.part").delete()
    val req =
      DownloadManager.Request(Uri.parse(url))
        .setTitle(title)
        .setDestinationUri(Uri.fromFile(File("$destPath.part")))
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setAllowedOverMetered(!wifiOnly)
        .setAllowedOverRoaming(false)
    return dm.enqueue(req)
  }

  /** Returns status ("pending" | "running" | "paused" | "done" | "failed"), bytes so far and total. */
  fun status(id: Long): Map<String, Any> {
    dm.query(DownloadManager.Query().setFilterById(id)).use { c ->
      if (!c.moveToFirst()) return mapOf("status" to "failed", "bytes" to 0L, "total" to -1L, "reason" to -1)
      val st = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
      val name =
        when (st) {
          DownloadManager.STATUS_PENDING -> "pending"
          DownloadManager.STATUS_RUNNING -> "running"
          DownloadManager.STATUS_PAUSED -> "paused"
          DownloadManager.STATUS_SUCCESSFUL -> "done"
          else -> "failed"
        }
      return mapOf(
        "status" to name,
        "bytes" to c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)),
        "total" to c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)),
        "reason" to c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)),
      )
    }
  }

  fun cancel(id: Long) {
    dm.remove(id)
  }

  /** Verifies the finished ".part" file against [sha256] and moves it into place. */
  fun finish(destPath: String, sha256: String): Boolean {
    val part = File("$destPath.part")
    val actual = sha256Of(part)
    if (!actual.equals(sha256, ignoreCase = true)) {
      part.delete()
      return false
    }
    return part.renameTo(File(destPath))
  }

  companion object {
    fun sha256Of(file: File): String {
      val md = MessageDigest.getInstance("SHA-256")
      file.inputStream().use { input ->
        val buf = ByteArray(1 shl 20)
        while (true) {
          val n = input.read(buf)
          if (n < 0) break
          md.update(buf, 0, n)
        }
      }
      return md.digest().joinToString("") { "%02x".format(it) }
    }
  }
}
