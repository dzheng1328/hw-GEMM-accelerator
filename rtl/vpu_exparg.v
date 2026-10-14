`timescale 1ns / 1ps

// rtl/vpu_exparg.v -- the exponent argument of SOFTMAX and SAMPLE (milestone
// 4.3e), combinational, for rtl/vpu_exp.v. d is the distance below the
// maximum (max - x, 0 to 65535); (m, sh) encodes s * log2(e) * 2^16 as in
// model/fixedpoint.py's exp_arg:
//
//   z0 = (d m + 2^(sh-1)) >> sh        (no rounding term when sh = 0)
//   z  = (z0 inv) >> 8
//
// inv is SAMPLE's inverse temperature (Q8.8); SOFTMAX passes 256, which
// leaves z0 unchanged. z0 < 2^33 and inv < 2^16, so z < 2^41.
module vpu_exparg (
    input  wire [15:0] d,
    input  wire [15:0] m,
    input  wire [5:0]  sh,
    input  wire [15:0] inv,
    output wire [47:0] z
);

    wire [63:0] prod = {48'd0, d} * {48'd0, m};
    wire [63:0] half = (64'd1 << sh) >> 1;
    wire [63:0] z0   = (prod + half) >> sh;
    wire [63:0] zs   = (z0 * {48'd0, inv}) >> 8;

    assign z = zs[47:0];

    wire unused = &{1'b0, zs[63:48]};

endmodule
