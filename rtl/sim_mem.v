`timescale 1ns / 1ps

// rtl/sim_mem.v -- behavioral 1R1W word memory for the command processor
// (milestone 4.2): program, weights, and the four activation banks. The read
// is registered and holds its data while re is low, so a stalled pipeline
// keeps its operands; a read and a write to the same address in one cycle
// return the old word. Zero-filled at time 0, then loaded from INIT (a
// $readmemh file) if one is given.
module sim_mem #(
    parameter AW   = 15,
    parameter DW   = 64,
    parameter INIT = ""
) (
    input  wire          clk,
    input  wire          re,
    input  wire [AW-1:0] raddr,
    output reg  [DW-1:0] rdata,
    input  wire          we,
    input  wire [AW-1:0] waddr,
    input  wire [DW-1:0] wdata
);

    reg [DW-1:0] mem [0:(1<<AW)-1];

    integer i;
    initial begin
        for (i = 0; i < (1 << AW); i = i + 1)
            mem[i] = {DW{1'b0}};
        rdata = {DW{1'b0}};
        if (INIT != "")
            $readmemh(INIT, mem);
    end

    always @(posedge clk) begin
        if (re)
            rdata <= mem[raddr];
        if (we)
            mem[waddr] <= wdata;
    end

endmodule
