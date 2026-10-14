`timescale 1ns / 1ps

// rtl/vpu_rope.v -- the vector unit's ROPE (milestone 4.3e): rotary position
// embedding of q and k at position T (model/fixedpoint.py rope_q;
// compiler/golden_vop.py rope):
//
//   ra = q (int8 feature words, 64: byte s is story s)
//   rb = k (int8 feature words, 32), rotated in place
//   rc = the rotated-q destination (A word, 256: the q scratch of the 32
//        nests; nest 4 s + kvh holds one word per dim d, byte i = query head
//        2 kvh + i, bytes 2-7 zero)
//   t  = the position; its cos and sin are A words 2t and 2t + 1 (4 int16
//        lanes, one per frequency), so the table is at A word 0
//
//   y0 = clip(rs(x0 c - x1 s, 14)),  y1 = clip(rs(x0 s + x1 c, 14))
//
// A pair of features (2p, 2p + 1) arrives as two words (even, odd) and is
// rotated for the 8 stories at once by 8 rounding-shift lanes, y0 one cycle,
// y1 the next. Pairs are issued every 3 cycles so the next pair's even word
// cannot overwrite x0 before y1 has used it. k's 16 pairs are written back
// directly. q's 32 pairs go through `yq`, one kv-head group (8 pairs, 16
// feature words) at a time, and are then written out as 64 transposed words:
// story s, dim d takes feature d's byte s and feature 8 + d's byte s. The
// next group's issue waits for the drain, which reuses `yq`.
module vpu_rope (
    input  wire        clk,
    input  wire        rst,
    input  wire        kill,
    input  wire        go,
    input  wire [16:0] ra,
    input  wire [16:0] rb,
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
    output reg         aw_v,
    output reg  [16:0] aw_a,
    output reg  [63:0] aw_d,
    output reg         bw_v,
    output reg  [15:0] bw_a,
    output reg  [63:0] bw_d,
    output reg         fin
);

    localparam [15:0] K_COS = 16'd0, K_SIN = 16'd1, K_EVEN = 16'd2, K_ODD = 16'd3;

    reg         act;
    reg  [1:0]  ts;            // table words issued
    reg  [5:0]  jp;            // pairs issued, 0..48 (0-15 k, 16-47 q)
    reg  [1:0]  sl;            // slot within the pair: even, odd, idle
    reg         hold;          // issue paused for a q group's drain
    reg  [63:0] cosw, sinw;
    reg  [63:0] x0, x1;
    reg  [5:0]  ja;            // pairs whose odd word has arrived
    reg  [5:0]  cj;            // the pair held in x0, x1
    reg         cmp0, cmp1;    // computing y0, y1
    reg  [63:0] yq [0:15];
    reg         drain;
    reg  [5:0]  dn;
    reg  [1:0]  dg;

    // ---- the rotation of the pair in x0, x1 ----
    wire [1:0] fr = cj[1:0];   // frequency: the pair's index within its head
    wire signed [15:0] c  = cosw[16*fr +: 16];
    wire signed [15:0] sn = sinw[16*fr +: 16];
    wire [255:0] accs;
    wire [63:0]  q;
    genvar l;
    generate
        for (l = 0; l < 8; l = l + 1) begin : g_lane
            wire signed [7:0] a = x0[8*l +: 8];
            wire signed [7:0] b = x1[8*l +: 8];
            wire signed [31:0] y0 = a * c - b * sn;
            wire signed [31:0] y1 = a * sn + b * c;
            assign accs[32*l +: 32] = cmp1 ? y1 : y0;
        end
    endgenerate
    vpu_lanes #(.LANES(8), .QW(8)) lanes (.acc(accs), .m({8{16'd1}}), .sh({8{6'd14}}), .q(q));

    // ---- the drain's word: byte s of feature d and of feature 8 + d ----
    wire [2:0] ds = dn[5:3];
    wire [2:0] dd = dn[2:0];
    wire [63:0] f0 = yq[{1'b0, dd}];
    wire [63:0] f1 = yq[{1'b1, dd}];
    wire [7:0]  b0 = f0[{ds, 3'd0} +: 8];
    wire [7:0]  b1 = f1[{ds, 3'd0} +: 8];

    // The pair being issued: k pairs at rb, q pairs (jp - 16) at ra.
    wire        isq = (jp >= 6'd16);
    wire [5:0]  pp  = isq ? (jp - 6'd16) : jp;
    wire [16:0] pa  = (isq ? ra : rb) + {10'd0, pp, 1'b0} + {16'd0, sl[0]};
    wire        qlast = isq && (pp[2:0] == 3'd7);

    always @(posedge clk) begin
        ar_v <= 1'b0;
        br_v <= 1'b0;
        aw_v <= 1'b0;
        bw_v <= 1'b0;
        fin  <= 1'b0;
        rq_i <= 16'd0;
        cmp0 <= 1'b0;
        cmp1 <= cmp0;
        if (rst || kill) begin
            act   <= 1'b0;
            drain <= 1'b0;
            cmp0  <= 1'b0;
            cmp1  <= 1'b0;
        end else begin
            if (go) begin
                act  <= 1'b1;
                ts   <= 2'd0;
                jp   <= 6'd0;
                sl   <= 2'd0;
                hold <= 1'b0;
                ja   <= 6'd0;
            end
            // ---- issue ----
            if (act && ts != 2'd2) begin
                br_v <= 1'b1;
                br_a <= {7'd0, t, 1'b0} + {15'd0, ts[0]};
                rq_i <= {14'd0, ts};
                ts   <= ts + 2'd1;
            end else if (act && !hold && jp != 6'd48) begin
                if (sl != 2'd2) begin
                    ar_v <= 1'b1;
                    ar_a <= pa;
                    rq_i <= sl[0] ? K_ODD : K_EVEN;
                end
                if (sl == 2'd2) begin
                    sl <= 2'd0;
                    jp <= jp + 6'd1;
                    if (qlast) hold <= 1'b1;
                end else begin
                    sl <= sl + 2'd1;
                end
            end
            // ---- arrivals ----
            if (act && dv) begin
                case (di)
                    K_COS:  cosw <= dw;
                    K_SIN:  sinw <= dw;
                    K_EVEN: x0 <= dw;
                    default: begin
                        x1   <= dw;
                        cj   <= ja;
                        ja   <= ja + 6'd1;
                        cmp0 <= 1'b1;
                    end
                endcase
            end
            // ---- the rotated words ----
            if (cmp0 || cmp1) begin
                if (cj < 6'd16) begin
                    aw_v <= 1'b1;
                    aw_a <= rb + {12'd0, cj[3:0], 1'b0} + {16'd0, cmp1};
                    aw_d <= q;
                end else begin
                    yq[{cj[2:0], cmp1}] <= q;
                    if (cmp1 && cj[2:0] == 3'd7) begin
                        drain <= 1'b1;
                        dn    <= 6'd0;
                        dg    <= cj[4:3] - 2'd2;
                    end
                end
            end
            // ---- the q scratch of one group: nest 4 s + g, dim d ----
            if (drain) begin
                bw_v <= 1'b1;
                bw_a <= rc + {8'd0, ds, dg, dd};
                bw_d <= {48'd0, b1, b0};
                dn   <= dn + 6'd1;
                if (dn == 6'd63) begin
                    drain <= 1'b0;
                    hold  <= 1'b0;
                    if (dg == 2'd3) begin
                        fin <= 1'b1;
                        act <= 1'b0;
                    end
                end
            end
        end
    end


endmodule
