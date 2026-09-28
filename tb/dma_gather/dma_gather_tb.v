`timescale 1ns / 1ps

// tb/dma_gather/dma_gather_tb.v -- test harness for the command processor's
// front end: rtl/dma_gather.v reading four sim_mem activation banks and a
// weight sim_mem, feeding rtl/flit_pack.v. The testbench loads memory
// through the write ports and watches node (0,0)'s injection port.
module dma_gather_tb #(
    parameter AW = 3
) (
    input  wire          clk,
    input  wire          rst,
    // Loading: activation word address (bank = low 2 bits) and weight word address.
    input  wire          act_we,
    input  wire [16:0]   act_waddr,
    input  wire [63:0]   act_wdata,
    input  wire          wt_we,
    input  wire [14:0]   wt_waddr,
    input  wire [63:0]   wt_wdata,
    // BLOCK and layer registers.
    input  wire          start,
    input  wire [AW-1:0] tile_x,
    input  wire [AW-1:0] tile_y,
    input  wire [5:0]    group,
    input  wire [7:0]    pixel_block,
    input  wire [6:0]    round,
    input  wire [2:0]    ky0,
    input  wire [2:0]    kx0,
    input  wire          acc_keep,
    input  wire          no_ret,
    input  wire          requant,
    input  wire          relu,
    input  wire [5:0]    sh,
    input  wire [15:0]   m,
    input  wire [19:0]   in_base,
    input  wire [14:0]   w_base,
    input  wire [3:0]    cin_log2,
    input  wire [3:0]    h_log2,
    input  wire [3:0]    w_log2,
    input  wire [3:0]    wout_log2,
    input  wire          stride2,
    input  wire          pad,
    input  wire [3:0]    ksize,
    input  wire [15:0]   ks,
    input  wire [15:0]   bias_start,
    input  wire [7:0]    bias_val,
    output wire          busy,
    output wire          ready,
    output wire          handoff,
    output wire          inj_valid,
    output wire [2+134+2*AW-1:0] inj_flit,   // FW = type + payload + 2*AW
    input  wire          inj_ready
);

    wire          act_re, wt_re;
    wire [59:0]   act_raddr;
    wire [255:0]  act_rdata;
    wire [14:0]   wt_raddr;
    wire [63:0]   wt_rdata;

    genvar b;
    generate
        for (b = 0; b < 4; b = b + 1) begin : bank
            localparam [1:0] BI = b;
            sim_mem #(.AW(15)) bank_mem (
                .clk(clk), .re(act_re), .raddr(act_raddr[b*15 +: 15]), .rdata(act_rdata[b*64 +: 64]),
                .we(act_we && act_waddr[1:0] == BI), .waddr(act_waddr[16:2]), .wdata(act_wdata));
        end
    endgenerate

    sim_mem #(.AW(15)) weights (
        .clk(clk), .re(wt_re), .raddr(wt_raddr), .rdata(wt_rdata),
        .we(wt_we), .waddr(wt_waddr), .wdata(wt_wdata));

    wire        b_valid, b_ready, b_go;
    wire [5:0]  b_slot;
    wire [63:0] b_a, b_b;
    wire [3:0]  b_kchunks;

    // flit_pack's BLOCK fields travel through the DMA as an opaque tag,
    // latched at start and returned with every beat (rtl/accel.v packs the
    // same way).
    localparam TAGW = 2*AW + 26;
    wire [TAGW-1:0] tag = {tile_y, tile_x, no_ret, acc_keep, requant, relu, sh, m};
    wire [TAGW-1:0] b_tag;

    dma_gather #(.TAGW(TAGW)) dma (
        .clk(clk), .rst(rst), .start(start),
        .group(group), .pixel_block(pixel_block), .round(round), .ky0(ky0), .kx0(kx0),
        .in_base(in_base), .w_base(w_base), .cin_log2(cin_log2), .h_log2(h_log2), .w_log2(w_log2),
        .wout_log2(wout_log2), .stride2(stride2), .pad(pad), .ksize(ksize), .ks(ks),
        .bias_start(bias_start), .bias_val(bias_val), .busy(busy), .ready(ready), .handoff(handoff),
        .tag(tag), .out_tag(b_tag),
        .act_re(act_re), .act_raddr(act_raddr), .act_rdata(act_rdata),
        .wt_re(wt_re), .wt_raddr(wt_raddr), .wt_rdata(wt_rdata),
        .out_valid(b_valid), .out_ready(b_ready), .out_go(b_go), .out_slot(b_slot),
        .out_a(b_a), .out_b(b_b), .out_kchunks(b_kchunks));

    flit_pack #(.AW(AW)) pack (
        .clk(clk), .rst(rst),
        .dest_y(b_tag[AW+26 +: AW]), .dest_x(b_tag[26 +: AW]), .no_ret(b_tag[25]), .acc_keep(b_tag[24]),
        .requant(b_tag[23]), .relu(b_tag[22]), .sh(b_tag[21:16]), .m(b_tag[15:0]),
        .in_valid(b_valid), .in_ready(b_ready), .in_go(b_go), .in_slot(b_slot), .in_a(b_a), .in_b(b_b),
        .in_kchunks(b_kchunks), .inj_valid(inj_valid), .inj_flit(inj_flit), .inj_ready(inj_ready));

endmodule
