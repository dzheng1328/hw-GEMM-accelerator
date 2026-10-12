# tb/requant/Makefile -- cocotb flow for rtl/requant.v (one int32 -> int8
# requantization lane), checked against model/fixedpoint.py.

include $(PWD)/../common.mk

VERILOG_SOURCES = $(PWD)/../../rtl/requant.v

# Top-level Verilog module under test.
TOPLEVEL = requant

# Python module (tb/requant/test_requant.py, no .py).
MODULE = test_requant

# Output width: 8 (RESULT8, requant) or 16 (RESULT16, requant16); `make q16` runs the latter.
export REQUANT_QW ?= 8
ifeq ($(SIM),icarus)
COMPILE_ARGS += -P$(TOPLEVEL).QW=$(REQUANT_QW)
else
COMPILE_ARGS += -GQW=$(REQUANT_QW)
endif

# Separate build dir per width so this suite never clobbers the others' artifacts.
SIM_BUILD = $(SIM_ROOT)/sim_build_requant$(if $(filter 16,$(REQUANT_QW)),_q16)
COCOTB_RESULTS_FILE = $(SIM_BUILD)/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim

# The RESULT16 lane (QW = 16) against requant16().
.PHONY: q16
q16:
	$(MAKE) REQUANT_QW=16
