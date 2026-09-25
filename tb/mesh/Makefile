# tb/mesh/Makefile -- cocotb flow for rtl/noc_mesh.v, a WxH mesh of
# router+tile NoC nodes (the full RTL stack). One run tests one mesh size:
#   make                                  2x2, 2-bit coordinates
#   make MESH_W=4 MESH_H=3 MESH_AW=3      4x3, 3-bit coordinates
# test_mesh.py reads the same MESH_* variables, so the testbench and the RTL
# always agree on the shape. ./test.sh runs both sizes.

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
                  $(PWD)/../../rtl/requant.v \
                  $(PWD)/../../rtl/noc_node.v \
                  $(PWD)/../../rtl/noc_mesh.v

# Top-level Verilog module under test.
TOPLEVEL = noc_mesh

# Python module (tb/mesh/test_mesh.py, no .py).
MODULE = test_mesh

export MESH_W  ?= 2
export MESH_H  ?= 2
export MESH_AW ?= 2
ifeq ($(SIM),icarus)
COMPILE_ARGS += -P$(TOPLEVEL).W=$(MESH_W) -P$(TOPLEVEL).H=$(MESH_H) -P$(TOPLEVEL).AW=$(MESH_AW)
else
COMPILE_ARGS += -GW=$(MESH_W) -GH=$(MESH_H) -GAW=$(MESH_AW)
endif

# One build dir per shape, so sizes never reuse each other's model and this
# suite never clobbers the others' artifacts.
SIM_BUILD = $(SIM_ROOT)/sim_build_mesh_$(MESH_W)x$(MESH_H)_aw$(MESH_AW)
COCOTB_RESULTS_FILE = $(SIM_BUILD)/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim

# Lint configurations no suite simulates, so they cannot silently rot: perf
# counters compiled out (PERF=0), degenerate one-row/one-column/one-node
# meshes (every edge tie-off branch), and an 8x8 mesh at AW=3.
LINT_CONFIGS = -GPERF=0 -GW=1_-GH=1 -GW=3_-GH=1 -GW=1_-GH=3 -GW=8_-GH=8_-GAW=3
.PHONY: lint-configs
lint-configs:
	@for cfg in $(LINT_CONFIGS); do \
	  echo "lint noc_mesh $$cfg"; \
	  verilator --lint-only -Wall $$(echo $$cfg | tr _ ' ') $(TB_DIR)/lint_waivers.vlt \
	      $(VERILOG_SOURCES) --top-module $(TOPLEVEL) || exit 1; \
	done

# Negative test: a mesh wider than its coordinates can address (5 columns in
# 2-bit coordinates) must stop the run, not silently alias nodes.
.PHONY: size-check
size-check:
	@mkdir -p $(SIM_ROOT); log=$(SIM_ROOT)/mesh_size_check.log; \
	if $(MAKE) --no-print-directory MESH_W=5 MESH_H=1 MESH_AW=2 \
	     TESTCASE=test_one_injector_reaches_all > $$log 2>&1; then \
	  echo "FAIL: a 5x1 mesh with AW=2 did not stop the $(SIM) run (see $$log)"; exit 1; \
	elif ! grep -q "needs coordinates wider than AW=2" $$log; then \
	  echo "FAIL: $(SIM) run failed, but not on the size check (see $$log)"; exit 1; \
	else \
	  echo "PASS: an oversized mesh is fatal under $(SIM)"; \
	fi
