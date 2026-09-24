"""Fail a cocotb run whose results.xml records any failed or errored test.

cocotb 1.9's Makefile flow only checks that results.xml exists, so `make`
(and ./test.sh) exited 0 even when tests failed. tb/common.mk overrides
cocotb's check_for_results_file to run this instead.

    python tb/check_results.py path/to/results.xml
"""

import sys
import xml.etree.ElementTree as ET


def check(path):
    """(ok, message) for one results.xml."""
    try:
        cases = ET.parse(path).getroot().iter("testcase")
    except (OSError, ET.ParseError) as e:
        return False, f"cannot read {path}: {e}"
    total, bad = 0, []
    for case in cases:
        total += 1
        if case.find("failure") is not None or case.find("error") is not None:
            bad.append(case.get("name"))
    if total == 0:
        return False, f"{path} records no tests"
    if bad:
        return False, f"{len(bad)}/{total} tests failed: {', '.join(bad)}"
    return True, f"{total} tests, none failed"


def main():
    ok, msg = check(sys.argv[1])
    print(f"check_results: {msg}", file=sys.stdout if ok else sys.stderr)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
