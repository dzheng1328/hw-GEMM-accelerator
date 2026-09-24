# tb/common.mk -- simulator settings shared by every tb/*/Makefile, included
# just before cocotb's Makefile.sim.
#
# Verilator is the default simulator (issue #53): Phase 4 workloads need its
# speed (~6x Icarus on the 2x2 mesh). Icarus stays supported as a cross-check:
#   SIM=icarus ./test.sh        or        make SIM=icarus
#
# Each simulator gets its own build tree (sim/<SIM>/<suite>) so switching
# between them never reuses the other's artifacts. Waveform builds
# (WAVES=1) get their own tree too, since Verilator bakes tracing into the
# compiled model.

SIM ?= verilator
TOPLEVEL_LANG ?= verilog

TB_DIR    := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
REPO_ROOT := $(abspath $(TB_DIR)/..)
SIM_ROOT  := $(REPO_ROOT)/sim/$(SIM)$(if $(filter 1,$(WAVES)),-waves)

# cocotb 1.9's Makefile flow only checks that results.xml exists, so a failed
# test still exited 0. Recipes expand this at run time, and override beats the
# plain define cocotb's Makefile.inc makes after this file is included.
override define check_for_results_file
	@python $(TB_DIR)/check_results.py $(COCOTB_RESULTS_FILE)
endef

ifeq ($(SIM),verilator)
# -Wall with warnings fatal: every lint and style warning either gets fixed or
# is waived, with a reason, in tb/lint_waivers.vlt.
# COMPILE_ARGS, not EXTRA_ARGS: cocotb also passes EXTRA_ARGS to the built
# simulator binary at run time.
COMPILE_ARGS += -Wall $(TB_DIR)/lint_waivers.vlt
# Rebuild when the waivers or these settings change, not just the RTL.
CUSTOM_COMPILE_DEPS += $(TB_DIR)/lint_waivers.vlt $(TB_DIR)/common.mk
# Compile the generated C++ on every core (cold builds dominate short suites).
BUILD_ARGS += -j$(shell sysctl -n hw.ncpu 2>/dev/null || nproc)
endif

# WAVES=1 dumps <SIM_BUILD>/<TOPLEVEL>.fst under either simulator. cocotb
# handles it natively for Icarus; for Verilator it only knows VERILATOR_TRACE
# (VCD), so map WAVES onto FST tracing here.
ifeq ($(SIM)$(WAVES),verilator1)
COMPILE_ARGS += --trace-fst --trace-structs
SIM_ARGS += --trace --trace-file $(SIM_BUILD)/$(TOPLEVEL).fst
# Homebrew's Verilator links its FST writer against lz4 but leaves Homebrew's
# own include/lib dirs off the C++ search path.
BREW_PREFIX := $(shell brew --prefix 2>/dev/null)
ifneq ($(BREW_PREFIX),)
COMPILE_ARGS += -CFLAGS -I$(BREW_PREFIX)/include -LDFLAGS -L$(BREW_PREFIX)/lib
endif
endif
