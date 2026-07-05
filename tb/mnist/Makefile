# tb/mnist/Makefile -- cocotb + Icarus Verilog flow for rtl/systolic_array.v,
# running a real (tiled) MNIST classification pipeline.
# Assumes cocotb 1.8.x (see ../../requirements.txt). Ported to the runner API
# if this project ever moves past cocotb 2.0.

SIM ?= icarus
TOPLEVEL_LANG ?= verilog

VERILOG_SOURCES = $(PWD)/../../rtl/pe.v $(PWD)/../../rtl/systolic_array.v

# Top-level Verilog module under test.
TOPLEVEL = systolic_array

# Python module (tb/mnist/test_mnist.py, no .py).
MODULE = test_mnist

# Separate build dir from tb/Makefile's and tb/array/Makefile's so no suite
# clobbers another's artifacts.
SIM_BUILD = $(PWD)/../../sim/sim_build_mnist
COCOTB_RESULTS_FILE = $(PWD)/../../sim/sim_build_mnist/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim
