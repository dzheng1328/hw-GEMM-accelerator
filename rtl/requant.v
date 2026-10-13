`timescale 1ns / 1ps

// rtl/requant.v -- one requantization lane: int32 accumulator -> int8 (or
// int16), combinational (issue #56). The math, and its NumPy reference, live
// in model/fixedpoint.py:
//
//   q = sat_QW(relu?((acc * m + 2^(sh-1)) >>> sh))
//
// QW = 8 is requant() and QW = 16 is requant16() (RESULT16; the caller ties
// relu low, since no 4.3 op needs it).
//
// m is an unsigned 16-bit multiplier and sh a right shift (the real rescale
// factor is m * 2^-sh); the rounding term is 0 when sh == 0, so this rounds
// half up. The datapath is 64 bits wide: |acc * m| < 2^47 and the rounding
// term is at most 2^62, so the sum cannot overflow for any sh in 0..63 and
// every encoding of (m, sh) has a defined result.
module requant #(
    parameter QW = 8                   // output width: 8 (RESULT8) or 16 (RESULT16)
) (
    input  wire signed [31:0] acc,
    input  wire        [15:0] m,
    input  wire        [5:0]  sh,
    input  wire               relu,
    output wire      [QW-1:0] q
);

    localparam signed [63:0] QMAX = (64'sd1 <<< (QW - 1)) - 64'sd1;
    localparam signed [63:0] QMIN = -(64'sd1 <<< (QW - 1));

    wire signed [48:0] prod = acc * $signed({1'b0, m});
    wire        [63:0] half = (64'd1 << sh) >> 1;
    wire signed [63:0] sum  = {{15{prod[48]}}, prod} + $signed(half);
    wire signed [63:0] y    = sum >>> sh;

    wire hi_sat = (y > QMAX);
    wire lo_sat = relu ? y[63] : (y < QMIN);
    wire [QW-1:0] lo = relu ? {QW{1'b0}} : {1'b1, {(QW-1){1'b0}}};

    assign q = hi_sat ? {1'b0, {(QW-1){1'b1}}} : lo_sat ? lo : y[QW-1:0];

endmodule
