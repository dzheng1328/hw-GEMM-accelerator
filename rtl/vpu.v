`timescale 1ns / 1ps

// rtl/vpu.v -- the vector unit (milestone 4.3e, docs/superpowers/specs/
// 2026-10-13-4.3e-vpu-rtl-design.md): one command at a time, the nine VOP
// sub-ops of compiler/isa.py, each bit-exact to compiler/golden_vop.py.
//
//   start, sub, ra, rb, rc, t, plen, inv_temp -> one command; the operand
//   values are latched at `start`. busy is high from the cycle after start
//   until the last write has been committed; `done` is high for the first
//   cycle busy is low again. While busy the VPU is the only user of both
//   memories (4.3f muxes these ports onto the DMA and write-back ports);
//   when idle every enable is low.
//
//   activation memory: 2^17 words, one 64-bit read port and one write port
//   A memory:          2^16 words, one 64-bit read port and one write port
//   Reads are registered like rtl/sim_mem.v's: rdata is valid the cycle
//   after re, and a read and a write of one address in one cycle return the
//   old word.
//
// Each sub-op is its own module (rtl/vpu_<name>.v) with registered read and
// write requests that are low when it is idle, so this module ORs the nine
// together. A read request goes out with a tag (rq_i); the tag and the
// memory it went to are registered once, matching the memory's one-cycle
// read latency, and come back beside the read data (dv, di, dw).
//
// Faults (sticky `fault`, `$fatal` in simulation unless FATAL = 0, the
// command and everything after it stops): an invalid sub-op, a position t of
// 256 or more for the sub-ops that use it, and each sub-op's own (EMBED: a
// token outside the vocabulary; RMSNORM: a zero rsqrt input; SAMPLE: an
// inv_temp of 65536 or more). `start` while busy is always a simulation
// $fatal.
module vpu #(
    parameter FATAL = 1,               // faults end the simulation
    parameter PERF  = 1                // rtl/vpu_perf.v counters
) (
    input  wire        clk,
    input  wire        rst,
    input  wire        start,
    input  wire [3:0]  sub,
    input  wire [31:0] ra,
    input  wire [31:0] rb,
    input  wire [31:0] rc,
    input  wire [31:0] t,
    input  wire [31:0] plen,
    input  wire [31:0] inv_temp,
    output wire        busy,
    output wire        done,
    output wire        fault,
    // activation memory
    output wire        act_re,
    output wire [16:0] act_raddr,
    input  wire [63:0] act_rdata,
    output wire        act_we,
    output wire [16:0] act_waddr,
    output wire [63:0] act_wdata,
    // A memory
    output wire        a_re,
    output wire [15:0] a_raddr,
    input  wire [63:0] a_rdata,
    output wire        a_we,
    output wire [15:0] a_waddr,
    output wire [63:0] a_wdata
);

    // Sub-op numbers (compiler/isa.py); the others are selected by slice number below.
    localparam [3:0] EMBED = 4'd1, ROPE = 4'd3, KVWRITE = 4'd4, SOFTMAX = 4'd5, SAMPLE = 4'd9;

    // ---- command latch and start decode ----
    reg         busy_r, done_r, fault_r;
    reg         go_d;
    reg  [3:0]  sub_q;
    reg  [31:0] ra_q, rb_q, rc_q, t_q, plen_q, inv_q;
    wire        sub_ok  = (sub >= EMBED) && (sub <= SAMPLE);
    wire        uses_t  = (sub == EMBED) || (sub == ROPE) || (sub == KVWRITE) || (sub == SOFTMAX) || (sub == SAMPLE);
    wire        cmd_bad = !sub_ok || (uses_t && t >= 32'd256);
    wire        begin_ok = start && !busy_r && !fault_r && !cmd_bad;

    wire [8:0]  go = {9{go_d}} & (9'd1 << (sub_q - 4'd1));
    wire [8:0]  fin, flt;
    wire        fin_any = |fin;
    wire        kill    = fault_r;

    always @(posedge clk) begin
        done_r <= 1'b0;
        go_d   <= 1'b0;
        if (rst) begin
            busy_r  <= 1'b0;
            fault_r <= 1'b0;
        end else begin
            if (start && !busy_r && !fault_r && cmd_bad) fault_r <= 1'b1;
            if (|flt) fault_r <= 1'b1;
            if (begin_ok) begin
                busy_r <= 1'b1;
                go_d   <= 1'b1;
                sub_q  <= sub;
                ra_q   <= ra;
                rb_q   <= rb;
                rc_q   <= rc;
                t_q    <= t;
                plen_q <= plen;
                inv_q  <= inv_temp;
            end
            if (fin_any) begin
                busy_r <= 1'b0;
                done_r <= 1'b1;
            end
            if (fault_r) busy_r <= 1'b0;
        end
    end
    // The operand registers are 32 bits; the sub-ops take the bits their memories address.
    wire unused = &{1'b0, ra_q[31:17], rb_q[31:17], rc_q[31:17], t_q[31:8]};

    assign busy  = busy_r;
    assign done  = done_r;
    assign fault = fault_r;

`ifndef SYNTHESIS
    always @(posedge clk) begin
        if (!rst && start && busy_r)
            $fatal(1, "vpu: start while busy");
        if (!rst && FATAL != 0 && fault_r)
            $fatal(1, "vpu: fault (sub-op %0d)", sub_q);
    end
`endif

    // ---- per-op request buses, packed: op k (1-based) is slice k - 1 ----
    wire [8:0]       ar_v, br_v, aw_v, bw_v;
    wire [9*17-1:0]  ar_a, aw_a;
    wire [9*16-1:0]  br_a, bw_a, rq_i;
    wire [9*64-1:0]  aw_d, bw_d;

    // Read-data tag: a request visible here in cycle c returns its data in
    // cycle c + 1 (the memory's registered read), together with p1_*.
    reg         p1_v, p1_sel;
    reg  [15:0] p1_i;
    wire        any_ar = |ar_v;
    wire        any_br = |br_v;
    integer k;
    reg  [16:0] ar_a_o, aw_a_o;
    reg  [15:0] br_a_o, bw_a_o, rq_o;
    reg  [63:0] aw_d_o, bw_d_o;
    always @* begin
        ar_a_o = 17'd0; aw_a_o = 17'd0; br_a_o = 16'd0; bw_a_o = 16'd0;
        rq_o = 16'd0; aw_d_o = 64'd0; bw_d_o = 64'd0;
        for (k = 0; k < 9; k = k + 1) begin
            if (ar_v[k]) ar_a_o = ar_a_o | ar_a[17*k +: 17];
            if (br_v[k]) br_a_o = br_a_o | br_a[16*k +: 16];
            if (aw_v[k]) begin aw_a_o = aw_a_o | aw_a[17*k +: 17]; aw_d_o = aw_d_o | aw_d[64*k +: 64]; end
            if (bw_v[k]) begin bw_a_o = bw_a_o | bw_a[16*k +: 16]; bw_d_o = bw_d_o | bw_d[64*k +: 64]; end
            if (ar_v[k] || br_v[k]) rq_o = rq_o | rq_i[16*k +: 16];
        end
    end
    assign act_re    = any_ar;
    assign act_raddr = ar_a_o;
    assign a_re      = any_br;
    assign a_raddr   = br_a_o;
    assign act_we    = |aw_v;
    assign act_waddr = aw_a_o;
    assign act_wdata = aw_d_o;
    assign a_we      = |bw_v;
    assign a_waddr   = bw_a_o;
    assign a_wdata   = bw_d_o;

    always @(posedge clk) begin
        p1_v   <= any_ar || any_br;
        p1_sel <= any_br;
        p1_i   <= rq_o;
    end
    wire        dv   = p1_v;
    wire [15:0] di   = p1_i;
    wire [63:0] dw   = p1_sel ? a_rdata : act_rdata;

    // ---- the shared reciprocal square root / reciprocal ----
    wire [39:0] ru_u_rms, ru_u_sm;
    wire        ru_recip_sm;
    wire [15:0] ru_r;
    wire [5:0]  ru_k;
    wire        ru_zero;
    vpu_rsqrt rsq (.recip(ru_recip_sm), .u(ru_u_rms | ru_u_sm), .r(ru_r), .k(ru_k), .zero(ru_zero));

    // ---- the nine sub-ops ----
    // slice 0: EMBED
    vpu_embed u_embed (
        .clk(clk), .rst(rst), .kill(kill), .go(go[0]), .ra(ra_q[15:0]), .rb(rb_q[16:0]), .rc(rc_q[15:0]), .t(t_q[7:0]),
        .ar_v(ar_v[0]), .ar_a(ar_a[0*17 +: 17]), .br_v(br_v[0]), .br_a(br_a[0*16 +: 16]), .rq_i(rq_i[0*16 +: 16]),
        .dv(dv), .di(di), .dw(dw),
        .aw_v(aw_v[0]), .aw_a(aw_a[0*17 +: 17]), .aw_d(aw_d[0*64 +: 64]), .fin(fin[0]), .flt(flt[0]));
    assign bw_v[0] = 1'b0;
    assign bw_a[0*16 +: 16] = 16'd0;
    assign bw_d[0*64 +: 64] = 64'd0;

    // slice 1: RMSNORM
    vpu_rmsnorm u_rmsnorm (
        .clk(clk), .rst(rst), .kill(kill), .go(go[1]), .ra(ra_q[16:0]), .rb(rb_q[16:0]), .rc(rc_q[15:0]),
        .ar_v(ar_v[1]), .ar_a(ar_a[1*17 +: 17]), .br_v(br_v[1]), .br_a(br_a[1*16 +: 16]), .rq_i(rq_i[1*16 +: 16]),
        .dv(dv), .di(di), .dw(dw),
        .aw_v(aw_v[1]), .aw_a(aw_a[1*17 +: 17]), .aw_d(aw_d[1*64 +: 64]), .fin(fin[1]), .flt(flt[1]),
        .ru_u(ru_u_rms), .ru_r(ru_r), .ru_k(ru_k), .ru_zero(ru_zero));
    assign bw_v[1] = 1'b0;
    assign bw_a[1*16 +: 16] = 16'd0;
    assign bw_d[1*64 +: 64] = 64'd0;

    // slice 2: ROPE
    vpu_rope u_rope (
        .clk(clk), .rst(rst), .kill(kill), .go(go[2]), .ra(ra_q[16:0]), .rb(rb_q[16:0]), .rc(rc_q[15:0]), .t(t_q[7:0]),
        .ar_v(ar_v[2]), .ar_a(ar_a[2*17 +: 17]), .br_v(br_v[2]), .br_a(br_a[2*16 +: 16]), .rq_i(rq_i[2*16 +: 16]),
        .dv(dv), .di(di), .dw(dw),
        .aw_v(aw_v[2]), .aw_a(aw_a[2*17 +: 17]), .aw_d(aw_d[2*64 +: 64]),
        .bw_v(bw_v[2]), .bw_a(bw_a[2*16 +: 16]), .bw_d(bw_d[2*64 +: 64]), .fin(fin[2]));
    assign flt[2] = 1'b0;

    // slice 3: KVWRITE
    vpu_kvwrite u_kvwrite (
        .clk(clk), .rst(rst), .kill(kill), .go(go[3]), .ra(ra_q[16:0]), .rb(rb_q[16:0]), .rc(rc_q[16:0]), .t(t_q[7:0]),
        .ar_v(ar_v[3]), .ar_a(ar_a[3*17 +: 17]), .rq_i(rq_i[3*16 +: 16]),
        .dv(dv), .di(di), .dw(dw),
        .aw_v(aw_v[3]), .aw_a(aw_a[3*17 +: 17]), .aw_d(aw_d[3*64 +: 64]), .fin(fin[3]));
    assign br_v[3] = 1'b0;
    assign br_a[3*16 +: 16] = 16'd0;
    assign bw_v[3] = 1'b0;
    assign bw_a[3*16 +: 16] = 16'd0;
    assign bw_d[3*64 +: 64] = 64'd0;
    assign flt[3] = 1'b0;

    // slice 4: SOFTMAX
    vpu_softmax u_softmax (
        .clk(clk), .rst(rst), .kill(kill), .go(go[4]), .ra(ra_q[16:0]), .rb(rb_q[15:0]), .rc(rc_q[15:0]), .t(t_q[7:0]),
        .ar_v(ar_v[4]), .ar_a(ar_a[4*17 +: 17]), .br_v(br_v[4]), .br_a(br_a[4*16 +: 16]), .rq_i(rq_i[4*16 +: 16]),
        .dv(dv), .di(di), .dw(dw),
        .bw_v(bw_v[4]), .bw_a(bw_a[4*16 +: 16]), .bw_d(bw_d[4*64 +: 64]), .fin(fin[4]),
        .ru_u(ru_u_sm), .ru_recip(ru_recip_sm), .ru_r(ru_r), .ru_k(ru_k));
    assign aw_v[4] = 1'b0;
    assign aw_a[4*17 +: 17] = 17'd0;
    assign aw_d[4*64 +: 64] = 64'd0;
    assign flt[4] = 1'b0;

    // slice 5: SILU_MUL
    vpu_silu u_silu (
        .clk(clk), .rst(rst), .kill(kill), .go(go[5]), .ra(ra_q[16:0]), .rb(rb_q[16:0]), .rc(rc_q[15:0]),
        .ar_v(ar_v[5]), .ar_a(ar_a[5*17 +: 17]), .br_v(br_v[5]), .br_a(br_a[5*16 +: 16]), .rq_i(rq_i[5*16 +: 16]),
        .dv(dv), .di(di), .dw(dw),
        .aw_v(aw_v[5]), .aw_a(aw_a[5*17 +: 17]), .aw_d(aw_d[5*64 +: 64]), .fin(fin[5]));
    assign bw_v[5] = 1'b0;
    assign bw_a[5*16 +: 16] = 16'd0;
    assign bw_d[5*64 +: 64] = 64'd0;
    assign flt[5] = 1'b0;

    // slice 6: ADD
    vpu_add u_add (
        .clk(clk), .rst(rst), .kill(kill), .go(go[6]), .ra(ra_q[16:0]), .rb(rb_q[16:0]),
        .ar_v(ar_v[6]), .ar_a(ar_a[6*17 +: 17]),
        .dv(dv), .dw(dw),
        .aw_v(aw_v[6]), .aw_a(aw_a[6*17 +: 17]), .aw_d(aw_d[6*64 +: 64]), .fin(fin[6]));
    assign rq_i[6*16 +: 16] = 16'd0;
    assign br_v[6] = 1'b0;
    assign br_a[6*16 +: 16] = 16'd0;
    assign bw_v[6] = 1'b0;
    assign bw_a[6*16 +: 16] = 16'd0;
    assign bw_d[6*64 +: 64] = 64'd0;
    assign flt[6] = 1'b0;

    // slice 7: TRANSPOSE
    vpu_transpose u_transpose (
        .clk(clk), .rst(rst), .kill(kill), .go(go[7]), .ra(ra_q[16:0]), .rb(rb_q[16:0]), .rc(rc_q[16:0]),
        .ar_v(ar_v[7]), .ar_a(ar_a[7*17 +: 17]),
        .dv(dv), .dw(dw),
        .aw_v(aw_v[7]), .aw_a(aw_a[7*17 +: 17]), .aw_d(aw_d[7*64 +: 64]), .fin(fin[7]));
    assign rq_i[7*16 +: 16] = 16'd0;
    assign br_v[7] = 1'b0;
    assign br_a[7*16 +: 16] = 16'd0;
    assign bw_v[7] = 1'b0;
    assign bw_a[7*16 +: 16] = 16'd0;
    assign bw_d[7*64 +: 64] = 64'd0;
    assign flt[7] = 1'b0;

    // slice 8: SAMPLE
    vpu_sample u_sample (
        .clk(clk), .rst(rst), .kill(kill), .go(go[8]), .ra(ra_q[16:0]), .rb(rb_q[15:0]), .rc(rc_q[15:0]), .t(t_q[7:0]),
        .plen(plen_q), .inv_temp(inv_q),
        .ar_v(ar_v[8]), .ar_a(ar_a[8*17 +: 17]), .br_v(br_v[8]), .br_a(br_a[8*16 +: 16]), .rq_i(rq_i[8*16 +: 16]),
        .dv(dv), .di(di), .dw(dw),
        .aw_v(aw_v[8]), .aw_a(aw_a[8*17 +: 17]), .aw_d(aw_d[8*64 +: 64]),
        .bw_v(bw_v[8]), .bw_a(bw_a[8*16 +: 16]), .bw_d(bw_d[8*64 +: 64]), .fin(fin[8]), .flt(flt[8]));

    // ---- performance counters ----
    generate
        if (PERF) begin : g_perf
            vpu_perf perf (.clk(clk), .rst(rst), .busy(busy_r), .sub(sub_q));
        end
    endgenerate

endmodule
