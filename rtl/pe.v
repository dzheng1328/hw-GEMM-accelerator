`timescale 1ns / 1ps

// rtl/pe.v -- Single multiply-accumulate (MAC) processing element.
// Fundamental building block of the Phase 1 8x8 systolic array tile.
// Reset is synchronous and active-high.
//
// The MAC datapath is 2-cycle pipelined (ACC_LATENCY = 2 below): a
// valid_in=1 cycle's product lands in acc_out 2 cycles later, not 1.
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

    // ACC_LATENCY = 2: a valid_in=1 cycle's product lands in acc_out 2 cycles
    // later (1 cycle to register the multiply, 1 more to add it in). Forwarding
    // (a_out/b_out) stays a separate, unconditional 1-cycle passthrough --
    // independent of accumulate latency, so the array's skew geometry is
    // unaffected by this change. See docs/superpowers/specs/2026-08-27-pipeline-pe-mac-design.md.
    //
    // Named as a real Verilog constant (not just this comment) so it's
    // findable at its source. Every site that must stay in sync with this
    // value if pe.v's pipeline ever changes: rtl/gemm_sequencer.v's
    // PE_ACC_LATENCY default, rtl/gemm_tile.v's PE_ACC_LATENCY default, and
    // rtl/noc_node.v's PE_ACC_LATENCY default (threaded into its gemm_tile
    // instantiation).
    localparam ACC_LATENCY = 2;

    reg signed [15:0] prod_reg;
    reg               pipe_valid;

    always @(posedge clk) begin
        if (reset) begin
            a_out <= 8'sd0;
            b_out <= 8'sd0;
        end else begin
            a_out <= a_in;
            b_out <= b_in;
        end
    end

    always @(posedge clk) begin
        if (reset) begin
            prod_reg   <= 16'sd0;
            pipe_valid <= 1'b0;
        end else begin
            prod_reg   <= a_in * b_in;
            pipe_valid <= valid_in;
        end
    end

    always @(posedge clk) begin
        if (reset) begin
            acc_out <= 32'sd0;
        end else if (pipe_valid) begin
            acc_out <= acc_out + prod_reg;
        end
    end

endmodule
