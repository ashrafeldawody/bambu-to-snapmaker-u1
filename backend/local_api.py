from __future__ import annotations

import json
import os
import re
import shutil
import uuid
import zipfile
from pathlib import Path
from typing import Any

import yaml

from converter import convert, is_painted_model
from diff_reporter import summarise
from model_settings import MetadataRewriteError
from models import ConversionSettings
from placement import decode_model_xml, is_multiplate
from profile_loader import (
    ProfileLoadError,
    ProfileNotFoundError,
    list_profiles,
    normalize_nozzle_diameters,
    read_project_settings,
    read_source_settings,
    resolve_profile,
    suggest_profile,
)
from rules_engine import FilamentContext, RuleLoadError, find_matches, load_rules

APP_ROOT = Path(os.environ.get("U13MF_APP_ROOT", "/app"))
PROFILES_DIR = APP_ROOT / "profiles"
USER_PROFILES_DIR = APP_ROOT / "user_profiles"
BAMBU_PROFILES_DIR = APP_ROOT / "bambu_profiles"
RULES_DIR = APP_ROOT / "rules"
WORK_DIR = APP_ROOT / "work"

_MAX_TOOLHEADS = 4
_RULE_NAME_RE = re.compile(r"^[A-Za-z0-9 _.\-]+$")


class ApiError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def _ensure_dirs() -> None:
    for d in (PROFILES_DIR, USER_PROFILES_DIR, BAMBU_PROFILES_DIR, RULES_DIR, WORK_DIR):
        d.mkdir(parents=True, exist_ok=True)


def _validate_filename(name: str) -> None:
    if not name or not name.lower().endswith(".3mf"):
        raise ApiError(400, "expected a .3mf upload")
    if any(char in name for char in ("/", "\\", ":", "\x00")):
        raise ApiError(400, "invalid upload filename")


def _as_bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).lower() in ("1", "true", "yes", "on")


def _parse_overrides(text: str) -> dict[str, Any]:
    try:
        overrides = yaml.safe_load(text) if text and text.strip() else {}
        if overrides is None:
            overrides = {}
        if not isinstance(overrides, dict):
            raise ValueError("must be a mapping")
    except (ValueError, yaml.YAMLError) as err:
        raise ApiError(400, f"bad advanced_overrides: {err}") from err
    return overrides


def _parse_slot_map(raw: Any) -> dict[int, int]:
    try:
        if isinstance(raw, str):
            text = raw.strip()
            raw = json.loads(text) if text and text != "{}" else {}
        parsed = {int(k): int(v) for k, v in (raw or {}).items()}
    except (ValueError, TypeError) as err:
        raise ApiError(400, f"bad slot_map: {err}") from err
    if any(v < 0 or v >= _MAX_TOOLHEADS for v in parsed.values()):
        raise ApiError(400, "slot_map values must be 0–3")
    return parsed


def _new_job_dir() -> tuple[str, Path]:
    job_id = uuid.uuid4().hex
    workdir = WORK_DIR / job_id
    workdir.mkdir(parents=True)
    return job_id, workdir


def _stage_input(input_path: str, filename: str, workdir: Path) -> Path:
    _validate_filename(filename)
    dst = workdir / filename
    shutil.move(input_path, dst)
    return dst


def api_profiles(_args: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        profile.model_dump(exclude={"path"})
        for profile in list_profiles(PROFILES_DIR, USER_PROFILES_DIR)
    ]


def api_bambu_profiles(_args: dict[str, Any]) -> list[dict[str, str]]:
    result = []
    for p in list_profiles(BAMBU_PROFILES_DIR, BAMBU_PROFILES_DIR):
        try:
            printer_name = read_project_settings(Path(p.path)).get("printer_model") or p.display_name
        except Exception:
            printer_name = p.display_name
        result.append({"id": p.id, "name": printer_name})
    return result


def api_rules(_args: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        rules = load_rules(RULES_DIR)
    except RuleLoadError as err:
        raise ApiError(500, str(err)) from err
    return [
        {
            "name": r.name,
            "file_key": Path(r.source_path).stem if r.source_path else r.name.strip().replace(" ", "_"),
            "description": r.description,
            "enabled": r.enabled,
            "priority": r.priority,
            "match": r.match.model_dump(exclude_none=True),
            "overrides": r.overrides,
        }
        for r in rules
    ]


def api_rule(args: dict[str, Any]) -> dict[str, str]:
    name = str(args.get("name", ""))
    if not _RULE_NAME_RE.fullmatch(name):
        raise ApiError(400, "invalid rule name")
    path = RULES_DIR / f"{name.strip().replace(' ', '_')}.yaml"
    if not path.exists():
        raise ApiError(404, "rule not found")
    return {"name": name, "yaml_text": path.read_text(encoding="utf-8")}


def api_test_match(args: dict[str, Any]) -> dict[str, Any]:
    _job_id, workdir = _new_job_dir()
    try:
        src = _stage_input(args["input_path"], args["filename"], workdir)
        try:
            cfg = read_project_settings(src)
        except ProfileLoadError as err:
            raise ApiError(400, str(err)) from err
        ctx = FilamentContext.from_settings(cfg)
        hits = find_matches(load_rules(RULES_DIR), ctx)
        return {
            "context": {
                "settings_ids": list(ctx.settings_ids),
                "vendors": list(ctx.vendors),
                "types": list(ctx.types),
                "base_profile": ctx.base_profile,
            },
            "matches": [
                {
                    "rule_name": rule.name,
                    "priority": rule.priority,
                    "evidence": evidence,
                    "overrides": rule.overrides,
                }
                for rule, evidence in hits
            ],
        }
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _read_archive_overview(src: Path) -> tuple[list[str], str, str | None]:
    with zipfile.ZipFile(src) as zf:
        names = zf.namelist()
        model_xml = (
            decode_model_xml(zf.read("3D/3dmodel.model"), "3D/3dmodel.model")
            if "3D/3dmodel.model" in names else ""
        )
        try:
            model_settings_xml = (
                zf.read("Metadata/model_settings.config").decode("utf-8")
                if "Metadata/model_settings.config" in names else None
            )
        except UnicodeError as err:
            raise MetadataRewriteError(
                "Cannot safely read Metadata/model_settings.config; re-export "
                "the project from its source slicer and try again."
            ) from err
    return names, model_xml, model_settings_xml


def _filament_slots(cfg: dict[str, Any]) -> list[dict[str, Any]]:
    ids = cfg.get("filament_settings_id") or []
    types = cfg.get("filament_type") or []
    vendors = cfg.get("filament_vendor") or []
    colours = cfg.get("filament_colour") or []
    return [
        {
            "index": i,
            "settings_id": ids[i] if i < len(ids) else None,
            "filament_type": types[i] if i < len(types) else None,
            "vendor": vendors[i] if i < len(vendors) else None,
            "colour": colours[i] if i < len(colours) else None,
        }
        for i in range(len(ids))
    ]


def _detect_source_slicer(source_printer: str, already_converted: bool, detected: str | None) -> str | None:
    if already_converted:
        return None
    if detected is not None:
        return detected
    if source_printer.lower().startswith("bambu lab"):
        return None
    return source_printer or "Unknown slicer"


def _is_oversized(cfg: dict[str, Any]) -> bool:
    area = cfg.get("printable_area") or ["0x0"]
    xs = [float(p.split("x")[0]) for p in area]
    ys = [float(p.split("x")[1]) for p in area]
    return (max(xs) - min(xs)) > 270.0 or (max(ys) - min(ys)) > 270.0


def api_suggest_profile(args: dict[str, Any]) -> dict[str, Any]:
    _job_id, workdir = _new_job_dir()
    try:
        src = _stage_input(args["input_path"], args["filename"], workdir)
        cfg, detected_slicer = read_source_settings(src)
        names, model_xml, model_settings_xml = _read_archive_overview(src)
        suggestion = suggest_profile(list_profiles(PROFILES_DIR, USER_PROFILES_DIR), cfg)
        if suggestion is None:
            raise ApiError(404, "no profiles available")
        source_printer = cfg.get("printer_model", "")
        already_converted = "snapmaker" in source_printer.lower()
        filaments = _filament_slots(cfg)
        return {
            "profile_id": suggestion.id,
            "display_name": suggestion.display_name,
            "source_printer": source_printer,
            "source_nozzle_diameters": normalize_nozzle_diameters(cfg.get("nozzle_diameter")),
            "already_converted": already_converted,
            "filaments": filaments,
            "is_painted_model": is_painted_model(names, len(filaments)),
            "is_multiplate": is_multiplate(model_xml, model_settings_xml),
            "is_oversized": _is_oversized(cfg),
            "is_colour_mixed": any(v == "1" for v in cfg.get("filament_is_mixed") or []),
            "source_slicer": _detect_source_slicer(source_printer, already_converted, detected_slicer),
            "matched_on": {
                "layer_height": cfg.get("layer_height"),
                "print_settings_id": cfg.get("print_settings_id"),
            },
        }
    except (ProfileLoadError, MetadataRewriteError) as err:
        raise ApiError(400, str(err)) from err
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _run_conversion(
    *,
    args: dict[str, Any],
    descriptor_dirs: tuple[Path, Path],
    output_suffix: str | None,
    slot_map: dict[int, int],
    preserve_bambu_metadata: bool,
) -> dict[str, Any]:
    overrides = _parse_overrides(str(args.get("advanced_overrides") or "{}"))
    try:
        descriptor = resolve_profile(str(args["reference_profile"]), *descriptor_dirs)
    except ProfileNotFoundError as err:
        raise ApiError(404, str(err)) from err

    suffix = output_suffix
    if suffix is None:
        raw_model = read_project_settings(Path(descriptor.path)).get("printer_model", descriptor.id)
        suffix = raw_model.split()[-1] if raw_model else descriptor.id

    job_id, workdir = _new_job_dir()
    try:
        src = _stage_input(args["input_path"], args["filename"], workdir)
        output_name = f"{Path(args['filename']).stem}-{suffix}.3mf"
        out_path = workdir / output_name
        settings = ConversionSettings(
            reference_profile=descriptor.id,
            apply_rules=_as_bool(args.get("apply_rules"), True),
            clamp_speeds=_as_bool(args.get("clamp_speeds"), True),
            preserve_color_painting=_as_bool(args.get("preserve_color_painting"), True),
            advanced_overrides=overrides,
            slot_map=slot_map,
            insert_swap_pauses=_as_bool(args.get("insert_swap_pauses"), False),
        )
        try:
            if not preserve_bambu_metadata:
                read_source_settings(src)
            result = convert(
                source_path=src,
                reference_path=Path(descriptor.path),
                output_path=out_path,
                settings=settings,
                rules=load_rules(RULES_DIR),
                preserve_bambu_metadata=preserve_bambu_metadata,
            )
        except (ProfileLoadError, MetadataRewriteError) as err:
            raise ApiError(400, str(err)) from err
        except ApiError:
            raise
        except Exception as err:
            raise ApiError(500, f"conversion failed: {type(err).__name__}: {err}") from err

        final_path = WORK_DIR / f"{job_id}.out"
        shutil.move(str(out_path), final_path)
        return {
            "job_id": job_id,
            "download_name": output_name,
            "output_path": str(final_path),
            "diff": {
                "report": result.diff.model_dump(),
                "sections": summarise(result.diff),
                "counts": result.diff.counts(),
            },
        }
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def api_convert(args: dict[str, Any]) -> dict[str, Any]:
    return _run_conversion(
        args=args,
        descriptor_dirs=(PROFILES_DIR, USER_PROFILES_DIR),
        output_suffix="U1",
        slot_map=_parse_slot_map(args.get("slot_map")),
        preserve_bambu_metadata=False,
    )


def api_convert_bambu(args: dict[str, Any]) -> dict[str, Any]:
    return _run_conversion(
        args=args,
        descriptor_dirs=(BAMBU_PROFILES_DIR, BAMBU_PROFILES_DIR),
        output_suffix=None,
        slot_map={},
        preserve_bambu_metadata=True,
    )


ROUTES = {
    "profiles": api_profiles,
    "bambu-profiles": api_bambu_profiles,
    "rules": api_rules,
    "rule": api_rule,
    "test-match": api_test_match,
    "suggest-profile": api_suggest_profile,
    "convert": api_convert,
    "convert-bambu": api_convert_bambu,
}


def dispatch(method: str, args_json: str) -> str:
    _ensure_dirs()
    handler = ROUTES.get(method)
    try:
        if handler is None:
            raise ApiError(404, f"unknown method {method}")
        body = handler(json.loads(args_json or "{}"))
        return json.dumps({"ok": True, "status": 200, "body": body}, default=str)
    except ApiError as err:
        return json.dumps({"ok": False, "status": err.status, "detail": err.detail})
    except Exception as err:
        return json.dumps({"ok": False, "status": 500, "detail": f"{type(err).__name__}: {err}"})
