`timescale 1ns / 1ps

// rtl/vpu_transpose.v -- a placeholder: the real sub-op replaces this file in its task of the 4.3e plan.
// It issues no request and never finishes.
module vpu_transpose (
    input  wire       clk,
    input  wire       rst,
    input  wire       kill,
    input  wire       go,
    input  wire [16:0] ra,
    input  wire [16:0] rb,
    input  wire [16:0] rc,
    output wire       ar_v,
    output wire [16:0] ar_a,
    input  wire       dv,
    input  wire [63:0] dw,
    output wire       aw_v,
    output wire [16:0] aw_a,
    output wire [63:0] aw_d,
    output wire       fin
);
    assign ar_v = {1{1'b0}};
    assign ar_a = {17{1'b0}};
    assign aw_v = {1{1'b0}};
    assign aw_a = {17{1'b0}};
    assign aw_d = {64{1'b0}};
    assign fin = {1{1'b0}};
    wire unused = &{1'b0, clk, rst, kill, go, ra, rb, rc, dv, dw};
endmodule
