`timescale 1ns / 1ps

// tb/cmd_seq/cmd_seq_tb.v -- test harness for rtl/cmd_seq.v on a 4x3 mesh:
// the sequencer reading a sim_mem program memory that the testbench loads
// through its write port. The testbench stands in for rtl/dma_gather.v
// (dma_start/busy/done) and rtl/writeback.v (wb_full/wb_idle). FATAL = 0 so
// every fault can be inspected on error/error_pc; tb/accel's error-check
// proves the shipping FATAL = 1 stops a run.
module cmd_seq_tb #(
    parameter W  = 4,
    parameter H  = 3,
    parameter AW = 3
) (
    input  wire          clk,
    input  wire          rst,
    input  wire          prog_we,
    input  wire [11:0]   prog_waddr,
    input  wire [63:0]   prog_wdata,
    input  wire          start,
    output wire          done,
    output wire          error,
    output wire [11:0]   error_pc,
    output wire          busy,
    output wire          wait_stall,
    output wire          credit_stall,
    output wire          dma_start,
    input  wire          dma_busy,
    input  wire          dma_ready,
    input  wire          dma_handoff,
    output wire [5:0]    group,
    output wire [7:0]    pixel_block,
    output wire [6:0]    round,
    output wire [2:0]    ky0,
    output wire [2:0]    kx0,
    output wire [19:0]   in_base,
    output wire [14:0]   w_base,
    output wire [3:0]    cin_log2,
    output wire [3:0]    h_log2,
    output wire [3:0]    w_log2,
    output wire [3:0]    wout_log2,
    output wire          stride2,
    output wire          pad,
    output wire [3:0]    ksize,
    output wire [15:0]   ks,
    output wire [15:0]   bias_start,
    output wire [7:0]    bias_val,
    output wire [AW-1:0] tile_x,
    output wire [AW-1:0] tile_y,
    output wire          acc_keep,
    output wire          no_ret,
    output wire          requant,
    output wire          relu,
    output wire [5:0]    sh,
    output wire [15:0]   m,
    output wire          wb_push,
    output wire [3:0]    wb_tile,
    output wire          wb_raw,
    output wire [16:0]   wb_base,
    output wire [11:0]   wb_step,
    input  wire [15:0]   wb_full,
    input  wire          wb_idle
);

    wire        prog_re;
    wire [11:0] prog_raddr;
    wire [63:0] prog_rdata;

    sim_mem #(.AW(12)) prog (
        .clk(clk), .re(prog_re), .raddr(prog_raddr), .rdata(prog_rdata),
        .we(prog_we), .waddr(prog_waddr), .wdata(prog_wdata));

    cmd_seq #(.W(W), .H(H), .AW(AW), .FATAL(0)) seq (
        .clk(clk), .rst(rst), .start(start), .done(done), .error(error), .error_pc(error_pc),
        .busy(busy), .wait_stall(wait_stall), .credit_stall(credit_stall),
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

endmodule
