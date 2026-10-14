`timescale 1ns / 1ps

// rtl/vpu_add.v -- the vector unit's ADD (milestone 4.3e): the residual
// stream plus a RESULT16 buffer, saturated to int16 (compiler/golden_vop.py
// add):
//
//   ra = residual (int16 feature words, 64 features = 128 words, updated in
//        place), rb = the buffer of the same shape
//
// Each output word needs one word of each, so the issue stream alternates
// residual and buffer reads (256 reads, one per cycle) and the sum is written
// when the buffer word arrives. Ports are the uniform sub-op bundle of
// rtl/vpu.v: registered read and write requests, a read-data tag that
// returns each request's data the cycle after it is visible, and `fin` high with the last write
// request; all outputs are low when idle.
module vpu_add (
    input  wire        clk,
    input  wire        rst,
    input  wire        kill,
    input  wire        go,
    input  wire [16:0] ra,
    input  wire [16:0] rb,
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
    reg  [8:0]  ic;         // reads issued, 0..256
    reg  [7:0]  cw;         // words consumed (the output word index on a buffer arrival)
    reg  [63:0] hold;       // the residual word waiting for its buffer word

    // Four int16 lanes of a saturating add.
    wire [63:0] sum;
    genvar l;
    generate
        for (l = 0; l < 4; l = l + 1) begin : g_lane
            wire signed [16:0] s = $signed(hold[16*l +: 16]) + $signed(dw[16*l +: 16]);
            assign sum[16*l +: 16] = (s > 17'sd32767) ? 16'h7FFF : (s < -17'sd32768) ? 16'h8000 : s[15:0];
        end
    endgenerate

    always @(posedge clk) begin
        ar_v  <= 1'b0;
        aw_v  <= 1'b0;
        fin   <= 1'b0;
        if (rst || kill) begin
            act <= 1'b0;
        end else begin
            if (go) begin
                act <= 1'b1;
                ic  <= 9'd0;
                cw  <= 8'd0;
            end
            if (act && ic != 9'd256) begin
                ar_v <= 1'b1;
                ar_a <= (ic[0] ? rb : ra) + {9'd0, ic[8:1]};
                ic   <= ic + 9'd1;
            end
            if (act && dv) begin
                if (cw[0]) begin
                    aw_v <= 1'b1;
                    aw_a <= ra + {10'd0, cw[7:1]};
                    aw_d <= sum;
                    if (cw == 8'd255) begin
                        fin <= 1'b1;
                        act <= 1'b0;
                    end
                end else begin
                    hold <= dw;
                end
                cw <= cw + 8'd1;
            end
        end
    end

endmodule
