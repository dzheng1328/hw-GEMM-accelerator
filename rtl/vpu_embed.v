`timescale 1ns / 1ps

// rtl/vpu_embed.v -- the vector unit's EMBED (milestone 4.3e): each story's
// embedding row, scaled to the residual's int16 scale (compiler/golden_vop.py
// embed):
//
//   ra = embedding table (A word; token t's row is 8 words of 64 int8)
//   rb = residual (int16 feature words, 64 features = 128 words)
//   rc = parameter word (A word): m [15:0], sh [21:16]
//   t  = the step; the 8 stories' tokens are the token log's words 2t, 2t + 1
//        (int16 lanes), and one outside 0..511 is a fault
//
// First the parameter word and the two token words are read. Then, for each
// block of 8 features, one A word per story (8 reads, 8 bytes = 8 features
// each) fills an 8 x 8 byte matrix; it is copied to `out` and written as 16
// words (feature j, stories 0-3 then 4-7, int16) while the next block loads.
// The issue of a block waits for the previous block's copy, so `blk` is never
// overwritten early; the drain, not the loads, sets the pace.
module vpu_embed (
    input  wire        clk,
    input  wire        rst,
    input  wire        kill,
    input  wire        go,
    input  wire [15:0] ra,
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
    output reg         fin,
    output reg         flt
);

    // rq_i kinds
    localparam [15:0] K_PARAM = 16'd0, K_TOK0 = 16'd1, K_TOK1 = 16'd2, K_ROW = 16'd3;

    reg         act;
    reg  [1:0]  hs;           // header reads issued: param, token 0, token 1
    reg         rows;         // issuing table rows
    reg  [2:0]  lb;           // block being loaded
    reg  [3:0]  ic;           // rows of this block issued (0..8)
    reg  [15:0] m;
    reg  [5:0]  sh;
    reg  [15:0] tok [0:7];
    reg  [63:0] blk [0:7];    // story s's row word for the block being loaded
    reg  [3:0]  cr;           // rows of this block arrived
    reg         full;
    reg  [63:0] out [0:7];
    reg         drain;
    reg  [3:0]  dc;
    reg  [2:0]  db;

    // The 4 lanes of the word being written: feature j = dc >> 1, stories
    // 4 * (dc & 1) + 0..3, each an int8 widened to the lane's int32 accumulator.
    wire [3:0]  dj    = {1'b0, dc[3:1]};
    wire [63:0] ob0   = out[{dc[0], 2'd0}];
    wire [63:0] ob1   = out[{dc[0], 2'd1}];
    wire [63:0] ob2   = out[{dc[0], 2'd2}];
    wire [63:0] ob3   = out[{dc[0], 2'd3}];
    wire [127:0] acc4 = {{24{ob3[{dj[2:0], 3'd7}]}}, ob3[{dj[2:0], 3'd0} +: 8],
                         {24{ob2[{dj[2:0], 3'd7}]}}, ob2[{dj[2:0], 3'd0} +: 8],
                         {24{ob1[{dj[2:0], 3'd7}]}}, ob1[{dj[2:0], 3'd0} +: 8],
                         {24{ob0[{dj[2:0], 3'd7}]}}, ob0[{dj[2:0], 3'd0} +: 8]};
    wire [63:0] q16;
    vpu_lanes #(.LANES(4), .QW(16)) lanes (
        .acc(acc4), .m({4{m}}), .sh({4{sh}}), .q(q16));

    // The arriving token words are checked as they land (a story's token is
    // int16: negative or 512 and up is outside the vocabulary).
    // A token is valid when it is in 0..511: bits 15:9 of its int16 lane clear.
    wire bad_dw = |{dw[15:9], dw[31:25], dw[47:41], dw[63:57]};

    // Token of story s, selected for the row issue.
    wire [15:0] tk = tok[ic[2:0]];

    integer i;
    always @(posedge clk) begin
        ar_v <= 1'b0;
        br_v <= 1'b0;
        aw_v <= 1'b0;
        fin  <= 1'b0;
        flt  <= 1'b0;
        rq_i <= 16'd0;
        if (rst || kill) begin
            act   <= 1'b0;
            drain <= 1'b0;
        end else begin
            if (go) begin
                act  <= 1'b1;
                hs   <= 2'd0;
                rows <= 1'b0;
                lb   <= 3'd0;
                ic   <= 4'd0;
                cr   <= 4'd0;
                full <= 1'b0;
            end
            // ---- issue ----
            if (act && hs != 2'd3) begin
                hs <= hs + 2'd1;
                case (hs)
                    2'd0: begin br_v <= 1'b1; br_a <= rc; rq_i <= K_PARAM; end
                    2'd1: begin ar_v <= 1'b1; ar_a <= {8'd0, t, 1'b0}; rq_i <= K_TOK0; end
                    default: begin ar_v <= 1'b1; ar_a <= {8'd0, t, 1'b1}; rq_i <= K_TOK1; end
                endcase
            end
            if (act && rows && ic != 4'd8) begin
                br_v <= 1'b1;
                br_a <= ra + {4'd0, tk[8:0], 3'd0} + {13'd0, lb};
                rq_i <= K_ROW;
                ic   <= ic + 4'd1;
            end
            // ---- arrivals ----
            if (act && dv) begin
                case (di)
                    K_PARAM: begin m <= dw[15:0]; sh <= dw[21:16]; end
                    K_TOK0: begin
                        for (i = 0; i < 4; i = i + 1) tok[i] <= dw[16*i +: 16];
                        if (bad_dw) flt <= 1'b1;
                    end
                    K_TOK1: begin
                        for (i = 0; i < 4; i = i + 1) tok[4 + i] <= dw[16*i +: 16];
                        if (bad_dw) flt <= 1'b1;
                        rows <= 1'b1;
                    end
                    default: begin
                        blk[cr[2:0]] <= dw;
                        cr <= cr + 4'd1;
                        if (cr == 4'd7) full <= 1'b1;
                    end
                endcase
            end
            // ---- drain, then copy (the copy's drain <= 1 must win a same-cycle tie) ----
            if (drain) begin
                aw_v <= 1'b1;
                aw_a <= rb + {10'd0, db, dc};
                aw_d <= q16;
                dc   <= dc + 4'd1;
                if (dc == 4'd15) begin
                    drain <= 1'b0;
                    if (db == 3'd7) begin
                        fin <= 1'b1;
                        act <= 1'b0;
                    end
                end
            end
            if (full && !drain) begin
                for (i = 0; i < 8; i = i + 1) out[i] <= blk[i];
                full  <= 1'b0;
                cr    <= 4'd0;
                drain <= 1'b1;
                dc    <= 4'd0;
                db    <= lb;
                if (lb != 3'd7) begin
                    lb <= lb + 3'd1;
                    ic <= 4'd0;
                end
            end
        end
    end

    wire unused = &{1'b0, tk[15:9], dj[3]};

endmodule
