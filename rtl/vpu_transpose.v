`timescale 1ns / 1ps

// rtl/vpu_transpose.v -- the vector unit's TRANSPOSE (milestone 4.3e): each
// 8-word block of activation memory is an 8 x 8 byte matrix (word r, byte c),
// transposed in place of the destination (compiler/golden_vop.py transpose):
//
//   ra = source, rb = destination (activation words), rc = block count
//
// A block is read in 8 cycles into `blk`, copied whole into `out` on the 8th
// arrival, and written out over the next 8 cycles while the next block loads.
// Reads issue back to back, so successive copies are 8 cycles apart and a
// drain (8 writes, first one cycle after the copy) has always finished
// reading `out` by the time the next copy overwrites it.
module vpu_transpose (
    input  wire        clk,
    input  wire        rst,
    input  wire        kill,
    input  wire        go,
    input  wire [16:0] ra,
    input  wire [16:0] rb,
    input  wire [16:0] rc,
    output reg         ar_v,
    output reg  [16:0] ar_a,
    input  wire        dv,
    input  wire [63:0] dw,
    output reg         aw_v,
    output reg  [16:0] aw_a,
    output reg  [63:0] aw_d,
    output reg         fin
);

    reg         act;
    reg  [19:0] ic;          // words issued
    reg  [19:0] nwords;      // 8 * count
    reg  [2:0]  cr;          // row of the arriving word
    reg  [16:0] cb;          // blocks copied so far
    reg  [63:0] blk [0:6];   // rows 0..6 of the block being loaded (row 7 is the arriving word)
    reg  [63:0] out [0:7];   // the transposed block being written
    reg         drain;
    reg  [2:0]  dc;
    reg  [13:0] db;          // the block being written
    reg         last;        // the block being written is the last

    // Byte c of source row r becomes byte r of output row c.
    wire [63:0] row7 = dw;
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
        if (rst || kill) begin
            act   <= 1'b0;
            drain <= 1'b0;
        end else begin
            if (go) begin
                nwords <= {rc, 3'd0};
                ic     <= 20'd0;
                cr     <= 3'd0;
                cb     <= 17'd0;
                if (rc == 17'd0) begin
                    fin <= 1'b1;
                end else begin
                    act <= 1'b1;
                end
            end
            if (act && ic != nwords) begin
                ar_v <= 1'b1;
                ar_a <= ra + ic[16:0];
                ic   <= ic + 20'd1;
            end
            // The drain comes first: when the next copy lands in the cycle of
            // the drain's last write, the copy's drain <= 1 must win.
            if (drain) begin
                aw_v <= 1'b1;
                aw_a <= rb + {db, dc};
                aw_d <= out[dc];
                dc   <= dc + 3'd1;
                if (dc == 3'd7) begin
                    drain <= 1'b0;
                    if (last) begin
                        fin <= 1'b1;
                        act <= 1'b0;
                    end
                end
            end
            if (act && dv) begin
                if (cr != 3'd7) begin
                    blk[cr] <= dw;
                end else begin
                    for (i = 0; i < 8; i = i + 1)
                        out[i] <= column(i[2:0], blk[0], blk[1], blk[2], blk[3], blk[4], blk[5], blk[6], row7);
                    drain <= 1'b1;
                    dc    <= 3'd0;
                    db    <= cb[13:0];
                    last  <= ({cb, 3'd0} + 20'd8 == nwords);
                    cb    <= cb + 17'd1;
                end
                cr <= cr + 3'd1;
            end
        end
    end

endmodule
