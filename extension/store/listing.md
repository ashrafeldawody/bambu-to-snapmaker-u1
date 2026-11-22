# Chrome Web Store listing

## Name
U1 Converter for MakerWorld

## Summary (max 132 characters)
Download MakerWorld models ready for the Snapmaker U1. Converts Bambu 3MF projects offline, right on the model page.

## Category
Tools

## Language
English

## Description
Print MakerWorld models on your Snapmaker U1 without manual profile work.

This extension adds a "Download for Snapmaker U1" button right under MakerWorld's own download button. Click it and the selected print profile is downloaded, converted and saved as a ready-to-open U1 project (Model-U1.3mf).

WHAT IT CONVERTS
• Printer identity, build volume and nozzle settings for the Snapmaker U1
• Start, end, layer-change and filament-change G-code
• Speed and acceleration limits clamped to the U1's capabilities
• Filament slots, painted colours and per-object assignments
• Filament tuning rules for common Bambu filaments (PLA, PLA Matte, Silk, PETG HF and more)
• Filament swap pauses for layer-based prints with more than 4 colours
• Old sliced data is removed so you re-slice cleanly in Snapmaker Orca

HOW IT WORKS
1. Open any model on MakerWorld and pick a print profile.
2. Click "Download for Snapmaker U1".
3. Open the downloaded file in Snapmaker Orca, review it and slice.

A short notice tells you which U1 quality profile was matched and flags anything worth checking, such as multi-plate projects, models with more than 4 painted colours, or models designed for a bigger bed.

PRIVATE AND OFFLINE
The converter runs entirely inside your browser. Your files are never uploaded anywhere. No accounts, no tracking, no analytics.

MORE TOOLS
Click the toolbar icon to open the full converter, where you can convert any Bambu Studio, OrcaSlicer, PrusaSlicer or Cura 3MF from your computer and fine-tune settings.

You need to be logged in to MakerWorld to download models.

Based on the open-source bambu-to-snapmaker-u1 project by thadius83 (PolyForm Noncommercial 1.0.0). Not affiliated with Bambu Lab, MakerWorld or Snapmaker.

## Single purpose (Privacy practices tab)
Convert 3D printing projects from MakerWorld and Bambu Studio (3MF files) into projects for the Snapmaker U1 printer.

## Permission justifications (Privacy practices tab)
- offscreen: Runs the 3MF converter engine (Python compiled to WebAssembly) in a hidden extension page, so long conversions don't block the MakerWorld tab.
- Host permission makerworld.com, makerworld.com.cn: Adds the "Download for Snapmaker U1" button to MakerWorld model pages and requests the model's 3MF download link, exactly like MakerWorld's own Download button.
- Host permission *.bblmw.com, *.bblmw.cn: MakerWorld serves 3MF files from these storage hosts; the extension downloads the file the user asked for from there.

## Remote code
No, I am not using remote code. All JavaScript and WebAssembly (the Pyodide runtime and Python packages) is bundled in the package.

## Data usage
- Collects none of the listed data types.
- Certify: not sold to third parties, not used for purposes unrelated to the single purpose, not used for creditworthiness or lending.

## Privacy policy URL
https://github.com/ashrafeldawody/bambu-to-snapmaker-u1/blob/main/extension/PRIVACY.md

## Support / homepage URL
https://github.com/ashrafeldawody/bambu-to-snapmaker-u1
