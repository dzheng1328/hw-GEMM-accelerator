"""pytest unit tests for tb/check_results.py (the cocotb results gate)."""

import pytest

from check_results import check

PASS_XML = """<testsuites><testsuite name="all">
<testcase name="a" classname="m" /><testcase name="b" classname="m"><skipped /></testcase>
</testsuite></testsuites>"""
FAIL_XML = """<testsuites><testsuite name="all">
<testcase name="a" classname="m" /><testcase name="b" classname="m"><failure message="boom" /></testcase>
</testsuite></testsuites>"""
ERROR_XML = FAIL_XML.replace("failure", "error")
EMPTY_XML = """<testsuites><testsuite name="all" /></testsuites>"""


@pytest.mark.parametrize("xml, ok", [(PASS_XML, True), (FAIL_XML, False), (ERROR_XML, False), (EMPTY_XML, False)])
def test_check(tmp_path, xml, ok):
    path = tmp_path / "results.xml"
    path.write_text(xml)
    assert check(str(path))[0] is ok


def test_missing_file_fails(tmp_path):
    assert check(str(tmp_path / "nope.xml"))[0] is False
