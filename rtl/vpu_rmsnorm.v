`timescale 1ns / 1ps

// rtl/vpu_rmsnorm.v -- the vector unit's RMSNORM (milestone 4.3e): the
// residual's 64 int16 features, per story, to int8 (model/fixedpoint.py
// rmsnorm_q; compiler/golden_vop.py rmsnorm):
//
//   ra  = residual (int16 feature words, 128 words: feature f is words 2f
//         (stories 0-3) and 2f + 1 (stories 4-7))
//   rb  = destination (int8 feature words, 64: byte s is story s)
//   rc  = parameter word (A word): m [15:0], sh [21:16], eps_q [63:32]
//
//   u = (sum of x^2 over the 64 features >> 6) + eps_q       per story
//   (r, k) = rsqrt(u);   y = clip(round(x * r * m >> (sh + 15 + k)))
//
// Pass 1 reads the 128 words and accumulates 8 sums of squares (40 bits). 8
// cycles then run the shared rsqrt unit (rtl/vpu_rsqrt.v, wired through
// vpu.v) once per story. Pass 2 re-reads the 128 words: the stories 0-3 half
// of a feature is rounded as it arrives and held, and the stories 4-7 half
// completes the output word. x * r fits an int32 (r < 2^15), so each lane is
// a rounding-shift lane with m and sh + 15 + k (clamped to 63, the domain
// fixedpoint.rmsnorm_q guards).
module vpu_rmsnorm (
    input  wire        clk,
    input  wire        rst,
    input  wire        kill,
    input  wire        go,
    input  wire [16:0] ra,
    input  wire [16:0] rb,
    input  wire [15:0] rc,
    output reg         ar_v,
    output reg  [16:0] ar_a,
    output reg         br_v,
    output reg  [15:0] br_a,
    output reg  [15:0] rq_i,
    input  wire        dv,
    input  wire [15:0] di,
    input  wire [63:0] dw,
    output reg         aw_v,
    output reg  [16:0] aw_a,
    output reg  [63:0] aw_d,
    output reg         fin,
    output reg         flt,
    output wire [39:0] ru_u,
    input  wire [15:0] ru_r,
    input  wire [5:0]  ru_k,
    input  wire        ru_zero
);

    localparam [15:0] K_PARAM = 16'd0, K_P1 = 16'd1, K_P2 = 16'd2;
    localparam [1:0]  S_P1 = 2'd0, S_NORM = 2'd1, S_P2 = 2'd2;

    reg         act;
    reg  [1:0]  st;
    reg         sent;          // the parameter read has been issued
    reg  [7:0]  ic;            // reads issued in this pass, 0..128
    reg         p2;            // issuing pass 2
    reg  [7:0]  cw;            // words arrived in this pass
    reg  [15:0] m;
    reg  [5:0]  sh;
    reg  [31:0] eps;
    reg  [39:0] ss [0:7];      // sums of squares
    reg  [15:0] rv [0:7];
    reg  [5:0]  kv [0:7];
    reg  [2:0]  ns;
    reg  [31:0] ylo;           // stories 0-3 of the feature being finished

    // ---- pass 1: the 4 squares of the arriving half ----
    wire [31:0] sq [0:3];
    genvar l;
    generate
        for (l = 0; l < 4; l = l + 1) begin : g_sq
            wire signed [15:0] x = dw[16*l +: 16];
            assign sq[l] = x * x;
        end
    endgenerate

    // ---- NORM: u for story ns, into the shared rsqrt ----
    wire [39:0] ssn = ss[ns];
    assign ru_u = (st == S_NORM && act) ? ({6'd0, ssn[39:6]} + {8'd0, eps}) : 40'd0;
    wire unused = &{1'b0, ssn[5:0]};

    // ---- pass 2: 4 lanes of x * r, rounded by m and sh + 15 + k ----
    wire        half = cw[0];
    wire [127:0] accs;
    wire [63:0]  ms;
    wire [23:0]  shs;
    wire [31:0]  q;
    generate
        for (l = 0; l < 4; l = l + 1) begin : g_lane
            wire signed [15:0] x  = dw[16*l +: 16];
            wire        [15:0] rr = half ? rv[4 + l] : rv[l];
            wire        [5:0]  kk = half ? kv[4 + l] : kv[l];
            wire        [7:0]  tot = {2'd0, sh} + 8'd15 + {2'd0, kk};
            assign accs[32*l +: 32] = x * $signed({1'b0, rr});
            assign ms[16*l +: 16]   = m;
            assign shs[6*l +: 6]    = (tot > 8'd63) ? 6'd63 : tot[5:0];
        end
    endgenerate
    vpu_lanes #(.LANES(4), .QW(8)) lanes (.acc(accs), .m(ms), .sh(shs), .q(q));

    integer i;
    always @(posedge clk) begin
        ar_v <= 1'b0;
        br_v <= 1'b0;
        aw_v <= 1'b0;
        fin  <= 1'b0;
        flt  <= 1'b0;
        rq_i <= 16'd0;
        if (rst || kill) begin
            act <= 1'b0;
        end else begin
            if (go) begin
                act  <= 1'b1;
                st   <= S_P1;
                sent <= 1'b0;
                ic   <= 8'd0;
                p2   <= 1'b0;
                cw   <= 8'd0;
                for (i = 0; i < 8; i = i + 1) ss[i] <= 40'd0;
            end
            // ---- issue ----
            if (act && !sent) begin
                br_v <= 1'b1;
                br_a <= rc;
                rq_i <= K_PARAM;
                sent <= 1'b1;
            end else if (act && ic != 8'd128 && (st == S_P1 || st == S_P2)) begin
                ar_v <= 1'b1;
                ar_a <= ra + {9'd0, ic[7:0]};
                rq_i <= p2 ? K_P2 : K_P1;
                ic   <= ic + 8'd1;
            end
            // ---- arrivals ----
            if (act && dv) begin
                case (di)
                    K_PARAM: begin m <= dw[15:0]; sh <= dw[21:16]; eps <= dw[63:32]; end
                    K_P1: begin
                        for (i = 0; i < 4; i = i + 1)
                            if (cw[0]) ss[4 + i] <= ss[4 + i] + {8'd0, sq[i]};
                            else       ss[i]     <= ss[i]     + {8'd0, sq[i]};
                        cw <= cw + 8'd1;
                        if (cw == 8'd127) begin
                            st <= S_NORM;
                            ns <= 3'd0;
                            cw <= 8'd0;
                        end
                    end
                    default: begin   // K_P2
                        if (cw[0]) begin
                            aw_v <= 1'b1;
                            aw_a <= rb + {10'd0, cw[7:1]};
                            aw_d <= {q, ylo};
                            if (cw == 8'd127) begin
                                fin <= 1'b1;
                                act <= 1'b0;
                            end
                        end else begin
                            ylo <= q;
                        end
                        cw <= cw + 8'd1;
                    end
                endcase
            end
            // ---- the 8 reciprocal square roots ----
            if (act && st == S_NORM) begin
                rv[ns] <= ru_r;
                kv[ns] <= ru_k;
                if (ru_zero) flt <= 1'b1;
                ns <= ns + 3'd1;
                if (ns == 3'd7) begin
                    st <= S_P2;
                    p2 <= 1'b1;
                    ic <= 8'd0;
                    cw <= 8'd0;
                end
            end
        end
    end

endmodule
