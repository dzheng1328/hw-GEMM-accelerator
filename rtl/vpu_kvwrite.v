`timescale 1ns / 1ps

// rtl/vpu_kvwrite.v -- the vector unit's KVWRITE (milestone 4.3e): position T
// of every story's, layer's and KV head's K and V caches (compiler/
// golden_vop.py kvwrite):
//
//   ra = rotated k (int8 feature words, 32: feature f = 8 kvh + d, byte s)
//   rb = v (int8 feature words, 32)
//   rc = this layer's cache base (activation word); nest n = 4 s + kvh holds
//        K^T (256 words) then V (256 words) at rc + 512 n
//   t  = the position
//
//   K^T: word rc + 512 n + 32 d + (t >> 3), byte t & 7  <- k[s][8 kvh + d]
//   V:   word rc + 512 n + 256 + t,         byte d      <- v[s][8 kvh + d]
//
// K^T is a byte read-modify-write of 256 words: for each of the 32 features
// the k word is read, then the 8 stories' K^T words, and each arriving word
// has one byte replaced and is written back to its own address. V is whole
// words: 8 feature words (one KV head's dims) form an 8 x 8 byte matrix whose
// transpose is the 8 stories' V words, written after the block loads. All
// reads issue in one stream (k, then V rows), so the V block copies are 8
// cycles apart, as in rtl/vpu_transpose.v, and its drain never overlaps the
// K^T writes (those finish before the first V row arrives).
module vpu_kvwrite (
    input  wire        clk,
    input  wire        rst,
    input  wire        kill,
    input  wire        go,
    input  wire [16:0] ra,
    input  wire [16:0] rb,
    input  wire [16:0] rc,
    input  wire [7:0]  t,
    output reg         ar_v,
    output reg  [16:0] ar_a,
    output reg  [15:0] rq_i,
    input  wire        dv,
    input  wire [15:0] di,
    input  wire [63:0] dw,
    output reg         aw_v,
    output reg  [16:0] aw_a,
    output reg  [63:0] aw_d,
    output reg         fin
);

    localparam [15:0] K_KWORD = 16'd0, K_RMW = 16'd1, K_VROW = 16'd2;

    reg         act;
    reg  [4:0]  kf;            // k feature being issued
    reg  [3:0]  ks;            // 0: the k word, 1..8: the RMW read of story ks - 1
    reg         vph;           // issuing V rows
    reg  [5:0]  vi;            // V rows issued, 0..32
    reg  [63:0] kreg;          // the k word of the feature being finished
    reg  [4:0]  cf;            // feature being finished
    reg  [2:0]  cs;            // story whose word arrives next
    reg  [63:0] vblk [0:6];
    reg  [2:0]  vc;            // V row of the arriving word
    reg  [1:0]  vb;            // V block copied so far
    reg  [63:0] vout [0:7];
    reg         drain;
    reg  [2:0]  dc;
    reg  [1:0]  dq;            // the block being written

    wire [4:0] tq = t[7:3];

    // Word of K^T for story s of feature f: rc + 512 (4 s + kvh) + 32 d + t / 8.
    function [16:0] kt_addr(input [2:0] s, input [4:0] f);
        kt_addr = rc + {3'd0, s, f[4:3], 9'd0} + {9'd0, f[2:0], 5'd0} + {12'd0, tq};
    endfunction

    // Byte s of the k word replaces byte t & 7 of the arriving word.
    wire [2:0]  tb      = t[2:0];
    wire [7:0]  newbyte = kreg[{cs, 3'd0} +: 8];
    wire [63:0] rmw     = (dw & ~(64'hFF << {tb, 3'd0})) | ({56'd0, newbyte} << {tb, 3'd0});

    function [63:0] column(input [2:0] c, input [63:0] r0, input [63:0] r1, input [63:0] r2, input [63:0] r3,
                           input [63:0] r4, input [63:0] r5, input [63:0] r6, input [63:0] r7);
        column = {r7[8*c +: 8], r6[8*c +: 8], r5[8*c +: 8], r4[8*c +: 8],
                  r3[8*c +: 8], r2[8*c +: 8], r1[8*c +: 8], r0[8*c +: 8]};
    endfunction

    integer i;
    always @(posedge clk) begin
        ar_v <= 1'b0;
        aw_v <= 1'b0;
        fin  <= 1'b0;
        rq_i <= 16'd0;
        if (rst || kill) begin
            act   <= 1'b0;
            drain <= 1'b0;
        end else begin
            if (go) begin
                act <= 1'b1;
                kf  <= 5'd0;
                ks  <= 4'd0;
                vph <= 1'b0;
                vi  <= 6'd0;
                cf  <= 5'd0;
                cs  <= 3'd0;
                vc  <= 3'd0;
                vb  <= 2'd0;
            end
            // ---- issue: for each k feature its word then 8 RMW reads; then 32 V rows ----
            if (act && !vph) begin
                ar_v <= 1'b1;
                if (ks == 4'd0) begin
                    ar_a <= ra + {12'd0, kf};
                    rq_i <= K_KWORD;
                end else begin
                    ar_a <= kt_addr(ks[2:0] - 3'd1, kf);
                    rq_i <= K_RMW;
                end
                if (ks == 4'd8) begin
                    ks <= 4'd0;
                    kf <= kf + 5'd1;
                    if (kf == 5'd31) vph <= 1'b1;
                end else begin
                    ks <= ks + 4'd1;
                end
            end else if (act && vph && vi != 6'd32) begin
                ar_v <= 1'b1;
                ar_a <= rb + {11'd0, vi};
                rq_i <= K_VROW;
                vi   <= vi + 6'd1;
            end
            // ---- the V block drain (first, so a same-cycle copy's drain <= 1 wins) ----
            if (drain) begin
                aw_v <= 1'b1;
                aw_a <= rc + {3'd0, dc, dq, 9'd0} + 17'd256 + {9'd0, t};
                aw_d <= vout[dc];
                dc   <= dc + 3'd1;
                if (dc == 3'd7) begin
                    drain <= 1'b0;
                    if (dq == 2'd3) begin
                        fin <= 1'b1;
                        act <= 1'b0;
                    end
                end
            end
            // ---- arrivals ----
            if (act && dv) begin
                case (di)
                    K_KWORD: kreg <= dw;
                    K_RMW: begin
                        aw_v <= 1'b1;
                        aw_a <= kt_addr(cs, cf);
                        aw_d <= rmw;
                        cs   <= cs + 3'd1;
                        if (cs == 3'd7) cf <= cf + 5'd1;
                    end
                    default: begin   // K_VROW
                        if (vc != 3'd7) begin
                            vblk[vc] <= dw;
                        end else begin
                            for (i = 0; i < 8; i = i + 1)
                                vout[i] <= column(i[2:0], vblk[0], vblk[1], vblk[2], vblk[3], vblk[4], vblk[5], vblk[6], dw);
                            drain <= 1'b1;
                            dc    <= 3'd0;
                            dq    <= vb;
                            vb    <= vb + 2'd1;
                        end
                        vc <= vc + 3'd1;
                    end
                endcase
            end
        end
    end

endmodule
