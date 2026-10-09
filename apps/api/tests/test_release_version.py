import importlib.util
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "bump_release_version.py"
_spec = importlib.util.spec_from_file_location("bump_release_version", _SCRIPT)
assert _spec and _spec.loader
bump = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bump)


def test_patch_increment_keeps_two_digits():
    assert bump.next_patch("1.2.01") == "1.2.02"
    assert bump.next_patch("1.2.09") == "1.2.10"
    assert bump.next_patch("1.2.99") == "1.2.100"


def test_explicit_version_is_normalized():
    assert bump.resolve_next("1.2.04", "1.3.0") == "1.3.00"


def test_explicit_version_rejects_garbage():
    with pytest.raises(ValueError):
        bump.resolve_next("1.2.01", "v1.3")


def test_write_version_defaults_to_next_patch(tmp_path, monkeypatch):
    path = tmp_path / "VERSION"
    path.write_text("1.2.01\n", encoding="utf-8")
    monkeypatch.setattr(bump, "VERSION_FILE", path)
    previous, updated = bump.write_version(path, None)
    assert previous == "1.2.01"
    assert updated == "1.2.02"
    assert path.read_text(encoding="utf-8") == "1.2.02\n"
