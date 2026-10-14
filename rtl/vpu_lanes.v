`timescale 1ns / 1ps

// rtl/vpu_lanes.v -- LANES independent rounding-shift lanes (milestone 4.3e):
// each is rtl/requant.v with its own multiplier and shift, no ReLU, so every
// lane is model/fixedpoint.py's requant (QW = 8) or requant16 (QW = 16):
//
//   q = sat_QW((acc * m + 2^(sh-1)) >> sh)
//
// The vector sub-ops build their accumulators in front of this: EMBED's
// int8 rows (QW 16), RMSNORM's x * r (QW 8, m = the norm scale, sh = sh + 15
// + k), ROPE's rotations (QW 8, m = 1, sh = 14), SILU_MUL's table * up
// (QW 8), and SOFTMAX's e * 127 with the reciprocal as m (QW 8).
module vpu_lanes #(
    parameter LANES = 4,
    parameter QW    = 8
) (
    input  wire [LANES*32-1:0] acc,
    input  wire [LANES*16-1:0] m,
    input  wire [LANES*6-1:0]  sh,
    output wire [LANES*QW-1:0] q
);

    genvar g;
    generate
        for (g = 0; g < LANES; g = g + 1) begin : g_lane
            requant #(.QW(QW)) rq (
                .acc(acc[g*32 +: 32]), .m(m[g*16 +: 16]), .sh(sh[g*6 +: 6]),
                .relu(1'b0), .q(q[g*QW +: QW]));
        end
    endgenerate

endmodule
