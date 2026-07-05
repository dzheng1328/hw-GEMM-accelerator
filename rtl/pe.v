`timescale 1ns / 1ps

// rtl/pe.v -- Single multiply-accumulate (MAC) processing element.
// Fundamental building block of the Phase 1 8x8 systolic array tile.
// Reset is synchronous and active-high.
//
// a_out/b_out are registered one-cycle pass-through copies of a_in/b_in,
// forwarded to the east/south neighbor in the array. They update every
// non-reset cycle unconditionally (not gated by valid_in) so the array's
// skewed zero-padding keeps propagating even if valid_in is ever paused.
module pe (
    input  wire                clk,
    input  wire                reset,     // sync, active-high
    input  wire                valid_in,  // accumulate this cycle when high
    input  wire signed [7:0]   a_in,
    input  wire signed [7:0]   b_in,
    output reg  signed [31:0]  acc_out,
    output reg  signed [7:0]   a_out,     // registered forward to east neighbor
    output reg  signed [7:0]   b_out      // registered forward to south neighbor
);

    always @(posedge clk) begin
        if (reset) begin
            acc_out <= 32'sd0;
            a_out   <= 8'sd0;
            b_out   <= 8'sd0;
        end else begin
            a_out <= a_in;
            b_out <= b_in;
            if (valid_in) begin
                acc_out <= acc_out + (a_in * b_in);
            end
        end
    end

endmodule
