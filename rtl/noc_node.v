`timescale 1ns / 1ps

// rtl/noc_node.v -- one mesh node: a router (rtl/router.v) attached to a full
// self-sequencing GEMM tile (rtl/gemm_tile.v), with registered flit buffers
// (rtl/flit_buf.v) on every mesh-side router input to break the combinational
// cycles a raw crossbar mesh would form.
//
// Flit format (the router treats everything above the address as opaque):
//
//   { type[1:0], payload[PW-1:0], dest_y[AW-1:0], dest_x[AW-1:0] }
//
//   type 0 OPERAND  payload = {wr_addr, wr_a_col, wr_b_row} -- an addressed
//                   operand_mem write, delivered straight into the tile's
//                   write port (the interface built in the operand-mem step).
//   type 1 GO       a compute descriptor: pulses the tile's start with
//                   k_chunks, and arms the result-return engine with a
//                   RETURN ADDRESS and an output mode (issue #56):
//                     [3:0]         k_chunks
//                     [4 +: AW]     ret_x      (AW <= 6: fields below
//                     [4+AW +: AW]  ret_y       start at bit 16)
//                     [31:16]       rq_m       requant multiplier
//                     [37:32]       rq_sh      requant right shift
//                     [38]          rq_relu    ReLU before saturation
//                     [39]          rq_en      0: raw int32 results
//                                              1: requantized int8 results
//                     [40]          acc_keep   add onto the accumulators the
//                                              previous run left, no reset
//                                              (issue #58: K beyond one load)
//                     [41]          no_ret     keep the result in the tile:
//                                              no RESULT stream (a partial
//                                              sum a later acc_keep GO
//                                              continues)
//   type 2 RESULT   one raw accumulator cell: data = acc32 sign-extended.
//   type 3 RESULT8  one requantized ROW: data = N int8 lanes, lane j is
//                   column j (rtl/requant.v; math in model/fixedpoint.py).
//                   Both RESULT types share one payload layout,
//                     { src_y, src_x, idx[5:0], data[8N-1:0] }
//                   (idx = cell i*N+j for RESULT, row i for RESULT8), are
//                   streamed to the GO's return address when the tile
//                   finishes, and are delivered on the res_* ports (a
//                   host-side interface). A block returns as N*N RESULT
//                   flits or as N RESULT8 flits.
//
// With GO and RESULT flits, a tile's entire life cycle -- load operands,
// kick off compute, collect the 8x8 result -- rides the network; no
// per-tile control wires are required. Ordering is guaranteed per
// source-destination pair (XY routing is single-path and every link is a
// FIFO), so a GO sent after its operands can never overtake them.
//
// The result-return engine shares the router's LOCAL input with the external
// injection port (result flits have priority; injection is held off via the
// ready handshake while streaming -- at most N*N cycles, bounded). The direct
// start/k_chunks/busy/done/acc_out ports remain functional alongside the
// packetized path (used by the earlier testbenches; a GO is just another way
// to pulse start).
//
// LOCAL delivery is backpressured (issue #44): OPERAND flits are held while
// the tile is computing and GO flits while it is computing or streaming
// results, so network traffic can never collide with operand_mem reads or
// restart a tile mid-run. Direct-port callers must respect busy themselves.
module noc_node #(
    parameter N    = 8,
    parameter KMAX = 8,
    parameter AW   = 2,
    // Must match pe.v's real accumulate latency (rtl/pe.v's ACC_LATENCY
    // localparam). Sites that must stay in sync if that value ever changes:
    // rtl/pe.v's ACC_LATENCY localparam (the source of truth),
    // rtl/gemm_sequencer.v's PE_ACC_LATENCY default, rtl/gemm_tile.v's
    // PE_ACC_LATENCY default, and this default (threaded into the
    // gemm_tile instantiation below, following the same pattern as N/KMAX).
    parameter PE_ACC_LATENCY = 2,
    // Must match operand_mem.v's RD_LATENCY localparam (the source of
    // truth). Sites that must stay in sync if that value ever changes:
    // rtl/operand_mem.v's RD_LATENCY localparam, rtl/gemm_sequencer.v's
    // RD_LATENCY default, rtl/gemm_tile.v's RD_LATENCY default, and this
    // default (threaded into the gemm_tile instantiation below).
    parameter RD_LATENCY     = 1,
    // 1 = instantiate rtl/node_perf.v's performance counters (issue #54);
    // 0 = no counter logic at all.
    parameter PERF           = 1,
    // Derived -- do not override.
    parameter ADDRW = 6,               // $clog2(N*KMAX) for the defaults
    parameter PW    = ADDRW + 16*N,    // operand payload = 134 bits (widest)
    parameter TW    = 2,               // flit type field
    parameter FW    = TW + PW + 2*AW   // 140
) (
    input  wire            clk,
    input  wire            rst,
    input  wire [AW-1:0]   my_x,
    input  wire [AW-1:0]   my_y,

    // Local injection port (into the network).
    input  wire            lcl_in_valid,
    input  wire [FW-1:0]   lcl_in_flit,
    output wire            lcl_in_ready,

    // Mesh links, one set per direction. *_in feeds this node's input buffer;
    // *_out comes straight off the router (the neighbour's buffer registers it).
    input  wire            n_in_valid,  input  wire [FW-1:0] n_in_flit,  output wire n_in_ready,
    output wire            n_out_valid, output wire [FW-1:0] n_out_flit, input  wire n_out_ready,
    input  wire            e_in_valid,  input  wire [FW-1:0] e_in_flit,  output wire e_in_ready,
    output wire            e_out_valid, output wire [FW-1:0] e_out_flit, input  wire e_out_ready,
    input  wire            s_in_valid,  input  wire [FW-1:0] s_in_flit,  output wire s_in_ready,
    output wire            s_out_valid, output wire [FW-1:0] s_out_flit, input  wire s_out_ready,
    input  wire            w_in_valid,  input  wire [FW-1:0] w_in_flit,  output wire w_in_ready,
    output wire            w_out_valid, output wire [FW-1:0] w_out_flit, input  wire w_out_ready,

    // Delivered RESULT flits (host-side interface; valid for one cycle each).
    output wire            res_valid,
    output wire            res_q8,     // 1: RESULT8 (packed int8 row)
    output wire [AW-1:0]   res_src_x,
    output wire [AW-1:0]   res_src_y,
    output wire [5:0]      res_idx,
    output wire [8*N-1:0]  res_data,

    // Direct tile control/status -- still functional alongside GO flits.
    input  wire            start,
    input  wire [3:0]      k_chunks,
    output wire            busy,
    output wire            done,
    output wire signed [32*N*N-1:0] acc_out
);

    localparam LOCAL = 0, NORTH = 1, EAST = 2, SOUTH = 3, WEST = 4;
    localparam NP = 5;
    localparam [1:0] T_OPR = 2'd0, T_GO = 2'd1, T_RES = 2'd2, T_RES8 = 2'd3;
    localparam DW = 8 * N;             // RESULT data field (>= 32: N >= 4)

    initial begin
        if (AW > 6)
            $fatal(1, "noc_node: AW=%0d, but GO descriptors hold coordinates of at most 6 bits", AW);
    end

    // ---- Input buffers on the four mesh ports ----
    wire [3:0]      buf_valid;
    wire [FW-1:0]   buf_flit  [0:3];
    wire [3:0]      buf_ready;

    flit_buf #(.FW(FW)) buf_n (.clk(clk), .rst(rst),
        .in_valid(n_in_valid), .in_flit(n_in_flit), .in_ready(n_in_ready),
        .out_valid(buf_valid[0]), .out_flit(buf_flit[0]), .out_ready(buf_ready[0]));
    flit_buf #(.FW(FW)) buf_e (.clk(clk), .rst(rst),
        .in_valid(e_in_valid), .in_flit(e_in_flit), .in_ready(e_in_ready),
        .out_valid(buf_valid[1]), .out_flit(buf_flit[1]), .out_ready(buf_ready[1]));
    flit_buf #(.FW(FW)) buf_s (.clk(clk), .rst(rst),
        .in_valid(s_in_valid), .in_flit(s_in_flit), .in_ready(s_in_ready),
        .out_valid(buf_valid[2]), .out_flit(buf_flit[2]), .out_ready(buf_ready[2]));
    flit_buf #(.FW(FW)) buf_w (.clk(clk), .rst(rst),
        .in_valid(w_in_valid), .in_flit(w_in_flit), .in_ready(w_in_ready),
        .out_valid(buf_valid[3]), .out_flit(buf_flit[3]), .out_ready(buf_ready[3]));

    // ---- Router (the {type, payload} pair is opaque to it) ----
    wire [NP-1:0]    r_in_valid, r_in_ready, r_out_valid, r_out_ready;
    wire [NP*FW-1:0] r_in_flit, r_out_flit;

    // GO-decode registers (declared early: they gate LOCAL delivery below).
    reg        go_pulse;
    reg [3:0]  go_k;
    reg        go_acc;

    // Result-return engine state (declared early: it muxes the LOCAL input).
    reg  [1:0]      rr_state;   // 0 idle / 1 wait-fall / 2 wait-rise / 3 stream
    reg  [6:0]      rr_idx;     // index of the flit in rr_flit
    reg  [AW-1:0]   rr_ret_x, rr_ret_y;
    reg             rq_en, rq_relu;
    reg  [15:0]     rq_m;
    reg  [5:0]      rq_sh;
    reg  [FW-1:0]   rr_flit;    // the flit on offer, registered (see below)
    wire            rr_streaming = (rr_state == 2'd3);

    assign r_in_valid[LOCAL]         = rr_streaming ? 1'b1    : lcl_in_valid;
    assign r_in_flit[LOCAL*FW +: FW] = rr_streaming ? rr_flit : lcl_in_flit;
    assign lcl_in_ready              = rr_streaming ? 1'b0    : r_in_ready[LOCAL];
    wire   rr_accept                 = rr_streaming && r_in_ready[LOCAL];

    assign r_in_valid[NORTH] = buf_valid[0];
    assign r_in_valid[EAST]  = buf_valid[1];
    assign r_in_valid[SOUTH] = buf_valid[2];
    assign r_in_valid[WEST]  = buf_valid[3];
    assign r_in_flit[NORTH*FW +: FW] = buf_flit[0];
    assign r_in_flit[EAST*FW  +: FW] = buf_flit[1];
    assign r_in_flit[SOUTH*FW +: FW] = buf_flit[2];
    assign r_in_flit[WEST*FW  +: FW] = buf_flit[3];
    assign buf_ready[0] = r_in_ready[NORTH];
    assign buf_ready[1] = r_in_ready[EAST];
    assign buf_ready[2] = r_in_ready[SOUTH];
    assign buf_ready[3] = r_in_ready[WEST];

    router #(.AW(AW), .PW(TW + PW)) rt (
        .clk(clk), .rst(rst),
        .my_x(my_x), .my_y(my_y),
        .in_valid(r_in_valid), .in_flit(r_in_flit), .in_ready(r_in_ready),
        .out_valid(r_out_valid), .out_flit(r_out_flit), .out_ready(r_out_ready)
    );

    assign n_out_valid = r_out_valid[NORTH];
    assign e_out_valid = r_out_valid[EAST];
    assign s_out_valid = r_out_valid[SOUTH];
    assign w_out_valid = r_out_valid[WEST];
    assign n_out_flit = r_out_flit[NORTH*FW +: FW];
    assign e_out_flit = r_out_flit[EAST*FW  +: FW];
    assign s_out_flit = r_out_flit[SOUTH*FW +: FW];
    assign w_out_flit = r_out_flit[WEST*FW  +: FW];
    assign r_out_ready[NORTH] = n_out_ready;
    assign r_out_ready[EAST]  = e_out_ready;
    assign r_out_ready[SOUTH] = s_out_ready;
    assign r_out_ready[WEST]  = w_out_ready;

    // ---- LOCAL delivery: decode by flit type ----
    wire [FW-1:0] lflit   = r_out_flit[LOCAL*FW +: FW];
    wire [1:0]    ltype   = lflit[FW-1 -: TW];
    wire [PW-1:0] payload = lflit[2*AW +: PW];
    wire          deliver = r_out_valid[LOCAL];

    // LOCAL delivery backpressure (issue #44). operand_mem has one shared
    // address port per bank, and the tile reads its slots throughout a run,
    // so an OPERAND write must not land between a GO and the end of the
    // compute it starts (from go_pulse, before busy rises, through busy):
    // it would steal the port from an in-flight read and overwrite a slot
    // the run still needs. A GO must additionally wait for the result-return
    // engine to go idle -- the sequencer ignores start while busy (the GO
    // would be silently lost), and restarting the tile mid-stream would
    // clear the accumulators being returned. Both stalls are bounded (the
    // run and the 64-flit stream finish independently of the network), so
    // holding the flit in the router cannot deadlock. RESULT flits go to the
    // host-side sink and are never stalled.
    wire opr_stall = busy || go_pulse;
    wire go_stall  = opr_stall || (rr_state != 2'd0);
    assign r_out_ready[LOCAL] = !((ltype == T_OPR && opr_stall) ||
                                  (ltype == T_GO  && go_stall));

    // OPERAND -> operand_mem write.
    wire                 wr_en    = deliver && r_out_ready[LOCAL] && (ltype == T_OPR);
    wire [8*N-1:0]       wr_b_row = payload[8*N-1 : 0];
    wire [8*N-1:0]       wr_a_col = payload[16*N-1 : 8*N];
    wire [ADDRW-1:0]     wr_addr  = payload[PW-1 : 16*N];

    // RESULT / RESULT8 -> host-side ports (one cycle per flit).
    assign res_valid = deliver && (ltype == T_RES || ltype == T_RES8);
    assign res_q8    = (ltype == T_RES8);
    assign res_data  = payload[DW-1:0];
    assign res_idx   = payload[DW +: 6];
    assign res_src_x = payload[DW+6 +: AW];
    assign res_src_y = payload[DW+6+AW +: AW];

    // GO -> registered start pulse + latched descriptor, arms result return.
    wire go_deliver = deliver && r_out_ready[LOCAL] && (ltype == T_GO);
    always @(posedge clk) begin
        if (rst) begin
            go_pulse <= 1'b0;
            go_k     <= 4'd0;
            go_acc   <= 1'b0;
            rr_ret_x <= {AW{1'b0}};
            rr_ret_y <= {AW{1'b0}};
            rq_m     <= 16'd0;
            rq_sh    <= 6'd0;
            rq_relu  <= 1'b0;
            rq_en    <= 1'b0;
        end else begin
            go_pulse <= 1'b0;
            if (go_deliver) begin
                go_k     <= payload[3:0];
                go_acc   <= payload[40];
                rr_ret_x <= payload[4 +: AW];
                rr_ret_y <= payload[4+AW +: AW];
                rq_m     <= payload[31:16];
                rq_sh    <= payload[37:32];
                rq_relu  <= payload[38];
                rq_en    <= payload[39];
                go_pulse <= 1'b1;
            end
        end
    end

    // ---- Result-return engine ----
    // Armed by a GO without no_ret; waits for the tile's (level-held) done
    // to fall as the new run starts, then rise when it completes, then
    // streams the block to the return address via the LOCAL input mux: N*N
    // RESULT flits (raw), or N RESULT8 flits (requantized, one row each).
    //
    // The offered flit is registered: the edge that enters streaming loads
    // flit 0 and each accepted flit loads the next, so the requant lanes'
    // multiply sits between two registers instead of in front of the
    // router's crossbar. Raw-mode timing is unchanged by the register (flit 0
    // is on offer in the first streaming cycle, as before). acc_out is
    // stable throughout: a GO cannot restart the tile until streaming ends.
    wire [6:0] rr_last = rq_en ? N-1 : N*N-1;
    wire [6:0] nxt_idx = rr_streaming ? rr_idx + 7'd1 : 7'd0;

    wire [DW-1:0] raw_data = {{(DW-32){acc_out[32*nxt_idx + 31]}}, acc_out[32*nxt_idx +: 32]};
    wire [DW-1:0] q8_data;
    genvar lane;
    generate
        for (lane = 0; lane < N; lane = lane + 1) begin : g_rq
            requant rq (
                .acc  (acc_out[32*(N*nxt_idx + lane) +: 32]),
                .m    (rq_m),
                .sh   (rq_sh),
                .relu (rq_relu),
                .q    (q8_data[8*lane +: 8])
            );
        end
    endgenerate

    wire [PW-1:0] nxt_payload = { {(PW-DW-6-2*AW){1'b0}}, my_y, my_x, nxt_idx[5:0],
                                  rq_en ? q8_data : raw_data };
    wire [FW-1:0] nxt_flit    = { rq_en ? T_RES8 : T_RES, nxt_payload, rr_ret_y, rr_ret_x };

    always @(posedge clk) begin
        if (rst) begin
            rr_state <= 2'd0;
            rr_idx   <= 7'd0;
            rr_flit  <= {FW{1'b0}};
        end else begin
            case (rr_state)
                2'd0: if (go_deliver && !payload[41]) rr_state <= 2'd1;
                2'd1: if (!done)      rr_state <= 2'd2;   // run underway
                2'd2: if (done) begin
                    rr_state <= 2'd3;
                    rr_idx   <= nxt_idx;
                    rr_flit  <= nxt_flit;
                end
                2'd3: if (rr_accept) begin
                    if (rr_idx == rr_last) rr_state <= 2'd0;
                    else begin
                        rr_idx  <= nxt_idx;
                        rr_flit <= nxt_flit;
                    end
                end
            endcase
        end
    end

    // ---- Tile ----
    wire       start_eff = start | go_pulse;
    wire [3:0] k_eff     = go_pulse ? go_k : k_chunks;
    wire       acc_eff   = go_pulse && go_acc;   // direct starts always clear

    wire       tile_feeding;

    gemm_tile #(.N(N), .KMAX(KMAX), .PE_ACC_LATENCY(PE_ACC_LATENCY), .RD_LATENCY(RD_LATENCY)) tile_i (
        .clk      (clk),
        .rst      (rst),
        .wr_en    (wr_en),
        .wr_addr  (wr_addr),
        .wr_a_col (wr_a_col),
        .wr_b_row (wr_b_row),
        .start    (start_eff),
        .k_chunks (k_eff),
        .accumulate(acc_eff),
        .busy     (busy),
        .done     (done),
        .feeding  (tile_feeding),
        .acc_out  (acc_out)
    );

    // ---- Performance counters (issue #54) ----
    generate
        if (PERF) begin : g_perf
            node_perf perf (
                .clk          (clk),
                .rst          (rst),
                .busy         (busy),
                .feeding      (tile_feeding),
                .out_valid    (r_out_valid),
                .out_ready    (r_out_ready),
                .lcl_in_valid (r_in_valid[LOCAL]),
                .lcl_in_ready (r_in_ready[LOCAL])
            );
        end else begin : g_noperf
            // Lint exempts *unused* names from UNUSEDSIGNAL: the feed
            // strobe exists only for the counters.
            wire unused_tile_feeding = tile_feeding;
        end
    endgenerate

endmodule
