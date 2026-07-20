`timescale 1ns / 1ps

// rtl/tile.v -- a single self-feeding systolic tile: rtl/skew_feeder.v wired to
// rtl/systolic_array.v. This is the first increment toward a tile that runs a
// matmul without a Python loop driving its pins -- the caller now presents an
// UNSKEWED NxN block (A column-by-column, B row-by-row) and the hardware does
// its own skewing/zero-padding.
//
// The array's valid_in is tied high: outside each PE's real accumulation window
// the skew_feeder emits zeros, so a stray 0*0 accumulation is harmless (the same
// property proven for the broadcast valid_in in docs/decisions.md, 2026-07-05).
// One matmul per reset; the K-chunk/N-block sequencing across matmuls is still
// the caller's job until the tile sequencer FSM card lands.
module tile #(
    parameter N = 8
) (
    input  wire                     clk,
    input  wire                     reset,     // sync, active-high
    input  wire                     in_valid,  // high while a real column/row is presented
    input  wire signed [8*N-1:0]    a_col,     // lane i = A[i][c] for input column c
    input  wire signed [8*N-1:0]    b_row,     // lane j = B[c][j] for input row c
    output wire signed [32*N*N-1:0] acc_out    // PE(i,j) = acc_out[32*(i*N+j) +: 32]
);

    wire signed [8*N-1:0] a_west;
    wire signed [8*N-1:0] b_north;

    skew_feeder #(.N(N)) feeder (
        .clk      (clk),
        .reset    (reset),
        .in_valid (in_valid),
        .a_col    (a_col),
        .b_row    (b_row),
        .a_west   (a_west),
        .b_north  (b_north)
    );

    systolic_array #(.N(N)) array (
        .clk      (clk),
        .reset    (reset),
        .valid_in (1'b1),
        .a_west   (a_west),
        .b_north  (b_north),
        .acc_out  (acc_out)
    );

endmodule
