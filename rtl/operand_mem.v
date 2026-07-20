`timescale 1ns / 1ps

// rtl/operand_mem.v -- the tile's operand buffer. Replaces the wide preloaded
// a_buf/b_buf buses gemm_sequencer.v used to index directly (the placeholder
// noted in docs/decisions.md, 2026-07-19) with a real load-then-read memory.
//
// One slot == one (chunk, column) of a tiled matmul: it holds an unskewed
// column of A (rd_a_col) and the matching row of B (rd_b_row). Addressing is
// addr = chunk*N + col, so an N-chunk N-block occupies N*chunks slots (up to
// N*KMAX). The sequencer drives rd_addr and reads combinationally; the write
// port loads slots ahead of time.
//
// The write port is deliberately shaped like what a NoC/DMA delivers later:
// {wr_addr, wr_a_col, wr_b_row} is an addressed operand payload. For now the
// testbench drives it directly (load, then pulse start); swapping in a router
// as the writer is the whole point of the next card.
//
// Read is combinational (a register file), which keeps the sequencer's timing
// identical to the wide-bus version. A synchronous SRAM (registered read) is a
// drop-in for synthesis later -- it would need the FSM to issue rd_addr one
// cycle ahead; that's a Phase 3 concern, not needed for behavioral verification.
module operand_mem #(
    parameter N    = 8,
    parameter KMAX = 8
) (
    input  wire                            clk,
    // Load / write port (testbench now; NoC/DMA later).
    input  wire                            wr_en,
    input  wire [$clog2(N*KMAX)-1:0]       wr_addr,
    input  wire signed [8*N-1:0]           wr_a_col,   // unskewed column of A for this slot
    input  wire signed [8*N-1:0]           wr_b_row,   // matching row of B for this slot
    // Read port (to the sequencer / tile), combinational.
    input  wire [$clog2(N*KMAX)-1:0]       rd_addr,
    output wire signed [8*N-1:0]           rd_a_col,
    output wire signed [8*N-1:0]           rd_b_row
);

    localparam DEPTH = N * KMAX;

    reg signed [8*N-1:0] a_ram [0:DEPTH-1];
    reg signed [8*N-1:0] b_ram [0:DEPTH-1];

    always @(posedge clk) begin
        if (wr_en) begin
            a_ram[wr_addr] <= wr_a_col;
            b_ram[wr_addr] <= wr_b_row;
        end
    end

    assign rd_a_col = a_ram[rd_addr];
    assign rd_b_row = b_ram[rd_addr];

endmodule
