`timescale 1ns / 1ps

// rtl/operand_mem.v -- the tile's operand buffer, backed by a real sky130 SRAM
// macro (issue #31/#32). One slot == one (chunk, column) of a tiled matmul: it
// holds an unskewed column of A (rd_a_col) and the matching row of B
// (rd_b_row). Addressing is addr = chunk*N + col, so an N-chunk N-block
// occupies N*chunks slots (up to N*KMAX).
//
// The write port is deliberately shaped like what a NoC/DMA delivers:
// {wr_addr, wr_a_col, wr_b_row} is an addressed operand payload.
//
// The real macro has one shared address/control port per bank, not separate
// read and write ports -- write wins by priority (wr_en ? wr_addr : rd_addr)
// since no real caller today ever asserts wr_en and expects a read in the same
// cycle (write happens during the NoC load phase; reads happen once the
// sequencer starts the compute phase).
//
// Read is now REGISTERED (RD_LATENCY cycles after rd_addr is presented, not
// the same cycle) -- a real SRAM macro's read is synchronous. Issue #33 threads
// RD_LATENCY into gemm_sequencer.v's drain-window sizing.
module operand_mem #(
    parameter N    = 8,
    parameter KMAX = 8
) (
    input  wire                            clk,
    // Load / write port (NoC/DMA delivers this).
    input  wire                            wr_en,
    input  wire [$clog2(N*KMAX)-1:0]       wr_addr,
    input  wire signed [8*N-1:0]           wr_a_col,   // unskewed column of A for this slot
    input  wire signed [8*N-1:0]           wr_b_row,   // matching row of B for this slot
    // Read port (to the sequencer / tile), registered.
    input  wire [$clog2(N*KMAX)-1:0]       rd_addr,
    output wire signed [8*N-1:0]           rd_a_col,
    output wire signed [8*N-1:0]           rd_b_row
);

    localparam RD_LATENCY = 1;  // real SRAM macro: registered (synchronous) read

    wire [$clog2(N*KMAX)-1:0] a_addr = wr_en ? wr_addr : rd_addr;
    wire [$clog2(N*KMAX)-1:0] b_addr = wr_en ? wr_addr : rd_addr;

    sky130_sram_512b_1rw_64x64 a_bank (
        .clk0  (clk),
        .csb0  (1'b0),
        .web0  (~wr_en),
        .addr0 (a_addr),
        .din0  (wr_a_col),
        .dout0 (rd_a_col)
    );

    sky130_sram_512b_1rw_64x64 b_bank (
        .clk0  (clk),
        .csb0  (1'b0),
        .web0  (~wr_en),
        .addr0 (b_addr),
        .din0  (wr_b_row),
        .dout0 (rd_b_row)
    );

endmodule
