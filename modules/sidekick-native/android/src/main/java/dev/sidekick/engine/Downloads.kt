package dev.sidekick.engine

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.system.Os
import java.io.File
import java.security.MessageDigest

/** rwxrws---: owner and group may write, new files keep the group (setgid). */
private const val GROUP_SHARED = 0b010_111_111_000

/**
 * Large-file downloads through Android's DownloadManager: survives the app being backgrounded,
 * retries on network drops, and shows a system notification.
 */
class Downloads(private val context: Context) {
  private val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

  fun start(url: String, destPath: String, title: String, wifiOnly: Boolean): Long {
    // The app may have been closed mid-download: keep following that job instead of restarting.
    existing(destPath)?.let { return it }
    val dest = File(destPath)
    dest.parentFile?.let { openToDownloader(it) }
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

  /**
   * The system downloader writes as another user in the folder's group, but a folder the app
   * makes itself is owner-only (drwx--S---): Whisper's files, in their own folder, waited forever
   * with "Failed to generate filename: Permission denied" (seen on the Pixel 5). Opens [dir] and
   * any parents the app just made to the group, like the models folder itself (drwxrws---).
   */
  private fun openToDownloader(dir: File) {
    val made = generateSequence(dir) { it.parentFile }.takeWhile { !it.exists() }.toList()
    dir.mkdirs()
    for (d in (made + dir).distinct()) runCatching { Os.chmod(d.path, GROUP_SHARED) }
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

  /** A queued, running, paused or finished job already writing to [destPath], if any. */
  private fun existing(destPath: String): Long? {
    val want = Uri.fromFile(File("$destPath.part")).toString()
    val q =
      DownloadManager.Query()
        .setFilterByStatus(
          DownloadManager.STATUS_PENDING or DownloadManager.STATUS_RUNNING or
            DownloadManager.STATUS_PAUSED or DownloadManager.STATUS_SUCCESSFUL
        )
    dm.query(q).use { c ->
      while (c.moveToNext()) {
        val local = c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI))
        val hint = runCatching { c.getString(c.getColumnIndexOrThrow("hint")) }.getOrNull()
        if (local == want || hint == want) {
          val id = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_ID))
          val done = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) ==
            DownloadManager.STATUS_SUCCESSFUL
          if (!done || File("$destPath.part").exists()) return id
        }
      }
    }
    return null
  }

  /**
   * Fallback when the system download gives up: continues the ".part" file from where it stopped
   * with an HTTP Range request (or starts over if the server ignores Range). Blocking.
   */
  fun resume(url: String, destPath: String) {
    val part = File("$destPath.part")
    part.parentFile?.mkdirs()
    var link = url
    repeat(5) {
      val have = if (part.exists()) part.length() else 0L
      val conn = java.net.URL(link).openConnection() as java.net.HttpURLConnection
      conn.instanceFollowRedirects = false
      conn.connectTimeout = 20_000
      conn.readTimeout = 60_000
      if (have > 0) conn.setRequestProperty("Range", "bytes=$have-")
      try {
        when (val code = conn.responseCode) {
          in 300..399 -> {
            link = java.net.URL(java.net.URL(link), conn.getHeaderField("Location")).toString()
            return@repeat
          }
          206, 200 -> {
            val append = code == 206
            conn.inputStream.use { input ->
              java.io.FileOutputStream(part, append).use { out -> input.copyTo(out, 1 shl 20) }
            }
            return
          }
          416 -> return // already complete; the SHA-256 check decides
          else -> error("HTTP $code")
        }
      } finally {
        conn.disconnect()
      }
    }
    error("Too many redirects")
  }

  /** Bytes in the ".part" file so far (progress while resuming). */
  fun partBytes(destPath: String): Long = File("$destPath.part").let { if (it.exists()) it.length() else 0L }

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
