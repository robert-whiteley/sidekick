# Store images still needed (owner)

Put the files at these paths, then `UPLOAD_IMAGES=1 bundle exec fastlane android upload_metadata`
(or `scripts/release.sh metadata --images --real`). Nothing here is uploaded until the files exist.

| What                    | Path (under `fastlane/metadata/android/en-GB/images/`) | Play rule                                                                                                             |
| ----------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| App icon                | `icon.png`                                             | 512 × 512 PNG (32-bit), up to 1 MB                                                                                    |
| Feature graphic         | `featureGraphic.png`                                   | 1024 × 500 JPG or 24-bit PNG (no transparency)                                                                        |
| Phone screenshots (2–8) | `phoneScreenshots/1_chat.png`, `2_camera.png`, …       | JPG or 24-bit PNG, each side 320–3840 px, long side at most 2× the short side; 1080 × 1920 or 1080 × 2400 recommended |

Suggested phone screenshots (real app, test data only — no personal messages, contacts or photos):

1. Chat answering "What am I looking at?" with the camera view.
2. Recall: "What did that sign say this morning?" with the frame shown.
3. A draft message card with Send / Edit / Cancel (made-up recipient).
4. Memory: people and to-dos (made-up names).
5. Privacy settings: online lookup off, export and delete.
6. The first-run page explaining that data stays on the phone.

Optional: a short promo video on YouTube (`video.txt` with its URL). The foreground-service
and OAuth demo videos are separate (docs/store/permissions.md, docs/store/oauth-verification.md).
