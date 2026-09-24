# tb/router/Makefile -- cocotb flow for rtl/router.v (a single
# 2D-mesh NoC router). Assumes cocotb 1.8.x (see ../../requirements.txt).

include $(PWD)/../common.mk

VERILOG_SOURCES = $(PWD)/../../rtl/router.v

# Top-level Verilog module under test.
TOPLEVEL = router

# Python module (tb/router/test_router.py, no .py).
MODULE = test_router

# Separate build dir so this suite never clobbers the others' artifacts.
SIM_BUILD = $(SIM_ROOT)/sim_build_router
COCOTB_RESULTS_FILE = $(SIM_ROOT)/sim_build_router/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim
