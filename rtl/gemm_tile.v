`timescale 1ns / 1ps

// rtl/gemm_tile.v -- a self-sequencing GEMM tile: rtl/gemm_sequencer.v (control
// FSM) driving rtl/tile.v (rtl/skew_feeder.v + rtl/systolic_array.v). This is
// the point where a single tile computes a full tiled (K-chunked) matmul with
// NO Python orchestration: the caller preloads the operand buffers, pulses
// `start`, and reads acc_out when `done` goes high.
//
// One `start` pulse computes one N-block: acc_out then holds the 8x8 int32
// result C_block = sum over K-chunks of A_chunk @ B_chunk. Requantization (the
// M1 scale + ReLU between layers) has no datapath in pe.v and stays a documented
// boundary -- out of scope here, still done by the caller.
module gemm_tile #(
    parameter N    = 8,
    parameter KMAX = 8
) (
    input  wire                          clk,
    input  wire                          rst,
    input  wire                          start,
    input  wire [3:0]                    k_chunks,
    input  wire signed [8*N*N*KMAX-1:0]  a_buf,
    input  wire signed [8*N*N*KMAX-1:0]  b_buf,
    output wire                          busy,
    output wire                          done,
    output wire signed [32*N*N-1:0]      acc_out
);

    wire                  tile_reset;
    wire                  feed_valid;
    wire signed [8*N-1:0] a_col;
    wire signed [8*N-1:0] b_row;

    gemm_sequencer #(.N(N), .KMAX(KMAX)) seq (
        .clk        (clk),
        .rst        (rst),
        .start      (start),
        .k_chunks   (k_chunks),
        .a_buf      (a_buf),
        .b_buf      (b_buf),
        .tile_reset (tile_reset),
        .feed_valid (feed_valid),
        .a_col      (a_col),
        .b_row      (b_row),
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
