`timescale 1ns / 1ps

// synth/sram_blackbox.v -- Yosys blackbox stub for the real sky130 SRAM macro
// (sky130_sram_512b_1rw_64x64, generated via OpenRAM -- issue #31/#32) that
// rtl/operand_mem.v instantiates by name. Port list matches operand_mem.v's
// instantiation exactly; no internal behavior is modeled here (this file is
// synthesis-only, never used in simulation -- tb/operand_mem/
// sram_macro_behavioral.v is the simulation stand-in).
//
// (* blackbox *) tells Yosys to treat this as an opaque, already-implemented
// cell: it gets a port list to type-check hierarchy against, but zero gates
// and zero area, exactly like referencing a real hard macro from its LEF/LIB
// views during a real flow. The real macro's physical area (from its real
// generated LEF) is added back in separately when reporting the tile's true
// total area -- see docs/decisions.md, issue #35 entry.
(* blackbox *)
module sky130_sram_512b_1rw_64x64 (
    input  wire        clk0,
    input  wire        csb0,
    input  wire        web0,
    input  wire [5:0]  addr0,
    input  wire [63:0] din0,
    output wire [63:0] dout0
);
endmodule
