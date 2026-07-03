`timescale 1ns / 1ps

// rtl/pe.v -- Single multiply-accumulate (MAC) processing element.
// Fundamental building block of the Phase 1 8x8 systolic array tile.
// Reset is synchronous and active-high.
module pe (
    input  wire                clk,
    input  wire                reset,     // sync, active-high
    input  wire                valid_in,  // accumulate this cycle when high
    input  wire signed [7:0]   a_in,
    input  wire signed [7:0]   b_in,
    output reg  signed [31:0]  acc_out
);

    always @(posedge clk) begin
        if (reset) begin
            acc_out <= 32'sd0;
        end else if (valid_in) begin
            acc_out <= acc_out + (a_in * b_in);
        end
    end

endmodule
