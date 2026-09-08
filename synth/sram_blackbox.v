`timescale 1ns / 1ps

// synth/sram_blackbox.v -- Yosys blackbox stub for the real sky130 SRAM macro
// (sky130_sram_512b_1rw_64x64, generated via OpenRAM -- issue #31/#32) that
// rtl/operand_mem.v instantiates by name. Port list matches operand_mem.v's
// real instantiation exactly (addr0[6:0]/din0,dout0[64:0]/spare_wen0 -- the
// real macro's actual port shape, confirmed by regenerating it and reading
// its real generated .v/.lef, issue #48; see rtl/operand_mem.v's header
// comment for the derivation). No internal behavior is modeled here (this
// file is synthesis-only, never used in simulation -- tb/operand_mem/
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
    input  wire        spare_wen0,
    input  wire [6:0]  addr0,
    input  wire [64:0] din0,
    output wire [64:0] dout0
);
endmodule
