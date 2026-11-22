# U1 Converter Chrome extension

Converts MakerWorld, Bambu Studio, OrcaSlicer, PrusaSlicer and Cura 3MF
projects for the Snapmaker U1 inside Chrome. No server is involved: the
original Python converter runs locally through
[Pyodide](https://pyodide.org) (Python compiled to WebAssembly), so files
never leave your computer.

## What it does

- **On MakerWorld:** a **Convert for Snapmaker U1** button appears on every
  model page. Click it and pick a print profile. The page's own preselected
  profile is highlighted. The extension fetches that profile's 3MF with your
  logged-in MakerWorld session and opens it in the converter tab.
- **Anywhere:** click the toolbar icon to open the converter and drop in
  any `.3mf` file.
- The converter tab is the same UI as the hosted site, with profile
  auto-match, filament rules, toolhead assignment, swap pauses and the
  change report. The converted file downloads straight from the tab.

You must be logged in to MakerWorld, because MakerWorld only serves 3MF
downloads to signed-in users. If MakerWorld asks for a captcha, use its
normal download dialog once, then click the button again.

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
| `frontend/src/lib/makerworldImport.ts` | Downloads the MakerWorld file handed over by the content script |
| `extension/static/content/` | MakerWorld button and print-profile picker |
| `extension/static/background.js` | Opens the converter tab |
| `extension/build.mjs` | Assembles `dist/`: Pyodide runtime, wheels, Python sources, profiles, rules, UI |

The MakerWorld endpoints the button uses
(`/api/v1/design-service/design/{id}` and
`/api/v1/design-service/instance/{id}/f3mf?type=download`) are not
official and may change. If the automatic download fails, the converter tab
offers a manual download link and the drop zone still works.

## License

Same as the parent project: [PolyForm Noncommercial 1.0.0](../LICENSE).

Required Notice: Copyright thadius83 (https://github.com/thadius83)
