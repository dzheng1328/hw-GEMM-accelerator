# tb/perf/Makefile -- cocotb flow for the measurement harness (issue #54):
# the 2x2 mesh with per-node performance counters (rtl/node_perf.v), driven
# by a packetized GEMM host at node (0,0).

include $(PWD)/../common.mk

VERILOG_SOURCES = $(PWD)/../../rtl/pe.v \
                  $(PWD)/../../rtl/systolic_array.v \
                  $(PWD)/../../rtl/skew_feeder.v \
                  $(PWD)/../../rtl/tile.v \
                  $(PWD)/../../rtl/operand_mem.v \
                  $(PWD)/../operand_mem/sram_macro_behavioral.v \
                  $(PWD)/../../rtl/gemm_sequencer.v \
                  $(PWD)/../../rtl/gemm_tile.v \
                  $(PWD)/../../rtl/router.v \
                  $(PWD)/../../rtl/flit_buf.v \
                  $(PWD)/../../rtl/node_perf.v \
                  $(PWD)/../../rtl/noc_node.v \
                  $(PWD)/../../rtl/noc_mesh.v

# Top-level Verilog module under test.
TOPLEVEL = noc_mesh

# Python module (tb/perf/test_perf.py, no .py).
MODULE = test_perf

# Separate build dir so this suite never clobbers the others' artifacts.
SIM_BUILD = $(SIM_ROOT)/sim_build_perf
COCOTB_RESULTS_FILE = $(SIM_ROOT)/sim_build_perf/results.xml

# Where test_perf.py writes its measurement records (see tb/perf/report.py).
export PERF_RESULTS ?= $(SIM_BUILD)/perf_results.json

include $(shell cocotb-config --makefiles)/Makefile.sim

BASELINE = $(REPO_ROOT)/docs/perf/baseline.json

# Re-measure and overwrite the committed baseline (only when a change is
# meant to become the new reference point).
.PHONY: baseline compare
baseline: sim
	mkdir -p $(dir $(BASELINE))
	cp $(PERF_RESULTS) $(BASELINE)
	python $(TB_DIR)/perf/report.py $(BASELINE) > $(dir $(BASELINE))baseline.md

# Re-measure and print a before/after table against the committed baseline.
compare: sim
	python $(TB_DIR)/perf/report.py $(PERF_RESULTS) --before $(BASELINE)
