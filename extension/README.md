# U1 Converter Chrome extension

Converts MakerWorld, Bambu Studio, OrcaSlicer, PrusaSlicer and Cura 3MF
projects for the Snapmaker U1 inside Chrome. No server is involved: the
original Python converter runs locally through
[Pyodide](https://pyodide.org) (Python compiled to WebAssembly), so files
never leave your computer.

## What it does

- **On MakerWorld:** the green download button's dropdown (next to
  *Open in Bambu Studio*, *Download 3MF* and *Download STL/CAD Files*) gets a
  **Download for Snapmaker U1** item. Click it and the selected print
  profile downloads and converts in the background. Chrome then saves
  `<model>-U1.3mf` like any other download, without opening a tab. A small
  notice shows progress, the U1 profile that was used, and anything to check
  in Snapmaker Orca (multi-plate, more than 4 painted colours, oversize bed).
- **Toolbar icon:** opens the full converter (the hosted site's UI) for
  advanced settings or for converting any local `.3mf`.

Conversion uses the same defaults as the website: auto-matched U1 profile,
filament rules, speed clamping, and swap pauses for layer-based prints with
more than 4 colours. You must be logged in to MakerWorld.

## Install from source

```bash
cd extension
npm install
npm run build        # outputs extension/dist
npm run package      # also writes u1-converter-extension-<version>.zip
```

The build downloads the Pyodide wheels for `pydantic` and `pyyaml` from the
Pyodide CDN once, checks them against the lockfile hashes and caches them
in `.wheel-cache/`. Everything ships inside the extension, which never loads
remote code at runtime.

Then open `chrome://extensions`, enable **Developer mode**, click
**Load unpacked** and select `extension/dist`.

## Test

```bash
npm test -- path/to/project.3mf [output.3mf]
```

This runs the bundled engine under Node: it lists profiles and rules, then
runs suggest-profile and a full conversion.

## How it fits together

| Path | Role |
|---|---|
| `backend/local_api.py` | Server-free version of the FastAPI routes, called from the worker |
| `extension/python/ijson` | Stub so the optional preset cleanup degrades gracefully (as it already does without the C backend) |
| `extension/static/worker/py-worker.js` | Web worker that boots Pyodide, loads the converter and handles calls |
| `frontend/src/lib/localEngine.ts` | Sends `api.ts` calls to the worker when built with `--mode extension` |
| `frontend/src/lib/makerworldImport.ts` | Lets the full converter open a file passed in by URL (`?src=`) |
| `extension/static/content/` | Adds the menu item to MakerWorld's download dropdown and shows progress |
| `extension/static/offscreen/` | Hidden page that downloads, converts and hands the file to Chrome's downloads |
| `extension/static/background.js` | Runs the offscreen converter, saves downloads, opens the full converter |
| `extension/build.mjs` | Assembles `dist/`: Pyodide runtime, wheels, Python sources, profiles, rules, UI |

The MakerWorld endpoints the button uses
(`/api/v1/design-service/design/{id}` and
`/api/v1/design-service/instance/{id}/f3mf?type=download`) are not
official and may change. If the automatic download fails, the notice
shows the reason, and the regular Download 3MF plus the toolbar converter
still work.

## License

Same as the parent project: [PolyForm Noncommercial 1.0.0](../LICENSE).

Required Notice: Copyright thadius83 (https://github.com/thadius83)
