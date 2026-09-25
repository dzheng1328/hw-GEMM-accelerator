`timescale 1ns / 1ps

// rtl/noc_mesh.v -- a W x H mesh of self-sequencing GEMM tiles
// (rtl/noc_node.v: router + registered link buffers + gemm_tile), built by a
// generate loop. Replaces the hand-wired 2x2 mesh (issue #55).
//
// Node (x, y) has flat index i = y*W + x (x east, y north); every per-node
// port below is a flat bus whose field i belongs to node i:
//
//          (0,2) - (1,2) - (2,2)        i = 6   7   8
//            |       |       |
//          (0,1) - (1,1) - (2,1)            3   4   5
//            |       |       |
//          (0,0) - (1,0) - (2,0)            0   1   2
//
// Every node exposes its LOCAL injection port and its RESULT delivery port,
// so the wrapper decides where traffic enters and where results land (the
// command processor in 4.2 ties off whatever it does not use). Links on the
// mesh boundary are tied off: no flit ever arrives there, and a flit leaving
// there would be a routing bug (XY routing never sends one off the edge).
//
// Why it stays deadlock-free at any size: XY dimension-order routing never
// forms a cyclic channel dependency, and the registered flit_buf on every
// mesh-side router input keeps each valid/ready handshake loop-free.
//
// Coordinates are AW bits wide in every flit, so the wire format does not
// change with the mesh size; W and H must fit in AW bits.
module noc_mesh #(
    parameter W     = 2,
    parameter H     = 2,
    parameter N     = 8,
    parameter KMAX  = 8,
    parameter PERF  = 1,             // per-node perf counters (rtl/node_perf.v)
    parameter AW    = 2,             // coordinate width in flits
    // Derived -- do not override.
    parameter NN    = W * H,
    parameter ADDRW = 6,
    parameter PW    = ADDRW + 16*N,
    parameter TW    = 2,             // flit type field (see noc_node.v)
    parameter FW    = TW + PW + 2*AW
) (
    input  wire                        clk,
    input  wire                        rst,

    // LOCAL injection, one port per node.
    input  wire [NN-1:0]               inj_valid,
    input  wire [NN*FW-1:0]            inj_flit,
    output wire [NN-1:0]               inj_ready,

    // RESULT/RESULT8 flits delivered at each node (valid for one cycle
    // each): source tile coords, index, and data (see noc_node.v).
    output wire [NN-1:0]               res_valid,
    output wire [NN-1:0]               res_q8,
    output wire [NN*AW-1:0]            res_src_x,
    output wire [NN*AW-1:0]            res_src_y,
    output wire [NN*6-1:0]             res_idx,
    output wire [NN*8*N-1:0]           res_data,

    // Direct tile control/status, still functional alongside GO flits.
    input  wire [NN-1:0]               start,
    input  wire [NN*4-1:0]             k_chunks,
    output wire [NN-1:0]               busy,
    output wire [NN-1:0]               done,
    output wire [NN*32*N*N-1:0]        acc_out
);

    initial begin
        if (W < 1 || H < 1 || W > (1 << AW) || H > (1 << AW))
            $fatal(1, "noc_mesh: a %0dx%0d mesh needs coordinates wider than AW=%0d bits", W, H, AW);
    end

    // Per-node link signals, named from the node's point of view:
    // {dir}o_* is the node's output toward {dir}, {dir}i_* its input from {dir}.
    // valid/flit flow with the link direction, ready flows against it.
    // On the boundary a node's outward output and inward ready have no
    // neighbour; each edge block sinks them into an unused_* wire, which
    // lint exempts by name.
    wire [NN-1:0]    no_v, no_r, eo_v, eo_r, so_v, so_r, wo_v, wo_r;
    wire [NN*FW-1:0] no_f, eo_f, so_f, wo_f;
    wire [NN-1:0]    ni_v, ni_r, ei_v, ei_r, si_v, si_r, wi_v, wi_r;
    wire [NN*FW-1:0] ni_f, ei_f, si_f, wi_f;

    genvar i;
    generate
        for (i = 0; i < NN; i = i + 1) begin : g_node
            localparam [31:0] X = i % W;
            localparam [31:0] Y = i / W;

            // East/west link to (X+1, Y), owned by the western node.
            if (X < W - 1) begin : g_east
                assign wi_v[i+1]            = eo_v[i];
                assign wi_f[(i+1)*FW +: FW] = eo_f[i*FW +: FW];
                assign eo_r[i]              = wi_r[i+1];
                assign ei_v[i]              = wo_v[i+1];
                assign ei_f[i*FW +: FW]     = wo_f[(i+1)*FW +: FW];
                assign wo_r[i+1]            = ei_r[i];
            end else begin : g_east_edge
                assign ei_v[i]          = 1'b0;
                assign ei_f[i*FW +: FW] = {FW{1'b0}};
                assign eo_r[i]          = 1'b1;
                wire unused_east = &{1'b0, eo_v[i], eo_f[i*FW +: FW], ei_r[i]};
            end
            if (X == 0) begin : g_west_edge
                assign wi_v[i]          = 1'b0;
                assign wi_f[i*FW +: FW] = {FW{1'b0}};
                assign wo_r[i]          = 1'b1;
                wire unused_west = &{1'b0, wo_v[i], wo_f[i*FW +: FW], wi_r[i]};
            end

            // North/south link to (X, Y+1), owned by the southern node.
            if (Y < H - 1) begin : g_north
                assign si_v[i+W]            = no_v[i];
                assign si_f[(i+W)*FW +: FW] = no_f[i*FW +: FW];
                assign no_r[i]              = si_r[i+W];
                assign ni_v[i]              = so_v[i+W];
                assign ni_f[i*FW +: FW]     = so_f[(i+W)*FW +: FW];
                assign so_r[i+W]            = ni_r[i];
            end else begin : g_north_edge
                assign ni_v[i]          = 1'b0;
                assign ni_f[i*FW +: FW] = {FW{1'b0}};
                assign no_r[i]          = 1'b1;
                wire unused_north = &{1'b0, no_v[i], no_f[i*FW +: FW], ni_r[i]};
            end
            if (Y == 0) begin : g_south_edge
                assign si_v[i]          = 1'b0;
                assign si_f[i*FW +: FW] = {FW{1'b0}};
                assign so_r[i]          = 1'b1;
                wire unused_south = &{1'b0, so_v[i], so_f[i*FW +: FW], si_r[i]};
            end

            noc_node #(.N(N), .KMAX(KMAX), .AW(AW), .PERF(PERF)) node (
                .clk(clk), .rst(rst), .my_x(X[AW-1:0]), .my_y(Y[AW-1:0]),
                .lcl_in_valid(inj_valid[i]), .lcl_in_flit(inj_flit[i*FW +: FW]),
                .lcl_in_ready(inj_ready[i]),
                .n_in_valid(ni_v[i]), .n_in_flit(ni_f[i*FW +: FW]), .n_in_ready(ni_r[i]),
                .n_out_valid(no_v[i]), .n_out_flit(no_f[i*FW +: FW]), .n_out_ready(no_r[i]),
                .e_in_valid(ei_v[i]), .e_in_flit(ei_f[i*FW +: FW]), .e_in_ready(ei_r[i]),
                .e_out_valid(eo_v[i]), .e_out_flit(eo_f[i*FW +: FW]), .e_out_ready(eo_r[i]),
                .s_in_valid(si_v[i]), .s_in_flit(si_f[i*FW +: FW]), .s_in_ready(si_r[i]),
                .s_out_valid(so_v[i]), .s_out_flit(so_f[i*FW +: FW]), .s_out_ready(so_r[i]),
                .w_in_valid(wi_v[i]), .w_in_flit(wi_f[i*FW +: FW]), .w_in_ready(wi_r[i]),
                .w_out_valid(wo_v[i]), .w_out_flit(wo_f[i*FW +: FW]), .w_out_ready(wo_r[i]),
                .res_valid(res_valid[i]), .res_q8(res_q8[i]),
                .res_src_x(res_src_x[i*AW +: AW]), .res_src_y(res_src_y[i*AW +: AW]),
                .res_idx(res_idx[i*6 +: 6]), .res_data(res_data[i*8*N +: 8*N]),
                .start(start[i]), .k_chunks(k_chunks[i*4 +: 4]),
                .busy(busy[i]), .done(done[i]), .acc_out(acc_out[i*32*N*N +: 32*N*N])
            );
        end
    endgenerate

endmodule
