`timescale 1ns / 1ps

// tb/operand_mem/sram_macro_behavioral.v -- test-only behavioral stand-in for the
// real OpenRAM-generated sky130_sram_512b_1rw_64x64 macro. rtl/operand_mem.v
// instantiates this module by name; the real generated .v (from issue #31's
// OpenRAM run) takes this file's place at synthesis time via the build system's
// file list, not an ifdef.
//
// Port shape (addr0[6:0], din0/dout0[64:0], spare_wen0) matches the REAL
// generated sky130_sram_512b_1rw_64x64.v exactly -- verified by regenerating
// the macro and reading its actual Verilog/LEF (issue #35), which disproved
// this file's previous assumption of a clean 6-bit/64-bit port with no spare
// pin (issue #48). See rtl/operand_mem.v's header comment for the address-
// layout and spare_wen0-polarity derivation (traced against OpenRAM's own
// compiler/base/verilog.py template, pinned commit b2b069ce...): the real
// macro's 64 logical words land at flat addresses 0..63 unpermuted, and
// spare_wen0 is active-high, so operand_mem.v ties addr0[6]/din0[64]/
// spare_wen0 all to 0 and never touches the spare row/column. This stand-in
// models the full 128-deep x 65-bit address/data space (RAM_DEPTH=1<<7,
// DATA_WIDTH=65) rather than just the 64 real words, so an out-of-range
// address (e.g. a bug that ever drove addr0[6]=1) reads/writes a distinct,
// defined location instead of aliasing back onto real data.
module sky130_sram_512b_1rw_64x64 (
    input  wire        clk0,
    input  wire        csb0,        // active-low chip select
    input  wire        web0,        // active-low write enable
    input  wire        spare_wen0,  // active-high spare-column write mask
    input  wire [6:0]  addr0,
    input  wire [64:0] din0,
    output reg  [64:0] dout0
);
    reg [64:0] mem [0:127];

    always @(posedge clk0) begin
        if (!csb0) begin
            if (!web0) begin
                mem[addr0][63:0] <= din0[63:0];
                if (spare_wen0) begin
                    mem[addr0][64] <= din0[64];
                end
            end
            dout0 <= mem[addr0];
        end
    end
endmodule
