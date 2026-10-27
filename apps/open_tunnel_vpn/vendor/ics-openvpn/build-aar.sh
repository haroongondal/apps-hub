#!/usr/bin/env bash
# Builds the OpenVPN 2 engine (ics-openvpn, GPLv2) as an AAR for OpenTunnel.
# Source: https://github.com/schwabe/ics-openvpn at the pinned tag below,
# built unmodified except for library.gradle.kts (application -> library)
# and the two skeleton checks in CMakeLists.txt (see below).
# Output: apps/open_tunnel_vpn/android/app/libs/ics-openvpn.aar
set -euo pipefail
TAG=v0.7.69
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${ICS_OPENVPN_WORKDIR:-$HOME/.cache/apps-hub/ics-openvpn-$TAG}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"

if [ ! -d "$WORK/.git" ]; then
  git clone --depth 1 --branch "$TAG" https://github.com/schwabe/ics-openvpn.git "$WORK"
  git -C "$WORK" submodule update --init --depth 1 \
    main/src/main/cpp/openvpn main/src/main/cpp/openssl main/src/main/cpp/lz4 main/src/main/cpp/fmt
fi

cd "$WORK"
cp "$HERE/library.gradle.kts" main/build.gradle.kts
# Upstream skips openvpn3/swig and the SSL speed test when the CMake output
# dir contains "skeleton"; AGP 9 no longer puts the flavour there.
CMAKE=main/src/main/cpp/CMakeLists.txt
git checkout -- "$CMAKE"
SKIP='NOT ${CMAKE_LIBRARY_OUTPUT_DIRECTORY} MATCHES "build/intermediates/cmake/.*skeleton.*/"'
[ "$(grep -cF "$SKIP" "$CMAKE")" = 2 ] || { echo "CMakeLists.txt changed upstream; update build-aar.sh" >&2; exit 1; }
sed -i '' "s|if ($SKIP)|if (FALSE) # skeleton|" "$CMAKE"
printf 'pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositories { google(); mavenCentral() } }\ninclude(":main")\n' > settings.gradle.kts
printf 'plugins { id("com.android.library") version "9.4.1" apply false }\n' > build.gradle.kts
echo "sdk.dir=$ANDROID_HOME" > local.properties

./gradlew --no-daemon -q :main:assembleSkeletonRelease
mkdir -p "$HERE/../../android/app/libs"
cp main/build/outputs/aar/main-skeleton-release.aar "$HERE/../../android/app/libs/ics-openvpn.aar"
echo "ics-openvpn $TAG -> android/app/libs/ics-openvpn.aar"
