# tb/vpu/Makefile -- cocotb flows for the vector unit (milestone 4.3e).
#
#   make SUITE=exp       one suite: exp, rsqrt, rng, lanes, ops, faults (./test.sh runs each)
#   make lanes16         the lanes suite at QW = 16
#   make fault-check     the FATAL = 1 negative tests
#
# The arithmetic units (exp, rsqrt, rng, lanes) are checked against
# model/fixedpoint.py; the sub-op suites run rtl/vpu.v against the memory
# images compiler/golden_vop.py produces.

include $(PWD)/../common.mk

SUITE ?= exp

ifeq ($(SUITE),exp)
TOPLEVEL = vpu_expcheck
MODULE = test_exp
VERILOG_SOURCES = $(PWD)/vpu_expcheck.v $(PWD)/../../rtl/vpu_exp.v $(PWD)/../../rtl/vpu_exparg.v
else ifeq ($(SUITE),rsqrt)
TOPLEVEL = vpu_rsqrt
MODULE = test_rsqrt
VERILOG_SOURCES = $(PWD)/../../rtl/vpu_rsqrt.v
else ifeq ($(SUITE),rng)
TOPLEVEL = vpu_rng
MODULE = test_rng
VERILOG_SOURCES = $(PWD)/../../rtl/vpu_rng.v
else ifeq ($(SUITE),lanes)
TOPLEVEL = vpu_lanes
MODULE = test_lanes
VERILOG_SOURCES = $(PWD)/../../rtl/vpu_lanes.v $(PWD)/../../rtl/requant.v
# Output width 8 (requant) or 16 (requant16, EMBED's lanes); `make lanes16` runs the latter.
export LANES_QW ?= 8
ifeq ($(SIM),icarus)
COMPILE_ARGS += -P$(TOPLEVEL).QW=$(LANES_QW)
else
COMPILE_ARGS += -GQW=$(LANES_QW)
endif
else ifneq ($(filter $(SUITE),ops faults fatal),)
TOPLEVEL = vpu
VPU_RTL = $(addprefix $(PWD)/../../rtl/, vpu.v vpu_add.v vpu_transpose.v vpu_embed.v vpu_rmsnorm.v vpu_silu.v \
    vpu_rope.v vpu_kvwrite.v vpu_softmax.v vpu_sample.v vpu_rsqrt.v vpu_exp.v vpu_exparg.v vpu_lanes.v vpu_rng.v \
    vpu_perf.v requant.v)
VERILOG_SOURCES = $(VPU_RTL)
# ops: every sub-op against the golden; faults: the same build with FATAL = 0, so a fault raises
# the `fault` output; fatal: FATAL = 1, one probe per `make fault-check` run.
MODULE = $(if $(filter ops,$(SUITE)),test_ops,$(if $(filter faults,$(SUITE)),test_faults,test_fatal))
ifneq ($(SUITE),fatal)
ifneq ($(SUITE),ops)
ifeq ($(SIM),icarus)
COMPILE_ARGS += -P$(TOPLEVEL).FATAL=0
else
COMPILE_ARGS += -GFATAL=0
endif
endif
endif
else
$(error unknown SUITE $(SUITE))
endif

SIM_BUILD = $(SIM_ROOT)/sim_build_vpu_$(SUITE)$(if $(filter 16,$(LANES_QW)),_q16)
COCOTB_RESULTS_FILE = $(SIM_BUILD)/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim

.PHONY: lanes16
lanes16:
	$(MAKE) SUITE=lanes LANES_QW=16

# Negative tests: with FATAL = 1 each fault, and a start while busy, must end the
# simulation on the VPU's own $fatal (passes only if the probe run fails AND names it).
FAULT_PROBES = invalid_sub_op_0 invalid_sub_op_10 t_at_context_embed t_at_context_rope t_at_context_kvwrite \
    t_at_context_softmax t_at_context_sample embed_token_outside_vocabulary embed_negative_token \
    rmsnorm_zero_rsqrt_input
.PHONY: fault-check
fault-check:
	@mkdir -p $(SIM_ROOT); \
	for probe in $(FAULT_PROBES); do \
	  log=$(SIM_ROOT)/vpu_fault_$$probe.log; \
	  if VPU_PROBE=$$probe $(MAKE) --no-print-directory SUITE=fatal \
	       COCOTB_RESULTS_FILE=$(SIM_ROOT)/sim_build_vpu_fatal/results_$$probe.xml > $$log 2>&1; then \
	    echo "FAIL: $$probe did not stop the $(SIM) run (see $$log)"; exit 1; \
	  elif ! grep -q "vpu: fault" $$log; then \
	    echo "FAIL: $(SIM) run failed for $$probe, but not on the VPU's fault check (see $$log)"; exit 1; \
	  else \
	    echo "PASS: $$probe is fatal under $(SIM)"; \
	  fi; \
	done; \
	log=$(SIM_ROOT)/vpu_fault_start_while_busy.log; \
	if VPU_PROBE=start_while_busy $(MAKE) --no-print-directory SUITE=fatal \
	     COCOTB_RESULTS_FILE=$(SIM_ROOT)/sim_build_vpu_fatal/results_busy.xml > $$log 2>&1; then \
	  echo "FAIL: start while busy did not stop the $(SIM) run (see $$log)"; exit 1; \
	elif ! grep -q "vpu: start while busy" $$log; then \
	  echo "FAIL: $(SIM) run failed, but not on the VPU's start-while-busy check (see $$log)"; exit 1; \
	else \
	  echo "PASS: start while busy is fatal under $(SIM)"; \
	fi
