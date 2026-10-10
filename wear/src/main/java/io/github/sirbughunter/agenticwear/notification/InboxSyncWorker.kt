package io.github.sirbughunter.agenticwear.notification

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import io.github.sirbughunter.agenticwear.data.AgenticWearRepository
import io.github.sirbughunter.agenticwear.data.FirebaseProvider
import io.github.sirbughunter.agenticwear.data.RelayException
import io.github.sirbughunter.agenticwear.live.VoiceNetwork
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

class InboxSyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result = try {
        val repository = AgenticWearRepository(applicationContext)
        if (inputData.getBoolean(KEY_REFRESH_FCM_REGISTRATION, false)) {
            if (repository.isPaired && FirebaseProvider.configured) {
                repository.updateFcmRegistration(FirebaseProvider.installationId(applicationContext))
            }
            return Result.success()
        }
        inputData.getString(KEY_FCM_INSTALLATION_ID)?.let { installationId ->
            repository.updateFcmRegistration(installationId)
            return Result.success()
        }
        val pushReceivedAt = inputData.getLong(KEY_PUSH_RECEIVED_AT, NO_PUSH_RECEIVED_AT).takeIf { it > 0L }
        if (pushReceivedAt == null) {
            repository.refreshInbox(notify = true, pushReceivedAt = null)
        } else {
            refreshAfterPush(repository, pushReceivedAt)
        }
        Result.success()
    } catch (error: RelayException) {
        if (error.status in 400..499) Result.failure() else Result.retry()
    } catch (_: Exception) {
        Result.retry()
    }

    /**
     * A push means a terminal alert is waiting, so the user expects the notification within seconds. Ask for
     * a direct Wi-Fi or cellular network first (the Bluetooth proxy is slow to wake), then retry a failed
     * fetch quickly here instead of leaving it to WorkManager's much longer backoff. Only the last failure
     * is rethrown, so the caller's mapping to retry or failure is unchanged.
     */
    private suspend fun refreshAfterPush(repository: AgenticWearRepository, pushReceivedAt: Long) {
        val network = VoiceNetwork(applicationContext)
        try {
            network.acquire(timeoutMs = PUSH_NETWORK_TIMEOUT_MS)
            retryPushFetch { attempt ->
                repository.refreshInbox(notify = true, pushReceivedAt = pushReceivedAt, fetchAttempt = attempt)
            }
        } finally {
            network.release()
        }
    }

    companion object {
        private const val UNIQUE_INBOX_WORK = "agentic-wear-inbox-sync"
        private const val UNIQUE_REGISTRATION_WORK = "agentic-wear-registration-sync"
        private const val KEY_FCM_INSTALLATION_ID = "fcm_installation_id"
        private const val KEY_REFRESH_FCM_REGISTRATION = "refresh_fcm_registration"
        private const val KEY_PUSH_RECEIVED_AT = "push_received_at"
        private const val NO_PUSH_RECEIVED_AT = 0L
        private const val PUSH_NETWORK_TIMEOUT_MS = 3_000L

        /** [pushReceivedAt] is the Watch wall-clock time the push arrived; it only feeds the notify.trace diagnostics. */
        fun enqueue(context: Context, pushReceivedAt: Long? = null) {
            val request = OneTimeWorkRequestBuilder<InboxSyncWorker>()
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .apply { pushReceivedAt?.let { setInputData(workDataOf(KEY_PUSH_RECEIVED_AT to it)) } }
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                UNIQUE_INBOX_WORK,
                ExistingWorkPolicy.APPEND_OR_REPLACE,
                request,
            )
        }

        fun enqueueRegistration(context: Context, installationId: String) {
            val request = OneTimeWorkRequestBuilder<InboxSyncWorker>()
                .setInputData(workDataOf(KEY_FCM_INSTALLATION_ID to installationId.take(4_096)))
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                UNIQUE_REGISTRATION_WORK,
                ExistingWorkPolicy.REPLACE,
                request,
            )
        }

        fun enqueueRegistrationRefresh(context: Context) {
            val request = OneTimeWorkRequestBuilder<InboxSyncWorker>()
                .setInputData(workDataOf(KEY_REFRESH_FCM_REGISTRATION to true))
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                UNIQUE_REGISTRATION_WORK,
                ExistingWorkPolicy.REPLACE,
                request,
            )
        }
    }
}

private val PUSH_FETCH_RETRY_DELAYS_MS = longArrayOf(1_000L, 2_000L, 4_000L)

/** One first attempt plus one per retry delay. */
internal val PUSH_FETCH_MAX_ATTEMPTS = PUSH_FETCH_RETRY_DELAYS_MS.size + 1

/**
 * How long to wait before retrying a push-triggered inbox fetch whose attempt number [attemptIndex]
 * (0-based) just failed with [error]; null means stop and give up. Transport failures and relay-side
 * failures (no status, or 5xx) are worth another quick try; a 4xx is the relay refusing the request and
 * will not change, and any other exception is a bug rather than a connectivity problem.
 */
internal fun pushFetchRetryDelayMs(attemptIndex: Int, error: Throwable): Long? {
    if (attemptIndex < 0) return null
    val transient = when (error) {
        is IOException -> true
        is RelayException -> error.status == 0 || error.status >= 500
        else -> false
    }
    return if (transient) PUSH_FETCH_RETRY_DELAYS_MS.getOrNull(attemptIndex) else null
}

/**
 * Runs [attempt] with its 1-based attempt number, waiting [pushFetchRetryDelayMs] between failures.
 * Rethrows the last failure once the policy says stop. Coroutine cancellation is never retried.
 */
internal suspend fun <T> retryPushFetch(
    wait: suspend (Long) -> Unit = { delay(it) },
    attempt: suspend (Int) -> T,
): T {
    var attemptIndex = 0
    while (true) {
        try {
            return attempt(attemptIndex + 1)
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            val delayMillis = pushFetchRetryDelayMs(attemptIndex, error) ?: throw error
            wait(delayMillis)
            attemptIndex += 1
        }
    }
}
