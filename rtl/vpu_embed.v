`timescale 1ns / 1ps

// rtl/vpu_embed.v -- a placeholder: the real sub-op replaces this file in its task of the 4.3e plan.
// It issues no request and never finishes.
module vpu_embed (
    input  wire       clk,
    input  wire       rst,
    input  wire       kill,
    input  wire       go,
    input  wire [15:0] ra,
    input  wire [16:0] rb,
    input  wire [15:0] rc,
    input  wire [7:0] t,
    output wire       ar_v,
    output wire [16:0] ar_a,
    output wire       br_v,
    output wire [15:0] br_a,
    output wire [15:0] rq_i,
    input  wire       dv,
    input  wire [15:0] di,
    input  wire [63:0] dw,
    output wire       aw_v,
    output wire [16:0] aw_a,
    output wire [63:0] aw_d,
    output wire       fin,
    output wire       flt
);
    assign ar_v = {1{1'b0}};
    assign ar_a = {17{1'b0}};
    assign br_v = {1{1'b0}};
    assign br_a = {16{1'b0}};
    assign rq_i = {16{1'b0}};
    assign aw_v = {1{1'b0}};
    assign aw_a = {17{1'b0}};
    assign aw_d = {64{1'b0}};
    assign fin = {1{1'b0}};
    assign flt = {1{1'b0}};
    wire unused = &{1'b0, clk, rst, kill, go, ra, rb, rc, t, dv, di, dw};
endmodule
