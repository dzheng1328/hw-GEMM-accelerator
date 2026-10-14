`timescale 1ns / 1ps

// tb/vpu/vpu_expcheck.v -- rtl/vpu_exparg.v feeding rtl/vpu_exp.v, so one
// cocotb suite checks the whole exponent path (fixedpoint.exp_arg, then
// exp2neg_q) and, with m = 1, sh = 0, inv = 256, the exponential alone.
module vpu_expcheck (
    input  wire [15:0] d,
    input  wire [15:0] m,
    input  wire [5:0]  sh,
    input  wire [15:0] inv,
    output wire [47:0] z,
    output wire [16:0] e
);

    vpu_exparg arg (.d(d), .m(m), .sh(sh), .inv(inv), .z(z));
    vpu_exp    ex  (.z(z), .e(e));

endmodule
