`timescale 1ns / 1ps

// rtl/sim_mem.v -- behavioral 1R1W word memory for the command processor
// (milestone 4.2): program, weights, and the four activation banks. The read
// is registered and holds its data while re is low, so a stalled pipeline
// keeps its operands; a read and a write to the same address in one cycle
// return the old word. Zero-filled at time 0; then, if INIT_ARG names a
// plusarg format (e.g. "program=%s") and the run has that plusarg
// (+program=path/program.hex), loaded from that $readmemh file, so one
// simulator build runs any compiled image (compiler/emit.py).
module sim_mem #(
    parameter AW       = 15,
    parameter DW       = 64,
    parameter INIT_ARG = ""
) (
    input  wire          clk,
    input  wire          re,
    input  wire [AW-1:0] raddr,
    output reg  [DW-1:0] rdata,
    input  wire          we,
    input  wire [AW-1:0] waddr,
    input  wire [DW-1:0] wdata
);

    reg [DW-1:0]     mem [0:(1<<AW)-1];
    reg [8*1024-1:0] init_file;

    integer i;
    initial begin
        for (i = 0; i < (1 << AW); i = i + 1)
            mem[i] = {DW{1'b0}};
        rdata     = {DW{1'b0}};
        init_file = 0;
        if (INIT_ARG != "")
            if ($value$plusargs(INIT_ARG, init_file))
                $readmemh(init_file, mem);
    end

    always @(posedge clk) begin
        if (re)
            rdata <= mem[raddr];
        if (we)
            mem[waddr] <= wdata;
    end

endmodule
