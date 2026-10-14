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
else
$(error unknown SUITE $(SUITE))
endif

SIM_BUILD = $(SIM_ROOT)/sim_build_vpu_$(SUITE)$(if $(filter 16,$(LANES_QW)),_q16)
COCOTB_RESULTS_FILE = $(SIM_BUILD)/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim
