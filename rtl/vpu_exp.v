`timescale 1ns / 1ps

// rtl/vpu_exp.v -- 2^-(z / 2^16) in Q0.16 for an integer z >= 0 (milestone
// 4.3e), combinational. model/fixedpoint.py's exp2neg_q is the definition:
// the integer part n = z >> 16 is a right shift, the fraction f = z mod 2^16
// goes through the second-order polynomial
//
//   2^-f ~= 1 - 0.67214 f + 0.17214 f^2     (p = 2^16 - ((A f + 2^15) >> 16)
//                                                + ((B f^2 + 2^31) >> 32),
//                                             A = 44049, B = 11281)
//
// and the result is 0 once n >= 17. The result is at most 2^16, so it needs
// 17 bits; z is taken below 2^48 (the exponent argument's domain, see
// rtl/vpu_exparg.v).
module vpu_exp (
    input  wire [47:0] z,
    output wire [16:0] e
);

    localparam [63:0] A = 64'd44049;
    localparam [63:0] B = 64'd11281;

    wire [31:0] n = z[47:16];
    wire [63:0] f = {48'd0, z[15:0]};

    wire [63:0] lin  = (A * f + 64'd32768) >> 16;
    wire [63:0] quad = (B * f * f + 64'd2147483648) >> 32;
    wire [63:0] p    = 64'd65536 - lin + quad;

    wire [63:0] shifted = p >> n[4:0];
    assign e = (n >= 32'd17) ? 17'd0 : shifted[16:0];

    wire unused = &{1'b0, shifted[63:17]};

endmodule
