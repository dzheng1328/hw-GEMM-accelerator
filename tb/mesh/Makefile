# tb/mesh/Makefile -- cocotb + Icarus Verilog flow for rtl/noc_mesh2x2.v
# (four router+tile NoC nodes in a 2x2 mesh -- the full RTL stack).
# Assumes cocotb 1.8.x (see ../../requirements.txt).

SIM ?= icarus
TOPLEVEL_LANG ?= verilog

VERILOG_SOURCES = $(PWD)/../../rtl/pe.v \
                  $(PWD)/../../rtl/systolic_array.v \
                  $(PWD)/../../rtl/skew_feeder.v \
                  $(PWD)/../../rtl/tile.v \
                  $(PWD)/../../rtl/operand_mem.v \
                  $(PWD)/../../rtl/gemm_sequencer.v \
                  $(PWD)/../../rtl/gemm_tile.v \
                  $(PWD)/../../rtl/router.v \
                  $(PWD)/../../rtl/flit_buf.v \
                  $(PWD)/../../rtl/noc_node.v \
                  $(PWD)/../../rtl/noc_mesh2x2.v

# Top-level Verilog module under test.
TOPLEVEL = noc_mesh2x2

# Python module (tb/mesh/test_mesh.py, no .py).
MODULE = test_mesh

# Separate build dir so this suite never clobbers the others' artifacts.
SIM_BUILD = $(PWD)/../../sim/sim_build_mesh
COCOTB_RESULTS_FILE = $(PWD)/../../sim/sim_build_mesh/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim
