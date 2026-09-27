# tb/dma_gather/Makefile -- cocotb flow for the command processor's front end
# (rtl/dma_gather.v + rtl/flit_pack.v over rtl/sim_mem.v memories), through
# the test harness tb/dma_gather/dma_gather_tb.v.

include $(PWD)/../common.mk

VERILOG_SOURCES = $(PWD)/dma_gather_tb.v $(PWD)/../../rtl/dma_gather.v $(PWD)/../../rtl/flit_pack.v \
                  $(PWD)/../../rtl/flit_buf.v $(PWD)/../../rtl/sim_mem.v
TOPLEVEL = dma_gather_tb
MODULE = test_dma_gather

SIM_BUILD = $(SIM_ROOT)/sim_build_dma_gather
COCOTB_RESULTS_FILE = $(SIM_ROOT)/sim_build_dma_gather/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim
