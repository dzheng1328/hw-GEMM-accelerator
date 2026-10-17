import json

import pytest

import build_sim
import sources


def test_manifest_command_refuses_when_sources_changed_since_the_last_build(tmp_path, monkeypatch):
    (tmp_path / "manifest.json").write_text(json.dumps({"sources": {"rtl/pe.v": "0" * 64}}))
    monkeypatch.setattr(build_sim, "ARTIFACTS", tmp_path)
    with pytest.raises(SystemExit, match="rebuild"):
        build_sim.refuse_changed_sources()


def test_manifest_command_is_allowed_when_nothing_changed_or_there_is_no_manifest(tmp_path, monkeypatch):
    monkeypatch.setattr(build_sim, "ARTIFACTS", tmp_path)
    build_sim.refuse_changed_sources()  # no manifest yet
    (tmp_path / "manifest.json").write_text(json.dumps({"sources": sources.source_hashes()}))
    build_sim.refuse_changed_sources()


def test_tool_versions_report_unavailable_tools_as_none(monkeypatch):
    monkeypatch.setattr(build_sim.shutil, "which", lambda _: None)
    assert build_sim.tool_versions() == {"verilator": None, "emscripten": None}
