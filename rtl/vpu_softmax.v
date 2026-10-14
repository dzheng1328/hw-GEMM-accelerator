`timescale 1ns / 1ps

// rtl/vpu_softmax.v -- the vector unit's SOFTMAX (milestone 4.3e): attention
// probabilities from RESULT16 scores (model/fixedpoint.py softmax_q;
// compiler/golden_vop.py softmax):
//
//   ra = scores (activation words): nest n (32 of them) at 128 n, row i (the
//        2 query heads of a KV head) at +64 i, position p at lane p & 3 of
//        word p >> 2 (int16)
//   rb = probabilities (A word): nest n at 256 n, word p holds head 0's
//        probability in byte 0 and head 1's in byte 1, zero past position t
//        up to the next multiple of 8
//   rc = parameter word (A word): the exponent's m [15:0], sh [21:16]
//   t  = the position; positions 0..t attend
//
// Per nest and head, with W = 2 (t / 8 + 1) words per row:
//   pass 1  max over the valid positions                      2 W reads
//   pass 2  S = sum of e = exp(max - x), 4 exp lanes          2 W reads
//   recip   (r, k) = recip(S), the shared unit, 2 cycles
//   pass 3  p = min(127, round(e 127 r >> (15 + k))) for the 4 positions of
//           each word, exp recomputed; row 0's word then row 1's word of a
//           group give 4 positions' two heads, written as 4 words
//           (one per cycle); a group is issued every 4 cycles, so the 4
//           writes of one group are done as the next group's data lands
// Positions past t contribute e = 0 and so come out 0.
module vpu_softmax (
    input  wire        clk,
    input  wire        rst,
    input  wire        kill,
    input  wire        go,
    input  wire [16:0] ra,
    input  wire [15:0] rb,
    input  wire [15:0] rc,
    input  wire [7:0]  t,
    output reg         ar_v,
    output reg  [16:0] ar_a,
    output reg         br_v,
    output reg  [15:0] br_a,
    output reg  [15:0] rq_i,
    input  wire        dv,
    input  wire [15:0] di,
    input  wire [63:0] dw,
    output reg         bw_v,
    output reg  [15:0] bw_a,
    output reg  [63:0] bw_d,
    output reg         fin,
    output wire [39:0] ru_u,
    output wire        ru_recip,
    input  wire [15:0] ru_r,
    input  wire [5:0]  ru_k
);

    localparam [15:0] K_PARAM = 16'd0, K_DATA = 16'd1;
    localparam [2:0]  S_P1 = 3'd0, S_P2 = 3'd1, S_RC0 = 3'd2, S_RC1 = 3'd3, S_P3 = 3'd4;

    reg         act;
    reg  [2:0]  st;
    reg         sent;
    reg  [4:0]  nest;
    reg  [7:0]  ic;            // reads issued in this pass
    reg  [1:0]  pc;            // pass 3 pacing
    reg  [7:0]  ac;            // words arrived in this pass
    reg  [15:0] m;
    reg  [5:0]  sh;
    reg  signed [15:0] mx [0:1];
    reg  [25:0] ssum [0:1];
    reg  [15:0] rr [0:1];
    reg  [5:0]  kk [0:1];
    reg  [31:0] pq0;           // row 0's 4 probabilities of the group
    reg  [63:0] wb;            // the group's 4 words, 16 bits each (head 1 high byte)
    reg         wv;
    reg  [1:0]  wl;
    reg  [5:0]  wgq;
    reg         wlast;         // the group being written is the nest's last

    // ---- geometry ----
    wire [7:0] twoW = {{1'b0, t[7:3]} + 6'd1, 2'b00};   // reads per pass: 2 rows x W words
    wire [6:0] W    = {{1'b0, t[7:3]} + 6'd1, 1'b0};
    wire       pass3 = (st == S_P3);
    wire       row_a = pass3 ? ac[0] : (ac >= {1'b0, W});
    wire [5:0] q_a   = pass3 ? ac[6:1] : (row_a ? 6'(ac - {1'b0, W}) : ac[5:0]);
    wire       row_i = pass3 ? ic[0] : (ic >= {1'b0, W});
    wire [5:0] q_i   = pass3 ? ic[6:1] : (row_i ? 6'(ic - {1'b0, W}) : ic[5:0]);
    wire       last_a = (ac == twoW - 8'd1);

    // ---- the 4 lanes of the arriving word ----
    wire [3:0]  valid;
    wire signed [15:0] s [0:3];
    wire [16:0] e [0:3];
    wire [16:0] em [0:3];
    wire signed [15:0] mxr = row_a ? mx[1] : mx[0];
    genvar l;
    generate
        for (l = 0; l < 4; l = l + 1) begin : g_lane
            assign s[l]     = dw[16*l +: 16];
            assign valid[l] = ({q_a, 2'd0} + l[7:0]) <= t;
            wire [15:0] d   = 16'(mxr - s[l]);
            wire [47:0] z;
            vpu_exparg arg (.d(d), .m(m), .sh(sh), .inv(16'd256), .z(z));
            vpu_exp    ex  (.z(z), .e(e[l]));
            assign em[l] = valid[l] ? e[l] : 17'd0;
        end
    endgenerate

    // pass 1: the largest valid score of the word
    reg signed [15:0] wmax;
    integer j;
    always @* begin
        wmax = 16'sh8000;
        for (j = 0; j < 4; j = j + 1)
            if (valid[j] && s[j] > wmax) wmax = s[j];
    end

    // pass 2: the word's sum of exp values
    wire [18:0] esum = {2'd0, em[0]} + {2'd0, em[1]} + {2'd0, em[2]} + {2'd0, em[3]};

    // pass 3: the 4 probabilities, e * 127 rounded by the reciprocal
    wire [127:0] accs;
    wire [63:0]  ms;
    wire [23:0]  shs;
    wire [31:0]  q;
    wire [15:0]  rsel = row_a ? rr[1] : rr[0];
    wire [5:0]   ksel = row_a ? kk[1] : kk[0];
    generate
        for (l = 0; l < 4; l = l + 1) begin : g_prob
            assign accs[32*l +: 32] = {8'd0, em[l], 7'd0} - {15'd0, em[l]};   // e * 127
            assign ms[16*l +: 16]   = rsel;
            assign shs[6*l +: 6]    = 6'd15 + ksel;
        end
    endgenerate
    vpu_lanes #(.LANES(4), .QW(8)) lanes (.acc(accs), .m(ms), .sh(shs), .q(q));

    // ---- the shared reciprocal ----
    assign ru_recip = (st == S_RC0 || st == S_RC1) && act;
    assign ru_u     = (st == S_RC0 && act) ? {14'd0, ssum[0]} : (st == S_RC1 && act) ? {14'd0, ssum[1]} : 40'd0;

    wire [63:0] wbn = {q[31:24], pq0[31:24], q[23:16], pq0[23:16], q[15:8], pq0[15:8], q[7:0], pq0[7:0]};

    always @(posedge clk) begin
        ar_v <= 1'b0;
        br_v <= 1'b0;
        bw_v <= 1'b0;
        fin  <= 1'b0;
        rq_i <= 16'd0;
        if (rst || kill) begin
            act <= 1'b0;
            wv  <= 1'b0;
        end else begin
            if (go) begin
                act     <= 1'b1;
                st      <= S_P1;
                sent    <= 1'b0;
                nest    <= 5'd0;
                ic      <= 8'd0;
                ac      <= 8'd0;
                pc      <= 2'd0;
                mx[0]   <= 16'sh8000;
                mx[1]   <= 16'sh8000;
                ssum[0] <= 26'd0;
                ssum[1] <= 26'd0;
            end
            // ---- issue ----
            if (act && !sent) begin
                br_v <= 1'b1;
                br_a <= rc;
                rq_i <= K_PARAM;
                sent <= 1'b1;
            end else if (act && (st == S_P1 || st == S_P2) && ic != twoW) begin
                ar_v <= 1'b1;
                ar_a <= ra + {5'd0, nest, 7'd0} + {10'd0, row_i, 6'd0} + {11'd0, q_i};
                rq_i <= K_DATA;
                ic   <= ic + 8'd1;
            end else if (act && pass3 && ic != twoW) begin
                pc <= pc + 2'd1;
                if (!pc[1]) begin
                    ar_v <= 1'b1;
                    ar_a <= ra + {5'd0, nest, 7'd0} + {10'd0, row_i, 6'd0} + {11'd0, q_i};
                    rq_i <= K_DATA;
                    ic   <= ic + 8'd1;
                end
            end
            // ---- the group's writes (before the arrivals, whose wv <= 1 must win a tie) ----
            if (wv) begin
                bw_v <= 1'b1;
                bw_a <= rb + {3'd0, nest, 8'd0} + {8'd0, wgq, 2'd0} + {14'd0, wl};
                bw_d <= {48'd0, wb[16*wl +: 16]};
                wl   <= wl + 2'd1;
                if (wl == 2'd3) begin
                    wv <= 1'b0;
                    if (wlast) begin
                        if (nest == 5'd31) begin
                            fin <= 1'b1;
                            act <= 1'b0;
                        end else begin
                            nest    <= nest + 5'd1;
                            st      <= S_P1;
                            ic      <= 8'd0;
                            ac      <= 8'd0;
                            mx[0]   <= 16'sh8000;
                            mx[1]   <= 16'sh8000;
                            ssum[0] <= 26'd0;
                            ssum[1] <= 26'd0;
                        end
                    end
                end
            end
            // ---- arrivals ----
            if (act && dv) begin
                if (di == K_PARAM) begin
                    m  <= dw[15:0];
                    sh <= dw[21:16];
                end else begin
                    ac <= ac + 8'd1;
                    case (st)
                        S_P1: begin
                            if (wmax > mxr) mx[row_a] <= wmax;
                            if (last_a) begin st <= S_P2; ic <= 8'd0; ac <= 8'd0; end
                        end
                        S_P2: begin
                            ssum[row_a] <= ssum[row_a] + {7'd0, esum};
                            if (last_a) begin st <= S_RC0; end
                        end
                        default: begin   // S_P3
                            if (!row_a) begin
                                pq0 <= q;
                            end else begin
                                wb    <= wbn;
                                wv    <= 1'b1;
                                wl    <= 2'd0;
                                wgq   <= q_a;
                                wlast <= last_a;
                            end
                        end
                    endcase
                end
            end
            // ---- the two reciprocals ----
            if (act && st == S_RC0) begin
                rr[0] <= ru_r;
                kk[0] <= ru_k;
                st    <= S_RC1;
            end
            if (act && st == S_RC1) begin
                rr[1] <= ru_r;
                kk[1] <= ru_k;
                st    <= S_P3;
                ic    <= 8'd0;
                ac    <= 8'd0;
                pc    <= 2'd0;
            end
        end
    end

    wire unused = &{1'b0, ac[7], ic[7], W[0]};

endmodule
