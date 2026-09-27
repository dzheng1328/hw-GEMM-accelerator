# tb/flit_pack/Makefile -- cocotb flow for rtl/flit_pack.v (the command
# processor's flit formatter + injection skid buffer).

include $(PWD)/../common.mk

VERILOG_SOURCES = $(PWD)/../../rtl/flit_pack.v $(PWD)/../../rtl/flit_buf.v
TOPLEVEL = flit_pack
MODULE = test_flit_pack

# AW = 3: the widest mesh coordinates (8x8), so every tile_x/tile_y value is exercised.
ifeq ($(SIM),icarus)
COMPILE_ARGS += -P$(TOPLEVEL).AW=3
else
COMPILE_ARGS += -GAW=3
endif

SIM_BUILD = $(SIM_ROOT)/sim_build_flit_pack
COCOTB_RESULTS_FILE = $(SIM_ROOT)/sim_build_flit_pack/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim
