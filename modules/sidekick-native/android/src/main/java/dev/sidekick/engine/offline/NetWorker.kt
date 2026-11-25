package dev.sidekick.engine.offline

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Wakes JS for a network change or waiting work (see Offline). */
class NetWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
  override suspend fun doWork(): Result {
    val s = Offline.state(applicationContext)
    if (Offline.shouldWake(applicationContext, s)) deliver(applicationContext, s)
    Offline.plan(applicationContext)
    return Result.success()
  }

  companion object {
    /** Model answers for queued questions can take minutes on slow phones. */
    private const val TIMEOUT_MS = 8 * 60_000L
    private val lock = Mutex()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    suspend fun deliver(ctx: Context, s: Offline.State) {
      lock.withLock {
        // Re-check: another wake-up may have handled it meanwhile.
        if (!Offline.shouldWake(ctx, s)) return
        Offline.markSent(ctx, s.online, s.wifi)
        val ok = HeadlessRunner.run(ctx, Offline.TASK, Offline.payload(s), TIMEOUT_MS)
        if (!ok) Log.w("SidekickOffline", "network task didn't finish")
      }
    }

    /** From the live network callback (process alive). */
    fun runNow(ctx: Context, s: Offline.State) {
      scope.launch {
        deliver(ctx, s)
        Offline.plan(ctx)
      }
    }
  }
}
