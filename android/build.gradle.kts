// Top-level build file. Plugins are declared here so subprojects can apply
// them without re-specifying versions. Versions live in libs.versions.toml-
// style logic? No — for a single-module app the version catalogs are
// overkill. Pinning versions inline keeps it readable.

plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.0.21" apply false
    // Declared so the app module can apply it conditionally (only when
    // google-services.json is present). Lets the project still build
    // before Firebase setup is complete.
    id("com.google.gms.google-services") version "4.4.2" apply false
}
