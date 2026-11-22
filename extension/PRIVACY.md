# Privacy policy: U1 Converter for MakerWorld

Last updated: 22 November 2026

U1 Converter for MakerWorld ("the extension") converts 3D printing project
files (3MF) for the Snapmaker U1 printer. This policy explains what data the
extension handles.

## What the extension does with your data

- **3MF files.** When you click *Download for Snapmaker U1* on a MakerWorld
  model page, the extension downloads that model's 3MF file from MakerWorld
  and converts it on your computer. When you use the converter page, it
  reads the file you choose. Files are processed in your browser's memory
  and saved to your computer through the normal browser download. They are
  never uploaded to the developer or to any third party.
- **MakerWorld session.** To download the 3MF file, the extension sends
  MakerWorld the same request that MakerWorld's own Download button sends,
  from the MakerWorld page you are viewing. Your existing MakerWorld login
  cookies go with that request. The extension never reads, stores or sends
  your cookies or credentials anywhere else.
- **Settings.** The converter page stores your light or dark theme choice in
  local browser storage.

## What the extension does not do

- It does not collect, transmit, sell or share personal information.
- It does not use analytics, tracking, advertising or remote code. All
  conversion code is packaged inside the extension.
- It does not contact any server other than MakerWorld (`makerworld.com`,
  `makerworld.com.cn`) and MakerWorld's file storage (`*.bblmw.com`,
  `*.bblmw.cn`), and only to download the model you asked for.

## Permissions

| Permission | Why it is needed |
|---|---|
| Access to `makerworld.com` and `makerworld.com.cn` | Adds the *Download for Snapmaker U1* button to model pages and requests the model's 3MF download link. |
| Access to `*.bblmw.com` and `*.bblmw.cn` | Downloads the 3MF file from MakerWorld's file storage. |
| `offscreen` | Runs the converter engine in a hidden extension page so conversion doesn't slow down the MakerWorld tab. |

## Contact

Questions or problems:
<https://github.com/ashrafeldawody/bambu-to-snapmaker-u1/issues>

This extension is based on
[bambu-to-snapmaker-u1](https://github.com/thadius83/bambu-to-snapmaker-u1)
by thadius83 and is not affiliated with Bambu Lab, MakerWorld or Snapmaker.
