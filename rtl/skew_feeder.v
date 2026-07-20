`timescale 1ns / 1ps

// rtl/skew_feeder.v -- RTL "edge memory" that replaces the testbench's Python
// feed_wave(). It takes an UNSKEWED NxN operand block, presented one column of
// A / one row of B per cycle, and emits the skewed, zero-padded a_west/b_north
// stream that rtl/systolic_array.v expects (row i delayed by i cycles, column j
// delayed by j cycles).
//
// This closes the boundary documented in docs/decisions.md (2026-07-05,
// "the skew/zero-padding feed is Python-side, not RTL"): the staggering and
// zero-padding now live in hardware -- a triangular bank of 8-bit shift
// registers -- instead of a Python loop.
//
// Interface / timing contract:
//   * On input cycle c (c = 0..N-1), drive a_col lane i = A[i][c] and b_row
//     lane j = B[c][j], with in_valid = 1. (A is presented column-by-column,
//     B row-by-row.)
//   * When in_valid = 0 the inputs are treated as zero, which is exactly the
//     zero-padding feed_wave() applied before/after each row/column's real
//     data window -- so the caller just drops in_valid to pad.
//   * Lane i's output is its input delayed by i cycles: lane 0 is a
//     combinational pass-through, lane i>=1 is an i-deep shift register. Under
//     Verilog non-blocking semantics this lines up bit-for-bit with the old
//     a_lanes[i] = A[i][t-i] convention when the array samples on the clock
//     edge (see tb/tile/test_tile.py, which proves A@B bit-exact end-to-end).
//
// valid_in for the array itself is intentionally NOT generated here -- that
// (and the K-chunk/N-block sequencing that feed_wave's compute_nblock() peer
// still does in Python) is the tile sequencer FSM's job, the next Phase 2 card.
module skew_feeder #(
    parameter N = 8
) (
    input  wire                  clk,
    input  wire                  reset,     // sync, active-high; clears the pipeline
    input  wire                  in_valid,  // high while a real column/row is presented
    input  wire signed [8*N-1:0] a_col,     // lane i = A[i][c] for the current input column c
    input  wire signed [8*N-1:0] b_row,     // lane j = B[c][j] for the current input row c
    output wire signed [8*N-1:0] a_west,     // to array: lane i = input lane i delayed by i
    output wire signed [8*N-1:0] b_north     // to array: lane j = input lane j delayed by j
);

    genvar i, k;
    generate
        for (i = 0; i < N; i = i + 1) begin : lane
            // in_valid gates each lane's input to zero -> hardware zero-padding.
            wire signed [7:0] a_gated = in_valid ? $signed(a_col[8*i +: 8]) : 8'sd0;
            wire signed [7:0] b_gated = in_valid ? $signed(b_row[8*i +: 8]) : 8'sd0;

            if (i == 0) begin : passthru
                // Lane 0 has zero skew -- straight through.
                assign a_west[8*i +: 8]  = a_gated;
                assign b_north[8*i +: 8] = b_gated;
            end else begin : delayed
                // Lane i: an i-deep shift register (stage k-1 -> stage k).
                reg signed [7:0] a_sr [0:i-1];
                reg signed [7:0] b_sr [0:i-1];
                integer s;
                always @(posedge clk) begin
                    if (reset) begin
                        for (s = 0; s < i; s = s + 1) begin
                            a_sr[s] <= 8'sd0;
                            b_sr[s] <= 8'sd0;
                        end
                    end else begin
                        a_sr[0] <= a_gated;
                        b_sr[0] <= b_gated;
                        for (s = 1; s < i; s = s + 1) begin
                            a_sr[s] <= a_sr[s-1];
                            b_sr[s] <= b_sr[s-1];
                        end
                    end
                end
                assign a_west[8*i +: 8]  = a_sr[i-1];
                assign b_north[8*i +: 8] = b_sr[i-1];
            end
        end
    endgenerate

endmodule
