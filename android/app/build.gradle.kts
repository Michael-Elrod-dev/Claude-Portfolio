plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// Apply google-services only when google-services.json is present, so the
// project still builds before Firebase is wired up. Once you drop the
// JSON into app/, this plugin runs and generates the resources Firebase
// needs to auto-initialize.
if (project.file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "com.claudeportfolio.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.claudeportfolio.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        // We don't run instrumented tests yet; placeholder for when we do.
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            // Personal sideloaded app — minify off keeps stack traces readable
            // and we don't ship to the Play Store, so binary size doesn't
            // matter much. Flip to true if APK gets too big.
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    // Compose BOM pins all Compose artifact versions to a known-compatible set.
    val composeBom = platform("androidx.compose:compose-bom:2024.10.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    // Core Compose
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    // Activity + lifecycle integration for Compose
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")

    // Navigation Compose — used by the bottom-nav router
    implementation("androidx.navigation:navigation-compose:2.8.4")

    // Google Fonts loader for downloadable Inter / JetBrains Mono.
    // The handoff calls for Inter as the single body family.
    implementation("androidx.compose.ui:ui-text-google-fonts")

    // Phase 5: HTTP + JSON + persisted prefs
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-kotlinx-serialization:2.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    // Phase 6: Firebase Cloud Messaging
    implementation(platform("com.google.firebase:firebase-bom:33.6.0"))
    implementation("com.google.firebase:firebase-messaging-ktx")
    // Provides Task<T>.await() so we can read the FCM token from a coroutine.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.8.1")

    // Skipped on purpose at this scope:
    //   - Hilt (CompositionLocal handles the API binding cleanly)
    //   - Room (no offline cache; refetch on tab change is fine for a weekly app)
    //   - WorkManager (no background refresh; FCM is the actual nudge)

    // Debug-only helpers (Compose preview tooling, layout inspector)
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    // Test deps placeholder — no tests yet but Studio expects this.
    testImplementation("junit:junit:4.13.2")
}
