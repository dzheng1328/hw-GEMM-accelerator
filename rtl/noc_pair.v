`timescale 1ns / 1ps

// rtl/noc_pair.v -- the first multi-tile NoC increment: two full mesh nodes
// (rtl/noc_node.v -- router + registered link buffers + gemm_tile each) side
// by side, node 0 at mesh (0,0) and node 1 at (1,0), joined by one east-west
// link. Operand flits injected at node 0's LOCAL port are routed by
// destination: (0,0) flits deliver into node 0's own operand memory
// (LOCAL -> LOCAL), (1,0) flits hop east across the registered link into
// node 1's memory. Both tiles then compute independently from what the
// network delivered.
//
// This is deliberately the minimal topology that proves multi-hop routed
// delivery end-to-end. noc_node's port structure is already full-mesh-ready
// (all four directions buffered); widening to a 2x2 grid is wiring plus
// testbench, not new design.
module noc_pair #(
    parameter N    = 8,
    parameter KMAX = 8,
    parameter AW   = 2,
    parameter ADDRW = 6,
    parameter PW    = ADDRW + 16*N,
    parameter FW    = PW + 2*AW
) (
    input  wire                     clk,
    input  wire                     rst,

    // Injection into the network at node 0.
    input  wire                     inj_valid,
    input  wire [FW-1:0]            inj_flit,
    output wire                     inj_ready,

    // Per-tile compute handshake + results (direct, not packetized yet).
    input  wire                     start_0,
    input  wire [3:0]               k_chunks_0,
    output wire                     busy_0,
    output wire                     done_0,
    output wire signed [32*N*N-1:0] acc_out_0,

    input  wire                     start_1,
    input  wire [3:0]               k_chunks_1,
    output wire                     busy_1,
    output wire                     done_1,
    output wire signed [32*N*N-1:0] acc_out_1
);

    // Node 0 east link -> node 1 west side, and back (unused westward
    // traffic path exists but nothing sends on it in this testbench).
    wire            e01_valid, e01_ready;
    wire [FW-1:0]   e01_flit;
    wire            w10_valid, w10_ready;
    wire [FW-1:0]   w10_flit;

    noc_node #(.N(N), .KMAX(KMAX), .AW(AW)) node0 (
        .clk(clk), .rst(rst),
        .my_x(2'd0), .my_y(2'd0),
        .lcl_in_valid(inj_valid), .lcl_in_flit(inj_flit), .lcl_in_ready(inj_ready),
        // North/south/west edges: no neighbours -- never valid in, always sunk out.
        .n_in_valid(1'b0), .n_in_flit({FW{1'b0}}), .n_in_ready(),
        .n_out_valid(), .n_out_flit(), .n_out_ready(1'b1),
        .s_in_valid(1'b0), .s_in_flit({FW{1'b0}}), .s_in_ready(),
        .s_out_valid(), .s_out_flit(), .s_out_ready(1'b1),
        .w_in_valid(1'b0), .w_in_flit({FW{1'b0}}), .w_in_ready(),
        .w_out_valid(), .w_out_flit(), .w_out_ready(1'b1),
        // East link to node 1.
        .e_in_valid(w10_valid), .e_in_flit(w10_flit), .e_in_ready(w10_ready),
        .e_out_valid(e01_valid), .e_out_flit(e01_flit), .e_out_ready(e01_ready),
        .start(start_0), .k_chunks(k_chunks_0),
        .busy(busy_0), .done(done_0), .acc_out(acc_out_0)
    );

    noc_node #(.N(N), .KMAX(KMAX), .AW(AW)) node1 (
        .clk(clk), .rst(rst),
        .my_x(2'd1), .my_y(2'd0),
        // No injector at node 1 in this increment.
        .lcl_in_valid(1'b0), .lcl_in_flit({FW{1'b0}}), .lcl_in_ready(),
        .n_in_valid(1'b0), .n_in_flit({FW{1'b0}}), .n_in_ready(),
        .n_out_valid(), .n_out_flit(), .n_out_ready(1'b1),
        .s_in_valid(1'b0), .s_in_flit({FW{1'b0}}), .s_in_ready(),
        .s_out_valid(), .s_out_flit(), .s_out_ready(1'b1),
        .e_in_valid(1'b0), .e_in_flit({FW{1'b0}}), .e_in_ready(),
        .e_out_valid(), .e_out_flit(), .e_out_ready(1'b1),
        // West link back to node 0.
        .w_in_valid(e01_valid), .w_in_flit(e01_flit), .w_in_ready(e01_ready),
        .w_out_valid(w10_valid), .w_out_flit(w10_flit), .w_out_ready(w10_ready),
        .start(start_1), .k_chunks(k_chunks_1),
        .busy(busy_1), .done(done_1), .acc_out(acc_out_1)
    );

endmodule
