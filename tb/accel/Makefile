# tb/accel/Makefile -- end-to-end cocotb flow for rtl/accel.v: conv stacks
# compiled by compiler/, loaded as memory images, run from one start pulse,
# and compared word for word with compiler/golden.py. The memories load at
# time 0, so each case is its own simulator run of one build:
#   make                                  every case in cases.py on a 2x2 mesh
#   make MESH_W=4 MESH_H=3 MESH_AW=3      the same on 4x3
#   make ACCEL_CASES="small wide"         a subset
#   make error-check                      a program for a wider mesh must stop the run
#   make stray-check                      a RESULT away from (0,0) must stop the run (Icarus)
#   make lint-configs                     lint sizes no run covers

include $(PWD)/../common.mk

RTL = $(PWD)/../../rtl
VERILOG_SOURCES = $(RTL)/pe.v $(RTL)/systolic_array.v $(RTL)/skew_feeder.v $(RTL)/tile.v \
                  $(RTL)/operand_mem.v $(PWD)/../operand_mem/sram_macro_behavioral.v \
                  $(RTL)/gemm_sequencer.v $(RTL)/gemm_tile.v $(RTL)/router.v $(RTL)/flit_buf.v \
                  $(RTL)/node_perf.v $(RTL)/requant.v $(RTL)/noc_node.v $(RTL)/noc_mesh.v \
                  $(RTL)/sim_mem.v $(RTL)/dma_gather.v $(RTL)/flit_pack.v $(RTL)/cmd_seq.v \
                  $(RTL)/writeback.v $(RTL)/cmd_perf.v $(RTL)/accel.v
TOPLEVEL = accel
MODULE = test_accel

export MESH_W  ?= 2
export MESH_H  ?= 2
export MESH_AW ?= 2
ifeq ($(SIM),icarus)
COMPILE_ARGS += -P$(TOPLEVEL).W=$(MESH_W) -P$(TOPLEVEL).H=$(MESH_H) -P$(TOPLEVEL).AW=$(MESH_AW)
else
COMPILE_ARGS += -GW=$(MESH_W) -GH=$(MESH_H) -GAW=$(MESH_AW)
endif

# One build dir per shape; each case's images live under it.
SIM_BUILD = $(SIM_ROOT)/sim_build_accel_$(MESH_W)x$(MESH_H)_aw$(MESH_AW)
CASE_DIR  = $(SIM_BUILD)/cases

# One run is one case (ACCEL_CASE) or one probe (ACCEL_PROBE); test_accel.py reads both.
export ACCEL_CASE ACCEL_PROBE
ifneq ($(ACCEL_CASE),)
PLUSARGS += +program=$(CASE_DIR)/$(ACCEL_CASE)/program.hex +weights=$(CASE_DIR)/$(ACCEL_CASE)/weights.hex \
            $(foreach b,0 1 2 3,+act_bank$(b)=$(CASE_DIR)/$(ACCEL_CASE)/act_bank$(b).hex)
endif
COCOTB_RESULTS_FILE = $(SIM_BUILD)/results_$(or $(ACCEL_CASE),$(ACCEL_PROBE),none).xml

include $(shell cocotb-config --makefiles)/Makefile.sim

.DEFAULT_GOAL := cases
.PHONY: cases error-check stray-check lint-configs

cases:
	@for c in $(or $(ACCEL_CASES),$$(python $(PWD)/cases.py list)); do \
	  python $(PWD)/cases.py emit $$c $(MESH_W) $(MESH_H) $(CASE_DIR)/$$c || exit 1; \
	  $(MAKE) --no-print-directory sim ACCEL_CASE=$$c || exit 1; \
	done

# Negative test: the shipping FATAL = 1 build stops a program that addresses
# a tile outside the mesh. Passes only if the run fails on cmd_seq's check.
error-check:
	@mkdir -p $(SIM_BUILD); log=$(SIM_BUILD)/error_check.log; \
	python $(PWD)/cases.py emit wrong_mesh $(MESH_W) $(MESH_H) $(CASE_DIR)/wrong_mesh || exit 1; \
	if $(MAKE) --no-print-directory sim ACCEL_CASE=wrong_mesh > $$log 2>&1; then \
	  echo "FAIL: a program for a wider mesh did not stop the $(SIM) run (see $$log)"; exit 1; \
	elif ! grep -q "is outside the $(MESH_W)x$(MESH_H) mesh" $$log; then \
	  echo "FAIL: $(SIM) run failed, but not on cmd_seq's tile check (see $$log)"; exit 1; \
	else \
	  echo "PASS: a BLOCK for a tile outside the mesh is fatal under $(SIM)"; \
	fi

# Negative test for accel's stray-RESULT check. Icarus only: cocotb's Force
# on an internal net silently does nothing under Verilator unless the net is
# marked forceable (docs/learnings.md, 2026-09-28).
stray-check:
	@mkdir -p $(SIM_BUILD); log=$(SIM_BUILD)/stray_check.log; \
	if $(MAKE) --no-print-directory sim SIM=icarus ACCEL_PROBE=stray > $$log 2>&1; then \
	  echo "FAIL: a RESULT at node (1,0) did not stop the Icarus run (see $$log)"; exit 1; \
	elif ! grep -q "delivered at a node other than (0,0)" $$log; then \
	  echo "FAIL: Icarus run failed, but not on accel's stray-RESULT check (see $$log)"; exit 1; \
	else \
	  echo "PASS: a RESULT delivered away from (0,0) is fatal (Icarus)"; \
	fi

# Sizes no run covers: perf counters compiled out, one row, and 8x8 at AW=3.
LINT_CONFIGS = -GPERF=0 -GW=3_-GH=1 -GW=8_-GH=8_-GAW=3
lint-configs:
	@for cfg in $(LINT_CONFIGS); do \
	  echo "lint accel $$cfg"; \
	  verilator --lint-only -Wall $$(echo $$cfg | tr _ ' ') $(TB_DIR)/lint_waivers.vlt \
	      $(VERILOG_SOURCES) --top-module $(TOPLEVEL) || exit 1; \
	done
