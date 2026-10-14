`timescale 1ns / 1ps

// rtl/vpu_rsqrt.v -- the vector unit's reciprocal square root and reciprocal,
// one combinational core (milestone 4.3e). model/fixedpoint.py's rsqrt_q
// (recip = 0) and recip_q (recip = 1) are the definitions:
//
//   rsqrt: k = (bitlen(u) - 1) >> 1; v = u * 2^(14 - 2k) in [2^14, 2^16) (Q2.14);
//          seed r = RSQRT_LUT[(v >> 10) - 16] (48 entries); one Newton step
//          t = (v r^2) >> 29, r' = (r (3 * 2^15 - t)) >> 16;  1/sqrt(u) = r' 2^-(15+k)
//   recip: k = bitlen(u) - 1; v = u * 2^(15 - k) in [2^15, 2^16) (Q1.15);
//          seed r = RECIP_LUT[(v >> 10) - 32] (32 entries); one Newton step
//          t = (v r) >> 15, r' = (r (2^16 - t)) >> 15;  1/u = r' 2^-(15+k)
//
// u must be in [1, 2^40); `zero` flags u = 0, for which r and k are 0.
// r stays below 2^15 for every input (the lane multiplies depend on it: an
// int16 * r product must fit the requant lane's int32 accumulator).
module vpu_rsqrt (
    input  wire        recip,
    input  wire [39:0] u,
    output wire [15:0] r,
    output wire [5:0]  k,
    output wire        zero
);

    // Index of the most significant set bit of u (0 when u is 0 or 1).
    reg [5:0] msb;
    integer i;
    always @* begin
        msb = 6'd0;
        for (i = 0; i < 40; i = i + 1)
            if (u[i]) msb = i[5:0];
    end

    assign zero = (u == 40'd0);

    // Normalization: rsqrt shifts by an even amount to land v in [2^14, 2^16),
    // recip by whatever lands it in [2^15, 2^16).
    wire [5:0]  kk     = recip ? msb : {1'b0, msb[5:1]};
    wire [6:0]  target = recip ? 7'd15 : 7'd14;
    wire [6:0]  scale  = recip ? {1'b0, kk} : {kk, 1'b0};   // msb of u for recip, 2k for rsqrt
    wire        right  = (scale >= target);
    wire [6:0]  amt    = right ? (scale - target) : (target - scale);
    wire [39:0] vsh    = right ? (u >> amt) : (u << amt);
    wire [15:0] v      = vsh[15:0];

    reg [15:0] seed_rs, seed_rc;
    always @* begin
        case (v[15:10])
            6'd16: seed_rs = 16'd32268;  6'd17: seed_rs = 16'd31332;  6'd18: seed_rs = 16'd30474;
            6'd19: seed_rs = 16'd29682;  6'd20: seed_rs = 16'd28949;  6'd21: seed_rs = 16'd28268;
            6'd22: seed_rs = 16'd27632;  6'd23: seed_rs = 16'd27038;  6'd24: seed_rs = 16'd26481;
            6'd25: seed_rs = 16'd25956;  6'd26: seed_rs = 16'd25462;  6'd27: seed_rs = 16'd24994;
            6'd28: seed_rs = 16'd24552;  6'd29: seed_rs = 16'd24132;  6'd30: seed_rs = 16'd23733;
            6'd31: seed_rs = 16'd23354;  6'd32: seed_rs = 16'd22992;  6'd33: seed_rs = 16'd22646;
            6'd34: seed_rs = 16'd22315;  6'd35: seed_rs = 16'd21999;  6'd36: seed_rs = 16'd21695;
            6'd37: seed_rs = 16'd21404;  6'd38: seed_rs = 16'd21124;  6'd39: seed_rs = 16'd20855;
            6'd40: seed_rs = 16'd20596;  6'd41: seed_rs = 16'd20346;  6'd42: seed_rs = 16'd20106;
            6'd43: seed_rs = 16'd19873;  6'd44: seed_rs = 16'd19649;  6'd45: seed_rs = 16'd19431;
            6'd46: seed_rs = 16'd19221;  6'd47: seed_rs = 16'd19018;  6'd48: seed_rs = 16'd18821;
            6'd49: seed_rs = 16'd18630;  6'd50: seed_rs = 16'd18444;  6'd51: seed_rs = 16'd18264;
            6'd52: seed_rs = 16'd18090;  6'd53: seed_rs = 16'd17920;  6'd54: seed_rs = 16'd17755;
            6'd55: seed_rs = 16'd17594;  6'd56: seed_rs = 16'd17438;  6'd57: seed_rs = 16'd17285;
            6'd58: seed_rs = 16'd17137;  6'd59: seed_rs = 16'd16992;  6'd60: seed_rs = 16'd16851;
            6'd61: seed_rs = 16'd16714;  6'd62: seed_rs = 16'd16579;  6'd63: seed_rs = 16'd16448;
            default: seed_rs = 16'd0;    // v below 2^14: only for u = 0
        endcase
        case (v[15:10])
            6'd32: seed_rc = 16'd32264;  6'd33: seed_rc = 16'd31301;  6'd34: seed_rc = 16'd30394;
            6'd35: seed_rc = 16'd29537;  6'd36: seed_rc = 16'd28728;  6'd37: seed_rc = 16'd27962;
            6'd38: seed_rc = 16'd27236;  6'd39: seed_rc = 16'd26546;  6'd40: seed_rc = 16'd25891;
            6'd41: seed_rc = 16'd25267;  6'd42: seed_rc = 16'd24672;  6'd43: seed_rc = 16'd24105;
            6'd44: seed_rc = 16'd23564;  6'd45: seed_rc = 16'd23046;  6'd46: seed_rc = 16'd22550;
            6'd47: seed_rc = 16'd22075;  6'd48: seed_rc = 16'd21620;  6'd49: seed_rc = 16'd21183;
            6'd50: seed_rc = 16'd20764;  6'd51: seed_rc = 16'd20361;  6'd52: seed_rc = 16'd19973;
            6'd53: seed_rc = 16'd19600;  6'd54: seed_rc = 16'd19240;  6'd55: seed_rc = 16'd18893;
            6'd56: seed_rc = 16'd18559;  6'd57: seed_rc = 16'd18236;  6'd58: seed_rc = 16'd17924;
            6'd59: seed_rc = 16'd17623;  6'd60: seed_rc = 16'd17332;  6'd61: seed_rc = 16'd17050;
            6'd62: seed_rc = 16'd16777;  6'd63: seed_rc = 16'd16513;
            default: seed_rc = 16'd0;
        endcase
    end

    wire [15:0] seed = recip ? seed_rc : seed_rs;

    // rsqrt: t = (v r^2) >> 29 (46-bit product), r' = r (3 * 2^15 - t) >> 16.
    wire [63:0] vr   = {48'd0, v} * {48'd0, seed};
    wire [63:0] rs_t = (vr * {48'd0, seed}) >> 29;
    wire [63:0] rs_r = ({48'd0, seed} * (64'd98304 - rs_t)) >> 16;
    // recip: t = (v r) >> 15, r' = r (2^16 - t) >> 15.
    wire [63:0] rc_t = vr >> 15;
    wire [63:0] rc_r = ({48'd0, seed} * (64'd65536 - rc_t)) >> 15;

    wire [63:0] rfull = recip ? rc_r : rs_r;
    assign r = zero ? 16'd0 : rfull[15:0];
    assign k = zero ? 6'd0 : kk;

    // v is the low 16 bits of the normalized value (its top bits are zero by
    // construction); r is below 2^15, so the rest of rfull is zero too.
    wire unused = &{1'b0, vsh[39:16], rfull[63:16]};

endmodule
