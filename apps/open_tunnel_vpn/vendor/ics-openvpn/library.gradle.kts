// Replaces upstream main/build.gradle.kts: the same sources built as an
// Android library, skeleton UI + OpenVPN 2 only (no openvpn3/swig, no UI deps).
// One flavour dimension so BuildConfig.FLAVOR is exactly "skeleton" (NativeUtils checks it).
plugins {
    id("com.android.library")
}

android {
    buildFeatures {
        aidl = true
        buildConfig = true
    }
    namespace = "de.blinkt.openvpn"
    compileSdk = 36
    ndkVersion = "28.2.13676358"

    defaultConfig {
        minSdk = 24
        buildConfigField("String", "VERSION_NAME", "\"0.7.69\"")
        buildConfigField("int", "VERSION_CODE", "225")
        buildConfigField("boolean", "openvpn3", "false")
    }

    externalNativeBuild {
        cmake {
            path = File("${projectDir}/src/main/cpp/CMakeLists.txt")
        }
    }

    sourceSets {
        getByName("main") {
            assets.directories.add("build/ovpnassets")
        }
        create("skeleton") {}
    }

    flavorDimensions += listOf("implementation")
    productFlavors {
        create("skeleton") { dimension = "implementation" }
    }

    compileOptions {
        targetCompatibility = JavaVersion.VERSION_17
        sourceCompatibility = JavaVersion.VERSION_17
    }
    lint { abortOnError = false }
}

dependencies {
    implementation("androidx.annotation:annotation:1.9.1")
    implementation("androidx.core:core:1.16.0")
}
