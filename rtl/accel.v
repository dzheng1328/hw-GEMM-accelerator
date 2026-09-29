`timescale 1ns / 1ps

// rtl/accel.v -- the milestone 4.2 accelerator top level
// (docs/specs/2026-09-25-command-processor-cifar10-design.md section 3): a
// W x H mesh of GEMM tiles (rtl/noc_mesh.v) with the command processor and
// its memories at node (0,0). A run is: load the memory images, pulse start,
// wait for done (or error). Everything in between -- commands, im2col
// gathers, OPERAND/GO flits, RESULT write-back -- happens on chip.
//
//   program --> cmd_seq --BLOCK--> dma_gather --beats--> flit_pack --> node (0,0) injection
//                 ^   |               ^ weights, activation banks (read)
//                 |   +--entry--> writeback <-- node (0,0) RESULT delivery
//                 +---full/idle------+    +--> activation banks (write)
//
// The memories are rtl/sim_mem.v, loaded at time 0 from the files named by
// the plusargs +program=, +weights=, +act_bank0= .. +act_bank3=
// (compiler/emit.py's images). Only node (0,0) injects; the other nodes'
// injection ports are tied off, and a RESULT delivered anywhere but (0,0) is
// a simulation $fatal (every GO returns to (0,0), so it would be a routing
// bug).
module accel #(
    parameter W     = 2,
    parameter H     = 2,
    parameter AW    = 2,               // mesh coordinate width in flits
    parameter PERF  = 1,               // rtl/cmd_perf.v + rtl/node_perf.v counters
    parameter FATAL = 1                // cmd_seq faults end the simulation
) (
    input  wire        clk,
    input  wire        rst,
    input  wire        start,
    output wire        done,
    output wire        error,
    output wire [11:0] error_pc
);

    localparam NN     = W * H;
    localparam TIW    = (NN > 1) ? $clog2(NN) : 1;
    localparam ACT_BW = 15;            // activation bank address bits (4 x 32K words)
    localparam WA     = ACT_BW + 2;    // activation word address bits
    localparam WT_AW  = 15;            // weight memory address bits (32K words)
    localparam PC_W   = 12;            // program memory address bits (4K words)
    localparam FW     = 2 + 134 + 2*AW;  // flit width (rtl/noc_node.v)

    // ---- Command sequencer ----
    wire                prog_re;
    wire [PC_W-1:0]     prog_raddr;
    wire [63:0]         prog_rdata;
    wire                seq_busy, seq_wait, seq_credit;
    wire                dma_start, dma_busy, dma_ready, dma_handoff;
    wire [5:0]          group;
    wire [7:0]          pixel_block;
    wire [6:0]          round;
    wire [2:0]          ky0, kx0;
    wire [ACT_BW+4:0]   in_base;
    wire [WT_AW-1:0]    w_base;
    wire [3:0]          cin_log2, h_log2, w_log2, wout_log2, ksize;
    wire                stride2, pad;
    wire [15:0]         ks, bias_start;
    wire [7:0]          bias_val;
    wire [AW-1:0]       tile_x, tile_y;
    wire                acc_keep, no_ret, requant, relu;
    wire [5:0]          sh;
    wire [15:0]         m;
    wire                wb_push, wb_raw, wb_idle;
    wire [TIW-1:0]      wb_tile;
    wire [WA-1:0]       wb_base;
    wire [11:0]         wb_step;
    wire [(1<<TIW)-1:0] wb_full;

    cmd_seq #(.W(W), .H(H), .AW(AW), .ACT_BW(ACT_BW), .WT_AW(WT_AW), .PC_W(PC_W), .FATAL(FATAL)) seq (
        .clk(clk), .rst(rst), .start(start), .done(done), .error(error), .error_pc(error_pc),
        .busy(seq_busy), .wait_stall(seq_wait), .credit_stall(seq_credit),
        .prog_re(prog_re), .prog_raddr(prog_raddr), .prog_rdata(prog_rdata),
        .dma_start(dma_start), .dma_busy(dma_busy), .dma_ready(dma_ready), .dma_handoff(dma_handoff),
        .group(group), .pixel_block(pixel_block), .round(round), .ky0(ky0), .kx0(kx0),
        .in_base(in_base), .w_base(w_base), .cin_log2(cin_log2), .h_log2(h_log2), .w_log2(w_log2),
        .wout_log2(wout_log2), .stride2(stride2), .pad(pad), .ksize(ksize), .ks(ks),
        .bias_start(bias_start), .bias_val(bias_val),
        .tile_x(tile_x), .tile_y(tile_y), .acc_keep(acc_keep), .no_ret(no_ret), .requant(requant),
        .relu(relu), .sh(sh), .m(m),
        .wb_push(wb_push), .wb_tile(wb_tile), .wb_raw(wb_raw), .wb_base(wb_base), .wb_step(wb_step),
        .wb_full(wb_full), .wb_idle(wb_idle));

    // ---- DMA and flit formatting ----
    wire                act_re, wt_re;
    wire [4*ACT_BW-1:0] act_raddr;
    wire [4*64-1:0]     act_rdata;
    wire [WT_AW-1:0]    wt_raddr;
    wire [63:0]         wt_rdata;
    wire                beat_valid, beat_ready, beat_go;
    wire [5:0]          beat_slot;
    wire [63:0]         beat_a, beat_b;
    wire [3:0]          beat_kchunks;

    // flit_pack's BLOCK fields ride through the DMA with each beat.
    localparam TAGW = 2*AW + 26;
    wire [TAGW-1:0] block_tag = {tile_y, tile_x, no_ret, acc_keep, requant, relu, sh, m};
    wire [TAGW-1:0] beat_tag;

    dma_gather #(.ACT_BW(ACT_BW), .WT_AW(WT_AW), .TAGW(TAGW)) dma (
        .clk(clk), .rst(rst), .start(dma_start),
        .group(group), .pixel_block(pixel_block), .round(round), .ky0(ky0), .kx0(kx0),
        .in_base(in_base), .w_base(w_base), .cin_log2(cin_log2), .h_log2(h_log2), .w_log2(w_log2),
        .wout_log2(wout_log2), .stride2(stride2), .pad(pad), .ksize(ksize), .ks(ks),
        .bias_start(bias_start), .bias_val(bias_val), .busy(dma_busy), .ready(dma_ready),
        .handoff(dma_handoff), .tag(block_tag),
        .act_re(act_re), .act_raddr(act_raddr), .act_rdata(act_rdata),
        .wt_re(wt_re), .wt_raddr(wt_raddr), .wt_rdata(wt_rdata),
        .out_valid(beat_valid), .out_ready(beat_ready), .out_go(beat_go), .out_slot(beat_slot),
        .out_a(beat_a), .out_b(beat_b), .out_kchunks(beat_kchunks), .out_tag(beat_tag));

    wire          inj0_valid;
    wire [FW-1:0] inj0_flit;
    wire [NN-1:0] inj_ready;

    flit_pack #(.AW(AW)) pack (
        .clk(clk), .rst(rst),
        .dest_y(beat_tag[AW+26 +: AW]), .dest_x(beat_tag[26 +: AW]), .no_ret(beat_tag[25]),
        .acc_keep(beat_tag[24]), .requant(beat_tag[23]), .relu(beat_tag[22]), .sh(beat_tag[21:16]),
        .m(beat_tag[15:0]),
        .in_valid(beat_valid), .in_ready(beat_ready), .in_go(beat_go), .in_slot(beat_slot),
        .in_a(beat_a), .in_b(beat_b), .in_kchunks(beat_kchunks),
        .inj_valid(inj0_valid), .inj_flit(inj0_flit), .inj_ready(inj_ready[0]));

    // ---- Mesh: node (0,0) injects; the rest are tied off ----
    localparam [NN-1:0] NODE0 = 1;
    wire [NN-1:0]    inj_valid = inj0_valid ? NODE0 : {NN{1'b0}};
    wire [NN*FW-1:0] inj_flit;
    assign inj_flit[FW-1:0] = inj0_flit;

    wire [NN-1:0]       res_valid, res_q8;
    wire [NN*AW-1:0]    res_src_x, res_src_y;
    wire [NN*6-1:0]     res_idx;
    wire [NN*64-1:0]    res_data;
    wire [NN-1:0]       mesh_busy, mesh_done;
    wire [NN*2048-1:0]  mesh_acc;

    noc_mesh #(.W(W), .H(H), .AW(AW), .PERF(PERF)) mesh (
        .clk(clk), .rst(rst),
        .inj_valid(inj_valid), .inj_flit(inj_flit), .inj_ready(inj_ready),
        .res_valid(res_valid), .res_q8(res_q8), .res_src_x(res_src_x), .res_src_y(res_src_y),
        .res_idx(res_idx), .res_data(res_data),
        .start({NN{1'b0}}), .k_chunks({(NN*4){1'b0}}),
        .busy(mesh_busy), .done(mesh_done), .acc_out(mesh_acc));

    // Every tile runs from GO flits; the direct tile ports are unused.
    wire unused_mesh = &{1'b0, mesh_busy, mesh_done, mesh_acc};

    generate
        if (NN > 1) begin : g_others
            assign inj_flit[NN*FW-1:FW] = 0;
            wire unused_others = &{1'b0, inj_ready[NN-1:1], res_q8[NN-1:1], res_src_x[NN*AW-1:AW],
                                   res_src_y[NN*AW-1:AW], res_idx[NN*6-1:6], res_data[NN*64-1:64]};
`ifndef SYNTHESIS
            always @(posedge clk)
                if (!rst && |res_valid[NN-1:1])
                    $fatal(1, "accel: a RESULT flit was delivered at a node other than (0,0)");
`endif
        end
    endgenerate

    // ---- Write-back ----
    wire          wb_we;
    wire [WA-1:0] wb_waddr;
    wire [63:0]   wb_wdata;

    writeback #(.W(W), .H(H), .AW(AW), .ACT_BW(ACT_BW)) wb (
        .clk(clk), .rst(rst),
        .push(wb_push), .push_tile(wb_tile), .push_raw(wb_raw), .push_base(wb_base), .push_step(wb_step),
        .full(wb_full), .idle(wb_idle),
        .res_valid(res_valid[0]), .res_q8(res_q8[0]), .res_src_x(res_src_x[AW-1:0]),
        .res_src_y(res_src_y[AW-1:0]), .res_idx(res_idx[5:0]), .res_data(res_data[63:0]),
        .act_we(wb_we), .act_waddr(wb_waddr), .act_wdata(wb_wdata));

    // ---- Memories ----
    sim_mem #(.AW(PC_W), .INIT_ARG("program=%s")) prog_mem (
        .clk(clk), .re(prog_re), .raddr(prog_raddr), .rdata(prog_rdata),
        .we(1'b0), .waddr({PC_W{1'b0}}), .wdata(64'd0));

    sim_mem #(.AW(WT_AW), .INIT_ARG("weights=%s")) wt_mem (
        .clk(clk), .re(wt_re), .raddr(wt_raddr), .rdata(wt_rdata),
        .we(1'b0), .waddr({WT_AW{1'b0}}), .wdata(64'd0));

    // Activation word w is in bank w mod 4 at bank address w >> 2.
    genvar b;
    generate
        for (b = 0; b < 4; b = b + 1) begin : g_act
            localparam [1:0] BI = b;
            localparam [8*12-1:0] ARG = (b == 0) ? "act_bank0=%s" : (b == 1) ? "act_bank1=%s"
                                      : (b == 2) ? "act_bank2=%s" : "act_bank3=%s";
            sim_mem #(.AW(ACT_BW), .INIT_ARG(ARG)) bank (
                .clk(clk), .re(act_re), .raddr(act_raddr[b*ACT_BW +: ACT_BW]),
                .rdata(act_rdata[b*64 +: 64]),
                .we(wb_we && wb_waddr[1:0] == BI), .waddr(wb_waddr[WA-1:2]), .wdata(wb_wdata));
        end
    endgenerate

    // ---- Performance counters ----
    // rtl/cmd_perf.v partitions the run cycles at node (0,0)'s injection
    // port: a flit injected (OPERAND or GO, by its type field), a flit
    // stalled, or, with the port idle, a WAIT/END stall, a credit stall, or
    // other, in that priority.
    localparam [1:0] T_GO = 2'd1;      // GO flit type (rtl/noc_node.v)
    wire inj0_go = (inj0_flit[FW-1 -: 2] == T_GO);
    generate
        if (PERF) begin : g_perf
            cmd_perf perf (
                .clk(clk), .rst(rst), .run(seq_busy), .block(dma_start),
                .inj_valid(inj0_valid), .inj_ready(inj_ready[0]), .inj_go(inj0_go),
                .wait_stall(seq_wait), .credit_stall(seq_credit), .wb_word(wb_we));
        end else begin : g_noperf
            wire unused_perf = &{1'b0, seq_busy, seq_wait, seq_credit, inj0_go};
        end
    endgenerate

endmodule
