`timescale 1ns / 1ps

// rtl/vpu_rng.v -- the vector unit's 8 xorshift32 generators, one per story
// (milestone 4.3e). model/fixedpoint.py's xorshift32 is the definition:
//
//   x ^= x << 13;  x ^= x >> 17;  x ^= x << 5     (32 bits)
//
// `ld` loads one A-memory word of two states (state 2i in the low half, state
// 2i + 1 in the high half, i = ld_idx); `adv` advances all 8 states once.
module vpu_rng (
    input  wire         clk,
    input  wire         ld,
    input  wire [1:0]   ld_idx,
    input  wire [63:0]  ld_data,
    input  wire         adv,
    output wire [255:0] state
);

    reg [31:0] s [0:7];

    function [31:0] step(input [31:0] x);
        reg [31:0] a, b;
        begin
            a = x ^ (x << 13);
            b = a ^ (a >> 17);
            step = b ^ (b << 5);
        end
    endfunction

    genvar g;
    generate
        for (g = 0; g < 8; g = g + 1) begin : g_s
            assign state[g*32 +: 32] = s[g];
        end
    endgenerate

    integer i;
    always @(posedge clk) begin
        if (ld) begin
            s[{ld_idx, 1'b0}]       <= ld_data[31:0];
            s[{ld_idx, 1'b0} + 3'd1] <= ld_data[63:32];
        end
        if (adv)
            for (i = 0; i < 8; i = i + 1)
                s[i] <= step(s[i]);
    end

endmodule
