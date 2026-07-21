`timescale 1ns / 1ps

// rtl/noc_mesh2x2.v -- the full Phase 2 NoC deliverable: four self-sequencing
// GEMM tiles (rtl/noc_node.v: router + registered link buffers + gemm_tile)
// in a 2x2 mesh. This is the smallest topology where the NoC's mesh-level
// claims actually exist to be tested:
//
//   * XY dimension-order routing makes a real X-then-Y corner turn -- e.g. a
//     flit injected at (0,0) for (1,1) travels east to (1,0), turns, and goes
//     north. A 1x2 line (rtl/noc_pair.v) has no turns.
//   * Independent traffic streams cross through shared routers, and streams
//     from different sources converge on the same output port (round-robin
//     arbitration at mesh level, not just in a single-router testbench).
//   * Deadlock-freedom matters: XY routing is provably deadlock-free (it
//     never forms a cyclic channel dependency), and the registered link
//     buffers (flit_buf) keep every handshake loop-free; tb/mesh/ exercises
//     concurrent cross-traffic to back that empirically.
//
// Node grid (x east, y north):        (0,1) --- (1,1)
//                                       |         |
//                                     (0,0) --- (1,0)
//
// Two local injection points at opposite corners, node (0,0) and node (1,1),
// so testbench traffic can genuinely cross the mesh and contend. The other
// two nodes' local inputs are tied off (they only receive). Per-tile
// start/k_chunks/busy/done/acc_out stay direct wires, same boundary as
// noc_pair (GO/result flits are a possible later card).
module noc_mesh2x2 #(
    parameter N    = 8,
    parameter KMAX = 8,
    parameter AW   = 2,
    parameter ADDRW = 6,
    parameter PW    = ADDRW + 16*N,
    parameter TW    = 2,               // flit type field (see noc_node.v)
    parameter FW    = TW + PW + 2*AW
) (
    input  wire                     clk,
    input  wire                     rst,

    // Injection at node (0,0) and node (1,1).
    input  wire                     inj00_valid,
    input  wire [FW-1:0]            inj00_flit,
    output wire                     inj00_ready,
    input  wire                     inj11_valid,
    input  wire [FW-1:0]            inj11_flit,
    output wire                     inj11_ready,

    // RESULT flits delivered at node (0,0) -- the "host" corner. One flit per
    // cycle: {source tile coords, accumulator index, 32-bit value}.
    output wire                     res00_valid,
    output wire [AW-1:0]            res00_src_x,
    output wire [AW-1:0]            res00_src_y,
    output wire [5:0]               res00_idx,
    output wire [31:0]              res00_acc,

    // Per-tile compute handshake + results.
    input  wire                     start_00, start_10, start_01, start_11,
    input  wire [3:0]               k_chunks_00, k_chunks_10, k_chunks_01, k_chunks_11,
    output wire                     busy_00, busy_10, busy_01, busy_11,
    output wire                     done_00, done_10, done_01, done_11,
    output wire signed [32*N*N-1:0] acc_out_00, acc_out_10, acc_out_01, acc_out_11
);

    // Directed channels: {source}2{dest} per link direction.
    wire           v_00e10, r_00e10;  wire [FW-1:0] f_00e10;   // (0,0) east -> (1,0)
    wire           v_10w00, r_10w00;  wire [FW-1:0] f_10w00;   // (1,0) west -> (0,0)
    wire           v_01e11, r_01e11;  wire [FW-1:0] f_01e11;   // (0,1) east -> (1,1)
    wire           v_11w01, r_11w01;  wire [FW-1:0] f_11w01;   // (1,1) west -> (0,1)
    wire           v_00n01, r_00n01;  wire [FW-1:0] f_00n01;   // (0,0) north -> (0,1)
    wire           v_01s00, r_01s00;  wire [FW-1:0] f_01s00;   // (0,1) south -> (0,0)
    wire           v_10n11, r_10n11;  wire [FW-1:0] f_10n11;   // (1,0) north -> (1,1)
    wire           v_11s10, r_11s10;  wire [FW-1:0] f_11s10;   // (1,1) south -> (1,0)

    noc_node #(.N(N), .KMAX(KMAX), .AW(AW)) node00 (
        .clk(clk), .rst(rst), .my_x(2'd0), .my_y(2'd0),
        .lcl_in_valid(inj00_valid), .lcl_in_flit(inj00_flit), .lcl_in_ready(inj00_ready),
        .n_in_valid(v_01s00), .n_in_flit(f_01s00), .n_in_ready(r_01s00),
        .n_out_valid(v_00n01), .n_out_flit(f_00n01), .n_out_ready(r_00n01),
        .e_in_valid(v_10w00), .e_in_flit(f_10w00), .e_in_ready(r_10w00),
        .e_out_valid(v_00e10), .e_out_flit(f_00e10), .e_out_ready(r_00e10),
        .s_in_valid(1'b0), .s_in_flit({FW{1'b0}}), .s_in_ready(),
        .s_out_valid(), .s_out_flit(), .s_out_ready(1'b1),
        .w_in_valid(1'b0), .w_in_flit({FW{1'b0}}), .w_in_ready(),
        .w_out_valid(), .w_out_flit(), .w_out_ready(1'b1),
        .res_valid(res00_valid), .res_src_x(res00_src_x), .res_src_y(res00_src_y),
        .res_idx(res00_idx), .res_acc(res00_acc),
        .start(start_00), .k_chunks(k_chunks_00),
        .busy(busy_00), .done(done_00), .acc_out(acc_out_00)
    );

    noc_node #(.N(N), .KMAX(KMAX), .AW(AW)) node10 (
        .clk(clk), .rst(rst), .my_x(2'd1), .my_y(2'd0),
        .lcl_in_valid(1'b0), .lcl_in_flit({FW{1'b0}}), .lcl_in_ready(),
        .n_in_valid(v_11s10), .n_in_flit(f_11s10), .n_in_ready(r_11s10),
        .n_out_valid(v_10n11), .n_out_flit(f_10n11), .n_out_ready(r_10n11),
        .e_in_valid(1'b0), .e_in_flit({FW{1'b0}}), .e_in_ready(),
        .e_out_valid(), .e_out_flit(), .e_out_ready(1'b1),
        .s_in_valid(1'b0), .s_in_flit({FW{1'b0}}), .s_in_ready(),
        .s_out_valid(), .s_out_flit(), .s_out_ready(1'b1),
        .w_in_valid(v_00e10), .w_in_flit(f_00e10), .w_in_ready(r_00e10),
        .w_out_valid(v_10w00), .w_out_flit(f_10w00), .w_out_ready(r_10w00),
        .start(start_10), .k_chunks(k_chunks_10),
        .busy(busy_10), .done(done_10), .acc_out(acc_out_10)
    );

    noc_node #(.N(N), .KMAX(KMAX), .AW(AW)) node01 (
        .clk(clk), .rst(rst), .my_x(2'd0), .my_y(2'd1),
        .lcl_in_valid(1'b0), .lcl_in_flit({FW{1'b0}}), .lcl_in_ready(),
        .n_in_valid(1'b0), .n_in_flit({FW{1'b0}}), .n_in_ready(),
        .n_out_valid(), .n_out_flit(), .n_out_ready(1'b1),
        .e_in_valid(v_11w01), .e_in_flit(f_11w01), .e_in_ready(r_11w01),
        .e_out_valid(v_01e11), .e_out_flit(f_01e11), .e_out_ready(r_01e11),
        .s_in_valid(v_00n01), .s_in_flit(f_00n01), .s_in_ready(r_00n01),
        .s_out_valid(v_01s00), .s_out_flit(f_01s00), .s_out_ready(r_01s00),
        .w_in_valid(1'b0), .w_in_flit({FW{1'b0}}), .w_in_ready(),
        .w_out_valid(), .w_out_flit(), .w_out_ready(1'b1),
        .start(start_01), .k_chunks(k_chunks_01),
        .busy(busy_01), .done(done_01), .acc_out(acc_out_01)
    );

    noc_node #(.N(N), .KMAX(KMAX), .AW(AW)) node11 (
        .clk(clk), .rst(rst), .my_x(2'd1), .my_y(2'd1),
        .lcl_in_valid(inj11_valid), .lcl_in_flit(inj11_flit), .lcl_in_ready(inj11_ready),
        .n_in_valid(1'b0), .n_in_flit({FW{1'b0}}), .n_in_ready(),
        .n_out_valid(), .n_out_flit(), .n_out_ready(1'b1),
        .e_in_valid(1'b0), .e_in_flit({FW{1'b0}}), .e_in_ready(),
        .e_out_valid(), .e_out_flit(), .e_out_ready(1'b1),
        .s_in_valid(v_10n11), .s_in_flit(f_10n11), .s_in_ready(r_10n11),
        .s_out_valid(v_11s10), .s_out_flit(f_11s10), .s_out_ready(r_11s10),
        .w_in_valid(v_01e11), .w_in_flit(f_01e11), .w_in_ready(r_01e11),
        .w_out_valid(v_11w01), .w_out_flit(f_11w01), .w_out_ready(r_11w01),
        .start(start_11), .k_chunks(k_chunks_11),
        .busy(busy_11), .done(done_11), .acc_out(acc_out_11)
    );

endmodule
