`timescale 1ns / 1ps

// tb/operand_mem/sram_macro_behavioral.v -- test-only behavioral stand-in for the
// real OpenRAM-generated sky130_sram_512b_1rw_64x64 macro. rtl/operand_mem.v
// instantiates this module by name; the real generated .v (from issue #31's
// OpenRAM run) takes this file's place at synthesis time via the build system's
// file list, not an ifdef. Port convention (clk0/csb0/web0/addr0/din0/dout0)
// matches OpenRAM's typical single-port (1RW) SRAM macro output -- verify
// against the real generated .v next time the macro is regenerated (issue #31's
// build artifacts are gitignored, not checked into this repo).
module sky130_sram_512b_1rw_64x64 (
    input  wire        clk0,
    input  wire        csb0,   // active-low chip select
    input  wire        web0,   // active-low write enable
    input  wire [5:0]  addr0,
    input  wire [63:0] din0,
    output reg  [63:0] dout0
);
    reg [63:0] mem [0:63];

    always @(posedge clk0) begin
        if (!csb0) begin
            if (!web0) begin
                mem[addr0] <= din0;
            end
            dout0 <= mem[addr0];
        end
    end
endmodule
