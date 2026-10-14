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
else
$(error unknown SUITE $(SUITE))
endif

SIM_BUILD = $(SIM_ROOT)/sim_build_vpu_$(SUITE)$(if $(filter 16,$(LANES_QW)),_q16)
COCOTB_RESULTS_FILE = $(SIM_BUILD)/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim

.PHONY: lanes16
lanes16:
	$(MAKE) SUITE=lanes LANES_QW=16
