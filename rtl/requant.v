`timescale 1ns / 1ps

// rtl/requant.v -- one requantization lane: int32 accumulator -> int8,
// combinational (issue #56). The math, and its NumPy reference, live in
// model/fixedpoint.py:
//
//   q = sat_int8(relu?((acc * m + 2^(sh-1)) >>> sh))
//
// m is an unsigned 16-bit multiplier and sh a right shift (the real rescale
// factor is m * 2^-sh); the rounding term is 0 when sh == 0, so this rounds
// half up. The datapath is 64 bits wide: |acc * m| < 2^47 and the rounding
// term is at most 2^62, so the sum cannot overflow for any sh in 0..63 and
// every encoding of (m, sh) has a defined result.
module requant (
    input  wire signed [31:0] acc,
    input  wire        [15:0] m,
    input  wire        [5:0]  sh,
    input  wire               relu,
    output wire        [7:0]  q
);

    wire signed [48:0] prod = acc * $signed({1'b0, m});
    wire        [63:0] half = (64'd1 << sh) >> 1;
    wire signed [63:0] sum  = {{15{prod[48]}}, prod} + $signed(half);
    wire signed [63:0] y    = sum >>> sh;

    wire hi_sat = (y > 64'sd127);
    wire lo_sat = relu ? y[63] : (y < -64'sd128);
    wire [7:0] lo = relu ? 8'h00 : 8'h80;

    assign q = hi_sat ? 8'h7f : lo_sat ? lo : y[7:0];

endmodule
