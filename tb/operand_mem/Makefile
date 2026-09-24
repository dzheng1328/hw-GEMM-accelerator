# tb/operand_mem/Makefile -- cocotb flow for rtl/operand_mem.v,
# tested in isolation (not through the full tile) against the behavioral SRAM
# macro stand-in.
# Assumes cocotb 1.8.x (see ../../requirements.txt).

include $(PWD)/../common.mk

VERILOG_SOURCES = $(PWD)/../../rtl/operand_mem.v \
                  $(PWD)/sram_macro_behavioral.v

# Top-level Verilog module under test.
TOPLEVEL = operand_mem

# Python module (tb/operand_mem/test_operand_mem.py, no .py).
MODULE = test_operand_mem

# Separate build dir so this suite never clobbers the others' artifacts.
SIM_BUILD = $(SIM_ROOT)/sim_build_operand_mem
COCOTB_RESULTS_FILE = $(SIM_ROOT)/sim_build_operand_mem/results.xml

include $(shell cocotb-config --makefiles)/Makefile.sim

# Negative test (issue #44): a write colliding with a real read must stop the
# run under every simulator. Passes only if the probe run fails AND the
# failure is operand_mem's collision check.
.PHONY: collision-check
collision-check:
	@mkdir -p $(SIM_BUILD); log=$(SIM_BUILD)/collision_check.log; \
	if OPERAND_MEM_COLLISION_PROBE=1 $(MAKE) --no-print-directory \
	     TESTCASE=test_collision_is_fatal \
	     COCOTB_RESULTS_FILE=$(SIM_BUILD)/collision_results.xml > $$log 2>&1; then \
	  echo "FAIL: write/read collision did not stop the $(SIM) run (see $$log)"; exit 1; \
	elif ! grep -q "collided with an in-flight read" $$log; then \
	  echo "FAIL: $(SIM) run failed, but not on the collision check (see $$log)"; exit 1; \
	else \
	  echo "PASS: operand_mem write/read collision is fatal under $(SIM)"; \
	fi
