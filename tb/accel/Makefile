# tb/accel/Makefile -- end-to-end cocotb flow for rtl/accel.v: conv stacks
# compiled by compiler/, loaded as memory images, run from one start pulse,
# and compared word for word with compiler/golden.py. The memories load at
# time 0, so each case is its own simulator run of one build:
#   make                                  every case in cases.py on a 2x2 mesh
#   make MESH_W=4 MESH_H=3 MESH_AW=3      the same on 4x3
#   make ACCEL_CASES="small wide"         a subset
#   make error-check                      each fault probe (cases.py probes) must stop the run on its own message
#   make stray-check                      a RESULT away from (0,0) must stop the run (Icarus)
#   make vpu-check                        the VPU's memory-port guards must stop the run (Icarus)
#   make lint-configs                     lint sizes no run covers
#   make cifar                            all 128 CIFAR-10 images; writes docs/perf/cifar.{json,md}
#   make scaling                          the same on 1x1 .. 4x4; writes docs/perf/scaling.{json,md}

include $(PWD)/../common.mk

RTL = $(PWD)/../../rtl
VERILOG_SOURCES = $(RTL)/pe.v $(RTL)/systolic_array.v $(RTL)/skew_feeder.v $(RTL)/tile.v \
                  $(RTL)/operand_mem.v $(PWD)/../operand_mem/sram_macro_behavioral.v \
                  $(RTL)/gemm_sequencer.v $(RTL)/gemm_tile.v $(RTL)/router.v $(RTL)/flit_buf.v \
                  $(RTL)/node_perf.v $(RTL)/requant.v $(RTL)/noc_node.v $(RTL)/noc_mesh.v \
                  $(RTL)/sim_mem.v $(RTL)/dma_gather.v $(RTL)/flit_pack.v $(RTL)/cmd_seq.v \
                  $(RTL)/writeback.v $(RTL)/cmd_perf.v \
                  $(addprefix $(RTL)/, vpu.v vpu_add.v vpu_transpose.v vpu_embed.v vpu_rmsnorm.v vpu_silu.v vpu_rope.v \
                      vpu_kvwrite.v vpu_softmax.v vpu_sample.v vpu_rsqrt.v vpu_exp.v vpu_exparg.v vpu_lanes.v vpu_rng.v \
                      vpu_perf.v) \
                  $(RTL)/accel.v $(PWD)/accel_tb.v
TOPLEVEL = accel_tb
MODULE = test_accel

export MESH_W  ?= 2
export MESH_H  ?= 2
export MESH_AW ?= 2
ifeq ($(SIM),icarus)
COMPILE_ARGS += -P$(TOPLEVEL).W=$(MESH_W) -P$(TOPLEVEL).H=$(MESH_H) -P$(TOPLEVEL).AW=$(MESH_AW)
else
COMPILE_ARGS += -GW=$(MESH_W) -GH=$(MESH_H) -GAW=$(MESH_AW)
# accel_tb.v generates the clock with a delay: 5x faster than a cocotb Clock.
COMPILE_ARGS += --timing
endif

# One build dir per shape; each case's images live under it.
SIM_BUILD = $(SIM_ROOT)/sim_build_accel_$(MESH_W)x$(MESH_H)_aw$(MESH_AW)
CASE_DIR  = $(SIM_BUILD)/cases

# One run is one case (ACCEL_CASE) or one probe (ACCEL_PROBE); test_accel.py reads both.
export ACCEL_CASE ACCEL_PROBE CIFAR_RESULTS
ifneq ($(ACCEL_CASE),)
PLUSARGS += +program=$(CASE_DIR)/$(ACCEL_CASE)/program.hex +weights=$(CASE_DIR)/$(ACCEL_CASE)/weights.hex \
            $(foreach b,0 1 2 3,+act_bank$(b)=$(CASE_DIR)/$(ACCEL_CASE)/act_bank$(b).hex)
endif
COCOTB_RESULTS_FILE = $(SIM_BUILD)/results_$(or $(ACCEL_CASE),$(ACCEL_PROBE),none).xml

include $(shell cocotb-config --makefiles)/Makefile.sim

.DEFAULT_GOAL := cases
.PHONY: cases error-check stray-check vpu-check lint-configs cifar scaling

cases:
	@for c in $(or $(ACCEL_CASES),$$(python $(PWD)/cases.py list)); do \
	  python $(PWD)/cases.py emit $$c $(MESH_W) $(MESH_H) $(CASE_DIR)/$$c || exit 1; \
	  $(MAKE) --no-print-directory sim ACCEL_CASE=$$c || exit 1; \
	done

# Negative tests: the shipping FATAL = 1 build stops on every cmd_seq fault a program can
# raise (a tile outside the mesh, a fifth nested loop, a bad LOOP or LOOPR count, a bad
# register-form ROUND, ROWS or RMODE, an invalid VOP sub-op, a VPU fault). Each probe passes only
# if its run fails on cmd_seq's own message, with the pc golden gives.
error-check:
	@mkdir -p $(SIM_BUILD); \
	for p in $$(python $(PWD)/cases.py probes); do \
	  log=$(SIM_BUILD)/error_check_$$p.log; \
	  want=$$(python $(PWD)/cases.py message $$p $(MESH_W) $(MESH_H)); \
	  python $(PWD)/cases.py emit $$p $(MESH_W) $(MESH_H) $(CASE_DIR)/$$p || exit 1; \
	  if $(MAKE) --no-print-directory sim ACCEL_CASE=$$p > $$log 2>&1; then \
	    echo "FAIL: probe $$p did not stop the $(SIM) run (see $$log)"; exit 1; \
	  elif ! grep -qF "$$want" $$log; then \
	    echo "FAIL: probe $$p failed the $(SIM) run, but not on \"$$want\" (see $$log)"; exit 1; \
	  else \
	    echo "PASS: probe $$p is fatal under $(SIM): $$want"; \
	  fi; \
	done

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

# Negative tests for accel's two VPU memory-port guards. Icarus only, for the same reason as
# stray-check; the probes run cases.VOP_NOP, whose images go to Icarus's own case directory.
ICARUS_CASES = $(REPO_ROOT)/sim/icarus/sim_build_accel_$(MESH_W)x$(MESH_H)_aw$(MESH_AW)/cases
vpu-check:
	@mkdir -p $(SIM_BUILD); \
	python $(PWD)/cases.py emit vop_nop $(MESH_W) $(MESH_H) $(ICARUS_CASES)/vop_nop || exit 1; \
	for p in "vpu_overlap|the VPU is running while the DMA or write-back is busy" \
	         "vpu_stray|the VPU requested a memory port while it is not running"; do \
	  probe=$${p%%|*}; want=$${p#*|}; log=$(SIM_BUILD)/vpu_check_$$probe.log; \
	  if $(MAKE) --no-print-directory sim SIM=icarus CASE_DIR=$(ICARUS_CASES) ACCEL_CASE=vop_nop ACCEL_PROBE=$$probe > $$log 2>&1; then \
	    echo "FAIL: $$probe did not stop the Icarus run (see $$log)"; exit 1; \
	  elif ! grep -qF "$$want" $$log; then \
	    echo "FAIL: Icarus run failed for $$probe, but not on \"$$want\" (see $$log)"; exit 1; \
	  else \
	    echo "PASS: $$probe is fatal (Icarus)"; \
	  fi; \
	done

# Sizes no run covers: perf counters compiled out, one row, and 8x8 at AW=3.
LINT_CONFIGS = -GPERF=0 -GW=3_-GH=1 -GW=8_-GH=8_-GAW=3
lint-configs:
	@for cfg in $(LINT_CONFIGS); do \
	  echo "lint accel $$cfg"; \
	  verilator --lint-only -Wall $$(echo $$cfg | tr _ ' ') $(TB_DIR)/lint_waivers.vlt \
	      $(filter-out %/accel_tb.v,$(VERILOG_SOURCES)) --top-module accel || exit 1; \
	done

# All 128 frozen CIFAR-10 test images; records accuracy and cycles in
# docs/perf/ only if the run passes.
PERF_DOCS = $(REPO_ROOT)/docs/perf
cifar:
	@mkdir -p $(SIM_BUILD)
	$(MAKE) --no-print-directory cases ACCEL_CASES=cifar128 CIFAR_RESULTS=$(SIM_BUILD)/cifar128.json
	cp $(SIM_BUILD)/cifar128.json $(PERF_DOCS)/cifar.json
	python $(PWD)/cifar_report.py $(PERF_DOCS)/cifar.json > $(PERF_DOCS)/cifar.md

# The mesh scaling study (issue #73): the CIFAR-10 program recompiled and run
# on each mesh (every run bit-exact, as in make cifar), then one table, chart,
# and explanation in docs/perf/ only if every run passes. Each mesh is its own
# target, rerun every time (FORCE), so `make -j5 scaling` runs them at once.
# SCALING_CASE=cifar8 is a quick look; the committed study is cifar128.
# AW=2 fits meshes up to 4x4.
SCALING_SHAPES ?= 1x1 2x1 2x2 3x3 4x4
SCALING_CASE   ?= cifar128
SCALING_DIR     = $(SIM_ROOT)/scaling_$(SCALING_CASE)
SCALING_RUNS    = $(foreach s,$(SCALING_SHAPES),$(SCALING_DIR)/$(s).json)
scaling: $(SCALING_RUNS)
	python $(PWD)/scaling_report.py combine $(PERF_DOCS)/scaling.json $(SCALING_RUNS)
	python $(PWD)/scaling_report.py render $(PERF_DOCS)/scaling.json > $(PERF_DOCS)/scaling.md

$(SCALING_DIR)/%.json: FORCE
	@mkdir -p $(SCALING_DIR); rm -f $@
	$(MAKE) --no-print-directory cases MESH_W=$(word 1,$(subst x, ,$*)) MESH_H=$(word 2,$(subst x, ,$*)) \
	    MESH_AW=2 ACCEL_CASES=$(SCALING_CASE) CIFAR_RESULTS=$@ > $(SCALING_DIR)/$*.log 2>&1 \
	    || { tail -20 $(SCALING_DIR)/$*.log; echo "FAIL: $(SCALING_CASE) on $*, see $(SCALING_DIR)/$*.log"; exit 1; }

FORCE:
