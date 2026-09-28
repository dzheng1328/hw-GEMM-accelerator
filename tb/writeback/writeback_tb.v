`timescale 1ns / 1ps

// tb/writeback/writeback_tb.v -- test harness for rtl/writeback.v on a 4x3
// mesh, writing four sim_mem activation banks (word w in bank w mod 4) that
// the testbench reads back by hierarchy (g_act[b].bank.mem).
module writeback_tb #(
    parameter W  = 4,
    parameter H  = 3,
    parameter AW = 3
) (
    input  wire          clk,
    input  wire          rst,
    input  wire          push,
    input  wire [3:0]    push_tile,
    input  wire          push_raw,
    input  wire [16:0]   push_base,
    input  wire [11:0]   push_step,
    output wire [15:0]   full,
    output wire          idle,
    input  wire          res_valid,
    input  wire          res_q8,
    input  wire [AW-1:0] res_src_x,
    input  wire [AW-1:0] res_src_y,
    input  wire [5:0]    res_idx,
    input  wire [63:0]   res_data,
    output wire          act_we
);

    wire [16:0]  act_waddr;
    wire [63:0]  act_wdata;
    wire [255:0] unused_rdata;

    writeback #(.W(W), .H(H), .AW(AW)) wb (
        .clk(clk), .rst(rst), .push(push), .push_tile(push_tile), .push_raw(push_raw),
        .push_base(push_base), .push_step(push_step), .full(full), .idle(idle),
        .res_valid(res_valid), .res_q8(res_q8), .res_src_x(res_src_x), .res_src_y(res_src_y),
        .res_idx(res_idx), .res_data(res_data),
        .act_we(act_we), .act_waddr(act_waddr), .act_wdata(act_wdata));

    genvar b;
    generate
        for (b = 0; b < 4; b = b + 1) begin : g_act
            localparam [1:0] BI = b;
            sim_mem #(.AW(15)) bank (
                .clk(clk), .re(1'b0), .raddr(15'd0), .rdata(unused_rdata[b*64 +: 64]),
                .we(act_we && act_waddr[1:0] == BI), .waddr(act_waddr[16:2]), .wdata(act_wdata));
        end
    endgenerate

endmodule
