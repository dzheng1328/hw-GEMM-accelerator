# tb/writeback/Makefile -- cocotb flow for rtl/writeback.v, the command
# processor's result write-back, through tb/writeback/writeback_tb.v (4x3).

include $(PWD)/../common.mk

VERILOG_SOURCES = $(PWD)/writeback_tb.v $(PWD)/../../rtl/writeback.v $(PWD)/../../rtl/sim_mem.v
TOPLEVEL = writeback_tb
MODULE = test_writeback

SIM_BUILD = $(SIM_ROOT)/sim_build_writeback
COCOTB_RESULTS_FILE = $(SIM_ROOT)/sim_build_writeback/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim

# Negative test: a RESULT flit with no pending entry for its tile must stop
# the run. Passes only if the probe run fails AND on writeback's check.
.PHONY: orphan-check
orphan-check:
	@mkdir -p $(SIM_BUILD); log=$(SIM_BUILD)/orphan_check.log; \
	if WRITEBACK_ORPHAN_PROBE=1 $(MAKE) --no-print-directory \
	     TESTCASE=test_orphan_result_is_fatal \
	     COCOTB_RESULTS_FILE=$(SIM_BUILD)/orphan_results.xml > $$log 2>&1; then \
	  echo "FAIL: an orphan RESULT did not stop the $(SIM) run (see $$log)"; exit 1; \
	elif ! grep -q "matches no pending block" $$log; then \
	  echo "FAIL: $(SIM) run failed, but not on writeback's check (see $$log)"; exit 1; \
	else \
	  echo "PASS: an orphan RESULT is fatal under $(SIM)"; \
	fi
