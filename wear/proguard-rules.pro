# Firebase and AndroidX publish their own consumer rules. Keep this file for
# app-specific release rules when reflection-based features are added.

-keepnames class kotlinx.coroutines.** { *; }

# The prefixed WebRTC AAR ships no consumer rules. JNI calls constructors,
# methods and classes by name, including ones not referenced directly in Java.
-keep class livekit.org.webrtc.** { *; }

# JNI_OnLoad also resolves the shaded Chromium JNI bootstrap by name.
-keep class livekit.org.jni_zero.** {
    @livekit.org.jni_zero.CalledByNative <methods>;
    @livekit.org.jni_zero.CalledByNativeUnchecked <methods>;
}
# The unused setJniClassLoader path refers to a generated class absent in this
# AAR; retain native bootstrap methods rather than keeping that unused path.
