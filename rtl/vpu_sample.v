`timescale 1ns / 1ps

// rtl/vpu_sample.v -- the vector unit's SAMPLE (milestone 4.3e): the next
// token of every story from its logits (model/fixedpoint.py sample_q;
// compiler/golden_vop.py sample):
//
//   ra = logits (int16 feature words, 512 vocabulary entries x 2 words: entry
//        v is words 2v (stories 0-3) and 2v + 1 (stories 4-7))
//   rb = parameter word (A word): the logit exponent's m [15:0], sh [21:16]
//   rc = seeds (A words, 4: story s's xorshift32 state in 32-bit lane s)
//   t, plen, inv_temp = registers T, PLEN, INV_TEMP (Q8.8)
//
// Writes the token log's step t + 1 (words 2 (t + 1) and 2 (t + 1) + 1: int16
// lanes, stories 0-3 then 4-7). While t + 1 < plen the log already holds the
// prompt token, so nothing happens. With inv_temp = 0 one pass takes each
// story's argmax (the lowest index on ties) and the generators are untouched.
// Otherwise the seeds load first, and three passes of the 1024 logit words run:
//   pass 1  the story's maximum logit
//   pass 2  S = sum over the vocabulary of e, e = exp2neg(((max - x) m, sh) inv >> 8)
//   (the 8 generators advance once; u = ((state >> 16) S) >> 16)
//   pass 3  the first entry whose running sum of e exceeds u
// and the advanced states are written back. An inv_temp of 65536 or more is
// a fault (the exponent argument is bounded to 48 bits).
module vpu_sample (
    input  wire        clk,
    input  wire        rst,
    input  wire        kill,
    input  wire        go,
    input  wire [16:0] ra,
    input  wire [15:0] rb,
    input  wire [15:0] rc,
    input  wire [7:0]  t,
    input  wire [31:0] plen,
    input  wire [31:0] inv_temp,
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
    output reg         bw_v,
    output reg  [15:0] bw_a,
    output reg  [63:0] bw_d,
    output reg         fin,
    output reg         flt
);

    localparam [15:0] K_PARAM = 16'd0, K_SEED = 16'd1, K_DATA = 16'd2;
    localparam [2:0]  S_P1 = 3'd0, S_P2 = 3'd1, S_ADV = 3'd2, S_U = 3'd3, S_P3 = 3'd4, S_WR = 3'd5;

    reg         act;
    reg  [2:0]  st;
    reg         smp;               // sampling (inv_temp > 0), not argmax
    reg  [15:0] inv;
    reg  [2:0]  hs;                // header reads issued: param, 4 seeds
    reg  [10:0] ic;                // data reads issued in this pass, 0..1024
    reg  [10:0] ac;                // data words arrived in this pass
    reg  [1:0]  sc;                // seed words arrived
    reg  [15:0] m;
    reg  [5:0]  sh;
    reg  signed [15:0] best [0:7];
    reg  [8:0]  tok [0:7];
    reg  [25:0] ssum [0:7];
    reg  [25:0] cum [0:7];
    reg  [25:0] u [0:7];
    reg         found [0:7];
    reg  [1:0]  wc;

    wire [255:0] state;
    wire         rng_ld  = act && dv && di == K_SEED;
    wire         rng_adv = act && st == S_ADV;
    vpu_rng rng (.clk(clk), .ld(rng_ld), .ld_idx(sc), .ld_data(dw), .adv(rng_adv), .state(state));

    // ---- the 4 lanes of the arriving word: story 4 h + l, vocabulary entry v ----
    wire        h = ac[0];
    wire [8:0]  v = ac[9:1];
    wire signed [15:0] s [0:3];
    wire [16:0] e [0:3];
    genvar l;
    generate
        for (l = 0; l < 4; l = l + 1) begin : g_lane
            assign s[l] = dw[16*l +: 16];
            wire signed [15:0] mxl = best[{h, l[1:0]}];
            wire [15:0] d  = 16'(mxl - s[l]);
            wire [47:0] z;
            vpu_exparg arg (.d(d), .m(m), .sh(sh), .inv(inv), .z(z));
            vpu_exp    ex  (.z(z), .e(e[l]));
        end
    endgenerate

    // ---- the token words written at the end ----
    wire [8:0] t1 = {1'b0, t} + 9'd1;
    wire [63:0] tokw = wc[0] ? {7'd0, tok[7], 7'd0, tok[6], 7'd0, tok[5], 7'd0, tok[4]}
                             : {7'd0, tok[3], 7'd0, tok[2], 7'd0, tok[1], 7'd0, tok[0]};

    wire last_a = (ac == 11'd1023);

    integer i;
    always @(posedge clk) begin
        ar_v <= 1'b0;
        br_v <= 1'b0;
        aw_v <= 1'b0;
        bw_v <= 1'b0;
        fin  <= 1'b0;
        flt  <= 1'b0;
        rq_i <= 16'd0;
        if (rst || kill) begin
            act <= 1'b0;
        end else begin
            if (go) begin
                inv <= inv_temp[15:0];
                smp <= (inv_temp != 32'd0);
                st  <= S_P1;
                hs  <= 3'd0;
                ic  <= 11'd0;
                ac  <= 11'd0;
                sc  <= 2'd0;
                wc  <= 2'd0;
                for (i = 0; i < 8; i = i + 1) begin
                    best[i] <= 16'sh8000;
                    tok[i]  <= 9'd0;
                    ssum[i] <= 26'd0;
                end
                if ({24'd0, t} + 32'd1 < plen) begin
                    fin <= 1'b1;            // prompt copy: the log already holds the token
                end else if (inv_temp[31:16] != 16'd0) begin
                    flt <= 1'b1;
                end else begin
                    act <= 1'b1;
                end
            end
            // ---- issue: header reads (sampling only), then the data words of the pass ----
            if (act && smp && hs != 3'd5) begin
                hs <= hs + 3'd1;
                br_v <= 1'b1;
                br_a <= (hs == 3'd0) ? rb : rc + {13'd0, hs - 3'd1};
                rq_i <= (hs == 3'd0) ? K_PARAM : K_SEED;
            end else if (act && (st == S_P1 || st == S_P2 || st == S_P3) && ic != 11'd1024) begin
                ar_v <= 1'b1;
                ar_a <= ra + {6'd0, ic};
                rq_i <= K_DATA;
                ic   <= ic + 11'd1;
            end
            // ---- arrivals ----
            if (act && dv) begin
                case (di)
                    K_PARAM: begin m <= dw[15:0]; sh <= dw[21:16]; end
                    K_SEED:  sc <= sc + 2'd1;
                    default: begin
                        ac <= ac + 11'd1;
                        case (st)
                            S_P1: begin
                                for (i = 0; i < 4; i = i + 1)
                                    if (s[i] > best[{h, i[1:0]}]) begin
                                        best[{h, i[1:0]}] <= s[i];
                                        tok[{h, i[1:0]}]  <= v;
                                    end
                                if (last_a) begin
                                    ac <= 11'd0;
                                    ic <= 11'd0;
                                    st <= smp ? S_P2 : S_WR;
                                end
                            end
                            S_P2: begin
                                for (i = 0; i < 4; i = i + 1)
                                    ssum[{h, i[1:0]}] <= ssum[{h, i[1:0]}] + {9'd0, e[i]};
                                if (last_a) st <= S_ADV;
                            end
                            default: begin   // S_P3
                                for (i = 0; i < 4; i = i + 1) begin
                                    cum[{h, i[1:0]}] <= cum[{h, i[1:0]}] + {9'd0, e[i]};
                                    if (!found[{h, i[1:0]}] && cum[{h, i[1:0]}] + {9'd0, e[i]} > u[{h, i[1:0]}]) begin
                                        found[{h, i[1:0]}] <= 1'b1;
                                        tok[{h, i[1:0]}]   <= v;
                                    end
                                end
                                if (last_a) st <= S_WR;
                            end
                        endcase
                    end
                endcase
            end
            // ---- the generators advance, then u = ((state >> 16) S) >> 16 ----
            if (act && st == S_ADV) st <= S_U;
            if (act && st == S_U) begin
                for (i = 0; i < 8; i = i + 1) begin
                    u[i]     <= 26'(({10'd0, state[32*i + 16 +: 16]} * {16'd0, ssum[i]}) >> 16);
                    cum[i]   <= 26'd0;
                    found[i] <= 1'b0;
                end
                st <= S_P3;
                ic <= 11'd0;
                ac <= 11'd0;
            end
            // ---- write the token log's step t + 1, then the advanced seeds ----
            if (act && st == S_WR) begin
                wc <= wc + 2'd1;
                if (!wc[1]) begin
                    aw_v <= 1'b1;
                    aw_a <= {7'd0, t1, 1'b0} + {16'd0, wc[0]};
                    aw_d <= tokw;
                end
                if (smp) begin
                    bw_v <= 1'b1;
                    bw_a <= rc + {14'd0, wc};
                    bw_d <= state[{wc, 6'd0} +: 64];
                end
                if (wc == (smp ? 2'd3 : 2'd1)) begin
                    fin <= 1'b1;
                    act <= 1'b0;
                end
            end
        end
    end

    wire unused = &{1'b0, ra[16], hs[2]};

endmodule
