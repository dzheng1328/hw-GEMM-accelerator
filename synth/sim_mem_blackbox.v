`timescale 1ns / 1ps

// synth/sim_mem_blackbox.v -- Yosys blackbox stub for rtl/sim_mem.v, the behavioral memory the
// accelerator uses for its program, weight and four activation memories (about 12.5 Mbit in all).
// Synthesis-only, never used in simulation. A flop-mapped copy of those memories would swamp the
// logic numbers, and a real chip would put them in SRAM macros or off chip, so each instance is an
// opaque cell here, exactly like synth/sram_blackbox.v. `stat` reports 0 area for them: the figure
// for accel.v is logic only, with no memory macros. Port list and parameters match rtl/sim_mem.v.
(* blackbox *)
module sim_mem #(
    parameter AW       = 15,
    parameter DW       = 64,
    parameter INIT_ARG = ""
) (
    input  wire          clk,
    input  wire          re,
    input  wire [AW-1:0] raddr,
    output wire [DW-1:0] rdata,
    input  wire          we,
    input  wire [AW-1:0] waddr,
    input  wire [DW-1:0] wdata
);
endmodule
