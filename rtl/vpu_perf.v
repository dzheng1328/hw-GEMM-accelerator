`timescale 1ns / 1ps

// rtl/vpu_perf.v -- the vector unit's performance counters (milestone 4.3e),
// in rtl/cmd_perf.v's style: free-running 32-bit counters cleared only by
// reset, read by hierarchy from cocotb and measured by snapshot and
// subtraction. cnt[i] counts the cycles `busy` was high for sub-op i
// (1 EMBED .. 9 SAMPLE, as compiler/isa.py numbers them); cnt[0] counts every
// busy cycle, so cnt[0] is the sum of the other nine.
module vpu_perf (
    input wire       clk,
    input wire       rst,
    input wire       busy,
    input wire [3:0] sub
);

    reg [31:0] cnt [0:9];

    integer i;
    always @(posedge clk) begin
        if (rst) begin
            for (i = 0; i < 10; i = i + 1) cnt[i] <= 32'd0;
        end else if (busy) begin
            cnt[0] <= cnt[0] + 32'd1;
            if (sub >= 4'd1 && sub <= 4'd9)
                cnt[sub] <= cnt[sub] + 32'd1;
        end
    end

endmodule
