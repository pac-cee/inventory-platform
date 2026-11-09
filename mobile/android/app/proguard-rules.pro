# R8 / ProGuard keep rules for release builds.
#
# Flutter minifies release builds by default. Without the rules below the QR
# scanner fails ONLY in release — debug and profile builds are fine, because
# they are not minified — with a Java NullPointerException surfaced through
# MobileScannerErrorDetails, e.g.
#
#   Attempt to invoke virtual method 'w4.c w4.b.a(s4.b)' on a null object reference
#
# The obfuscated class names in that message (w4.c, w4.b, s4.b) are the tell:
# R8 has renamed or stripped types that ML Kit resolves reflectively at runtime,
# so the detector never constructs and the call lands on null.
#
# On screen this reads "Camera unavailable", which points at permissions or
# hardware and sends you looking in the wrong place entirely. The camera and its
# permission are both fine.

# ── ML Kit barcode scanning ────────────────────────────────────────────────
# mobile_scanner pulls in both the bundled model (com.google.mlkit) and the
# Play-services-delivered one (play-services-mlkit-barcode-scanning). Which one
# serves a given device is decided at runtime, so both have to survive R8.
-keep class com.google.mlkit.** { *; }
-keep interface com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**

-keep class com.google.android.gms.internal.mlkit_vision_barcode.** { *; }
-keep class com.google.android.gms.internal.mlkit_common.** { *; }
-keep class com.google.android.gms.vision.** { *; }
-dontwarn com.google.android.gms.internal.**

# ML Kit registers model components through a generated registrar that nothing
# references directly — exactly the shape R8 treats as dead code.
-keep class * implements com.google.firebase.components.ComponentRegistrar { *; }
-keep @interface com.google.android.gms.common.annotation.KeepName
-keepnames @com.google.android.gms.common.annotation.KeepName class *

# ── The plugin itself ──────────────────────────────────────────────────────
-keep class dev.steenbakker.mobile_scanner.** { *; }

# ── CameraX ────────────────────────────────────────────────────────────────
# Provider implementations are resolved by name from metadata, not by a
# compile-time reference.
-keep class androidx.camera.** { *; }
-dontwarn androidx.camera.**
