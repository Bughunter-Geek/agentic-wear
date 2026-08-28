package io.github.sirbughunter.agenticwear.data

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.installations.FirebaseInstallations
import com.google.firebase.messaging.FirebaseMessaging
import io.github.sirbughunter.agenticwear.BuildConfig
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

object FirebaseProvider {
    val configured: Boolean
        get() = listOf(
            BuildConfig.FIREBASE_APPLICATION_ID,
            BuildConfig.FIREBASE_PROJECT_ID,
            BuildConfig.FIREBASE_API_KEY,
            BuildConfig.FIREBASE_SENDER_ID,
        ).all(String::isNotBlank)

    fun initialize(context: Context): Boolean {
        if (!configured) return false
        if (FirebaseApp.getApps(context).isNotEmpty()) return true
        val options = FirebaseOptions.Builder()
            .setApplicationId(BuildConfig.FIREBASE_APPLICATION_ID)
            .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
            .setApiKey(BuildConfig.FIREBASE_API_KEY)
            .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
            .build()
        FirebaseApp.initializeApp(context, options)
        return true
    }

    suspend fun installationId(context: Context): String {
        check(initialize(context)) { "Firebase messaging is not configured in this build" }
        awaitCompletion(FirebaseMessaging.getInstance().register())
        return suspendCancellableCoroutine { continuation ->
            FirebaseInstallations.getInstance().id.addOnCompleteListener { task ->
                if (!continuation.isActive) return@addOnCompleteListener
                if (task.isSuccessful && !task.result.isNullOrBlank()) continuation.resume(task.result)
                else continuation.resumeWithException(
                    task.exception ?: IllegalStateException("Firebase Installation ID unavailable"),
                )
            }
        }
    }

    private suspend fun awaitCompletion(task: com.google.android.gms.tasks.Task<*>) {
        suspendCancellableCoroutine { continuation ->
            task.addOnCompleteListener { result ->
                if (!continuation.isActive) return@addOnCompleteListener
                if (result.isSuccessful) continuation.resume(Unit)
                else continuation.resumeWithException(result.exception ?: IllegalStateException("Firebase registration failed"))
            }
        }
    }
}
