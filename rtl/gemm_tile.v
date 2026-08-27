`timescale 1ns / 1ps

// rtl/gemm_tile.v -- a self-sequencing GEMM tile with its own operand memory:
// rtl/operand_mem.v (operand buffer) + rtl/gemm_sequencer.v (control FSM) +
// rtl/tile.v (rtl/skew_feeder.v + rtl/systolic_array.v). This is a single tile
// that loads, computes, and returns a full tiled (K-chunked) matmul with NO
// Python orchestration:
//
//   1. Load operands slot-by-slot through the write port (wr_en/wr_addr/
//      wr_a_col/wr_b_row) -- one (chunk, column) per slot.
//   2. Pulse `start` (with k_chunks) to compute one N-block.
//   3. Read acc_out when `done` goes high: the 8x8 int32 result
//      C_block = sum over K-chunks of A_chunk @ B_chunk.
//
// The write port is shaped like a NoC/DMA delivery interface on purpose -- a
// router writing operand slots here is the next Phase 2 step. Requantization
// (M1 scale + ReLU between layers) has no datapath in pe.v and stays a
// documented boundary, still done by the caller.
module gemm_tile #(
    parameter N              = 8,
    parameter KMAX           = 8,
    // Must match pe.v's real accumulate latency (rtl/pe.v's ACC_LATENCY
    // localparam). Sites that must stay in sync if that value ever changes:
    // rtl/pe.v's ACC_LATENCY localparam (the source of truth),
    // rtl/gemm_sequencer.v's PE_ACC_LATENCY default, this default, and
    // rtl/noc_node.v's PE_ACC_LATENCY default (threaded into its gemm_tile
    // instantiation below).
    parameter PE_ACC_LATENCY = 2
) (
    input  wire                          clk,
    input  wire                          rst,
    // Operand load / write port.
    input  wire                          wr_en,
    input  wire [$clog2(N*KMAX)-1:0]     wr_addr,
    input  wire signed [8*N-1:0]         wr_a_col,
    input  wire signed [8*N-1:0]         wr_b_row,
    // Compute handshake.
    input  wire                          start,
    input  wire [3:0]                    k_chunks,
    output wire                          busy,
    output wire                          done,
    output wire signed [32*N*N-1:0]      acc_out
);

    wire [$clog2(N*KMAX)-1:0] rd_addr;
    wire signed [8*N-1:0]     a_col;
    wire signed [8*N-1:0]     b_row;
    wire                      tile_reset;
    wire                      feed_valid;

    operand_mem #(.N(N), .KMAX(KMAX)) mem (
        .clk      (clk),
        .wr_en    (wr_en),
        .wr_addr  (wr_addr),
        .wr_a_col (wr_a_col),
        .wr_b_row (wr_b_row),
        .rd_addr  (rd_addr),
        .rd_a_col (a_col),
        .rd_b_row (b_row)
    );

    gemm_sequencer #(.N(N), .KMAX(KMAX), .PE_ACC_LATENCY(PE_ACC_LATENCY)) seq (
        .clk        (clk),
        .rst        (rst),
        .start      (start),
        .k_chunks   (k_chunks),
        .rd_addr    (rd_addr),
        .tile_reset (tile_reset),
        .feed_valid (feed_valid),
        .busy       (busy),
        .done       (done)
    );

    tile #(.N(N)) t (
        .clk      (clk),
        .reset    (tile_reset),
        .in_valid (feed_valid),
        .a_col    (a_col),
        .b_row    (b_row),
        .acc_out  (acc_out)
    );

endmodule
