package dev.sidekick.engine

import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream

object Archives {
  /** Unpacks [archive] into [destDir], refusing entries that escape it, then deletes the archive. */
  fun extractTarBz2(archive: String, destDir: String): Boolean {
    val dest = File(destDir).canonicalFile.apply { mkdirs() }
    TarArchiveInputStream(BZip2CompressorInputStream(BufferedInputStream(FileInputStream(archive)))).use { tar ->
      while (true) {
        val e = tar.nextEntry ?: break
        val out = File(dest, e.name).canonicalFile
        require(out.path.startsWith(dest.path + File.separator)) { "Bad archive entry ${e.name}" }
        if (e.isDirectory) out.mkdirs()
        else {
          out.parentFile?.mkdirs()
          out.outputStream().use { tar.copyTo(it) }
        }
      }
    }
    File(archive).delete()
    return true
  }
}
