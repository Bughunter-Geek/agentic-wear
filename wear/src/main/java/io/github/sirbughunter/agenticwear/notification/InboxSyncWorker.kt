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
import io.github.sirbughunter.agenticwear.data.RelayException

class InboxSyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result = try {
        val repository = AgenticWearRepository(applicationContext)
        inputData.getString(KEY_FCM_INSTALLATION_ID)?.let { installationId ->
            repository.updateFcmRegistration(installationId)
            return Result.success()
        }
        repository.refreshInbox(notify = true)
        Result.success()
    } catch (error: RelayException) {
        if (error.status in 400..499) Result.failure() else Result.retry()
    } catch (_: Exception) {
        Result.retry()
    }

    companion object {
        private const val UNIQUE_INBOX_WORK = "agentic-wear-inbox-sync"
        private const val UNIQUE_REGISTRATION_WORK = "agentic-wear-registration-sync"
        private const val KEY_FCM_INSTALLATION_ID = "fcm_installation_id"

        fun enqueue(context: Context) {
            val request = OneTimeWorkRequestBuilder<InboxSyncWorker>()
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
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
    }
}
