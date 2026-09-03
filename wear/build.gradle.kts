import groovy.json.JsonSlurper
import java.io.File
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

val localProperties = Properties().apply {
    rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use(::load)
}

fun configured(name: String): String = (
    localProperties.getProperty(name)
        ?: providers.gradleProperty(name).orNull
        ?: providers.environmentVariable(name).orNull
    ).orEmpty().trim()

fun quoted(value: String): String = "\"" + value
    .replace("\\", "\\\\")
    .replace("\"", "\\\"") + "\""

fun firebaseConfig(path: String, packageName: String): Map<String, String> {
    if (path.isBlank()) return emptyMap()
    val file = File(path)
    check(file.isFile) { "AGENTIC_WEAR_FIREBASE_CONFIG_FILE does not exist: $path" }
    val root = JsonSlurper().parse(file) as? Map<*, *>
        ?: error("Firebase config must contain a JSON object")
    val project = root["project_info"] as? Map<*, *>
        ?: error("Firebase config is missing project_info")
    val client = (root["client"] as? List<*>)
        ?.filterIsInstance<Map<*, *>>()
        ?.firstOrNull { candidate ->
            val info = candidate["client_info"] as? Map<*, *>
            val android = info?.get("android_client_info") as? Map<*, *>
            android?.get("package_name") == packageName
        }
        ?: error("Firebase config has no Android client for $packageName")
    val clientInfo = client["client_info"] as? Map<*, *>
        ?: error("Firebase client is missing client_info")
    val apiKey = (client["api_key"] as? List<*>)
        ?.filterIsInstance<Map<*, *>>()
        ?.firstOrNull()
        ?.get("current_key") as? String
    return mapOf(
        "applicationId" to (clientInfo["mobilesdk_app_id"] as? String).orEmpty(),
        "projectId" to (project["project_id"] as? String).orEmpty(),
        "apiKey" to apiKey.orEmpty(),
        "senderId" to (project["project_number"] as? String).orEmpty(),
    ).also { values ->
        check(values.values.all(String::isNotBlank)) { "Firebase config is incomplete" }
    }
}

val releaseStoreFile = configured("ANDROID_RELEASE_STORE_FILE")
val releaseStorePassword = configured("ANDROID_RELEASE_STORE_PASSWORD")
val releaseKeyAlias = configured("ANDROID_RELEASE_KEY_ALIAS")
val releaseKeyPassword = configured("ANDROID_RELEASE_KEY_PASSWORD")
val releaseSigningValues = listOf(
    releaseStoreFile,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
)
val releaseSigningConfigured = releaseSigningValues.all(String::isNotBlank)
check(releaseSigningValues.none(String::isNotBlank) || releaseSigningConfigured) {
    "Configure all four ANDROID_RELEASE_* values, or leave all four unset for an unsigned local release."
}

val appVersionCode = configured("AGENTIC_WEAR_VERSION_CODE").ifBlank { "1" }.toIntOrNull()
require(appVersionCode != null && appVersionCode > 0) {
    "AGENTIC_WEAR_VERSION_CODE must be a positive integer."
}
val appVersionName = configured("AGENTIC_WEAR_VERSION_NAME").ifBlank { "0.1.0" }
val defaultRelayUrl = configured("AGENTIC_WEAR_RELAY_URL").ifBlank {
    "https://agentic-wear-relay.cleanuxlabs.workers.dev"
}
val configuredUpdateManifestUrl = configured("AGENTIC_WEAR_UPDATE_MANIFEST_URL")
val releaseUpdateManifestUrl = configuredUpdateManifestUrl.ifBlank {
    "https://raw.githubusercontent.com/Bughunter-Geek/agentic-wear/ota-alpha/update.json"
}
val configuredUpdateManifestFallbackUrl = configured("AGENTIC_WEAR_UPDATE_MANIFEST_FALLBACK_URL")
val releaseUpdateManifestFallbackUrl = configuredUpdateManifestFallbackUrl.ifBlank {
    "https://api.github.com/repos/Bughunter-Geek/agentic-wear/contents/update.json?ref=ota-alpha"
}
val configuredReleaseChannel = configured("AGENTIC_WEAR_RELEASE_CHANNEL")
val releaseChannel = configuredReleaseChannel.ifBlank { "Alpha" }
val developmentChannel = configuredReleaseChannel.ifBlank { "Development" }
val firebase = firebaseConfig(
    configured("AGENTIC_WEAR_FIREBASE_CONFIG_FILE"),
    "io.github.sirbughunter.agenticwear",
)
fun firebaseValue(property: String, fileKey: String): String =
    configured(property).ifBlank { firebase[fileKey].orEmpty() }

android {
    namespace = "io.github.sirbughunter.agenticwear"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.github.sirbughunter.agenticwear"
        minSdk = 31
        targetSdk = 37
        versionCode = appVersionCode
        versionName = appVersionName
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "DEFAULT_RELAY_URL", quoted(defaultRelayUrl))
        buildConfigField("String", "FIREBASE_APPLICATION_ID", quoted(firebaseValue("AGENTIC_WEAR_FIREBASE_APPLICATION_ID", "applicationId")))
        buildConfigField("String", "FIREBASE_PROJECT_ID", quoted(firebaseValue("AGENTIC_WEAR_FIREBASE_PROJECT_ID", "projectId")))
        buildConfigField("String", "FIREBASE_API_KEY", quoted(firebaseValue("AGENTIC_WEAR_FIREBASE_API_KEY", "apiKey")))
        buildConfigField("String", "FIREBASE_SENDER_ID", quoted(firebaseValue("AGENTIC_WEAR_FIREBASE_SENDER_ID", "senderId")))
        buildConfigField("String", "UPDATE_MANIFEST_URL", quoted(configuredUpdateManifestUrl))
        buildConfigField("String", "UPDATE_MANIFEST_FALLBACK_URL", quoted(configuredUpdateManifestFallbackUrl))
        buildConfigField("String", "RELEASE_CHANNEL", quoted(developmentChannel))
    }

    signingConfigs {
        if (releaseSigningConfigured) {
            create("release") {
                storeFile = rootProject.file(releaseStoreFile)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-dev"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            buildConfigField("String", "UPDATE_MANIFEST_URL", quoted(releaseUpdateManifestUrl))
            buildConfigField("String", "UPDATE_MANIFEST_FALLBACK_URL", quoted(releaseUpdateManifestFallbackUrl))
            buildConfigField("String", "RELEASE_CHANNEL", quoted(releaseChannel))
            signingConfig = if (releaseSigningConfigured) signingConfigs.getByName("release") else null
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging.resources.excludes += setOf(
        "/META-INF/{AL2.0,LGPL2.1}",
        "/META-INF/LICENSE.md",
        "/META-INF/LICENSE-notice.md",
    )
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.05.00")
    val firebaseBom = platform("com.google.firebase:firebase-bom:34.18.0")

    implementation(composeBom)
    implementation(firebaseBom)
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.fragment:fragment:1.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.wear.compose:compose-foundation:1.6.2")
    implementation("androidx.wear.compose:compose-material3:1.6.2")
    implementation("androidx.wear:wear-ongoing:1.1.0")
    implementation("androidx.work:work-runtime-ktx:2.11.2")
    implementation("com.google.firebase:firebase-messaging")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    implementation("dev.chrisbanes.haze:haze-android:1.6.10")
    implementation("androidx.wear.tiles:tiles:1.6.2")
    implementation("androidx.wear.protolayout:protolayout-material:1.4.2")
    implementation("androidx.concurrent:concurrent-futures:1.3.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
}
