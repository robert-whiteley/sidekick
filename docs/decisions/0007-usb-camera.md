# 7. USB camera and audio routing

Date: 2026-11-25

## USB (UVC) camera library

**Chosen:** UVCAndroid `com.herohan:UVCAndroid:1.0.13` (github.com/shiyinghan/UVCAndroid), from
Maven Central.

- Licence checked in the repo itself: `LICENSE` is Apache-2.0 (GitHub reports Apache-2.0; the
  POM says Apache-2.0). The old note in PLAN-v2 ("licence not stated") is out of date.
- Bundled native code, each as its own `.so` in the AAR: libuvc (BSD-3, Ken Tossell),
  libusb (LGPL-2.1, `libusb1.0.so`), libjpeg-turbo (IJG / BSD-3 / zlib), libyuv (BSD-3),
  rapidjson (MIT, headers). The Java parts come from saki4510t/UVCCamera (Apache-2.0 in its
  headers and README).
- libusb is LGPL-2.1 but shipped as a separate shared library, which LGPL allows in a closed
  app: we keep the notice, say where its source is (the UVCAndroid repo, `libuvccamera/src/main/jni/libusb`),
  and do not stop users replacing it. THIRD_PARTY_NOTICES lists it.
- All five `.so` files are 16 KB page aligned (checked with `readelf`), as Google Play needs
  for Android 15+.
- Maintained (releases 1.0.11–1.0.13 in Oct 2025–Jun 2026); handles the Android 12–14
  PendingIntent and receiver-flag rules for the USB permission dialog.
- Its POM pulls `cn.hutool:hutool-core` (Mulan PSL v2, permissive) but none of its classes use
  it, so it is excluded. Its manifest asks for MANAGE/READ/WRITE_EXTERNAL_STORAGE; removed in our
  manifest (not needed; Play restricts MANAGE_EXTERNAL_STORAGE). If a later feature needs
  READ_EXTERNAL_STORAGE on Android ≤ 12, declare it in app.json (the app manifest wins).
  `android.hardware.usb.host` is marked not required so phones without USB host still install.

**Rejected:**

- AndroidUSBCamera (jiangdongguo, Apache-2.0): most stars, but last push Sept 2024 and bigger
  (its own render/encoder stack we don't need; CameraX-style UI layer).
- saki4510t/UVCCamera: the original; no licence file at repo level (Apache text only in
  headers) and unmaintained since 2021 (no Android 12+ fixes).
- libuvc + libusb directly through our own JNI: same licences, but weeks of work for what
  UVCAndroid already does (format negotiation, MJPEG decode, permissions).

## How it works

- `engine/usb/UsbCameras.kt` watches USB (USBMonitor), reports plug / unplug / permission as
  `onUsbCamera`, and opens the first UVC device (video class 14, also composite). A plugged-in
  USB camera is used by default (Recommended: USB camera > phone camera); choosing the phone
  camera in Settings sticks. Android needs the CAMERA permission granted first.
- `UvcFrameSource` gives NV21 frames at the closest mode to 1280×720 @ 10 fps, MJPEG preferred
  (raw YUYV 720p is limited to ~10 fps on USB 2). Pure mode choice in `UvcLogic` (tested).
- The app manifest gets the USB attach filter (`plugins/with-usb-camera.js`): plugging the
  camera in offers to open Sidekick and, with "always", the permission is remembered.
- JS (`src/engine/devices.ts`) posts "Camera unplugged: switched to the phone camera".
- iPhone: no USB camera (iOS has no UVC access for third-party apps on iPhone); Settings lists it
  as "not possible on iPhone".

## Audio inputs and outputs

- Listening input: USB mic (e.g. the camera's) > wired headset > phone mic. The Bluetooth
  headset mic is used only to ask (button press): it needs the call link (narrow-band, stops
  music, drains the earbuds) and hears only the wearer, not the conversation.
- Asking input: USB > wired > Bluetooth > phone.
- Output: wired > Bluetooth > USB > phone speaker (what Android does by itself; the setting is
  for overriding).
- A user choice is saved by "kind:name" (ids change on replug) and wins while connected.
- Applied with `AudioRecord.setPreferredDevice` (MicLoop) and re-applied on plug/unplug;
  Bluetooth mic via `setCommunicationDevice` (Android 12+).
- **Two mics at once** (headset mic for commands + camera mic for conversation): Android only
  records two devices together when they are on different audio hardware modules (USB audio
  has its own; wired headset and phone mic share the main one). `audioProbeSplit()` opens both
  for 0.4 s and checks each is routed where asked and delivers sound. If it fails, the camera
  mic is used for everything (PLAN-v2). Result on the Pixel 5: **not yet tested on the phone**
  (needs the USB camera plugged in). Not wired into listening until it passes there.

## Headset / Bluetooth button

- Long press: reaches Sidekick through the system assistant path when Sidekick is the default
  assistant (already supported; no extra code).
- Single press: a media session (`MediaButtons.kt`) held while walk mode is on. Android
  (8+, still true on 14/15) gives media buttons to the app that most recently played audio
  with an active session, so a music app played afterwards takes the button back until
  Sidekick speaks again. No broadcast receiver is registered (it would let the button start
  Sidekick from the background, which Android 12+ restricts for starting the mic anyway).
