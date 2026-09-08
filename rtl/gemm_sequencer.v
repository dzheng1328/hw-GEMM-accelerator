`timescale 1ns / 1ps

// rtl/gemm_sequencer.v -- the tile's control FSM. Replaces the Python
// compute_nblock() orchestration in the testbench: given the operands for one
// N-block, it drives rtl/tile.v through k_chunks back-to-back K-dimension waves
// (accumulating with NO reset between them) and raises `done` when the 8x8
// int32 result is settled in the array's accumulators.
//
// One `start` pulse == one N-block == one compute_nblock() call:
//   IDLE --start--> RESET (clear accumulators) --> RUN (k_chunks waves)
//        --> DRAIN (let the last wave finish) --> DONE (done=1, result valid)
//
// Per-wave schedule is the proven 3N-2 = 22-cycle spacing from the Phase 1
// tiling proof (docs/decisions.md, 2026-07-05): each chunk presents its 8
// unskewed columns/rows to the tile over the first N cycles (feed_valid high),
// then pads with feed_valid low for the rest of the 22-cycle window. That
// spacing (> 2(N-1)) is exactly what makes cross-chunk contamination
// algebraically impossible, so back-to-back chunks accumulate cleanly without a
// reset. rtl/skew_feeder.v does the actual skew/zero-pad; this FSM only decides
// *which* operands to present *when*.
//
// Operands live in rtl/operand_mem.v; the FSM addresses it via rd_addr =
// chunk*N + col, one slot per (chunk, column). The memory returns the unskewed
// A-column / B-row combinationally, which the top wires straight to the tile.
// The outer loop over N-blocks (and the fresh reset each N-block gets, via a new
// `start` pulse) stays with the caller, the same way a DMA engine issues one
// descriptor per block.
module gemm_sequencer #(
    parameter N              = 8,
    parameter KMAX           = 8,   // max K-chunks the operand memory can hold (layer 1 needs 8)
    // Must match pe.v's real accumulate latency (rtl/pe.v's ACC_LATENCY
    // localparam). Sites that must stay in sync if that value ever changes:
    // rtl/pe.v's ACC_LATENCY localparam (the source of truth), this default,
    // rtl/gemm_tile.v's PE_ACC_LATENCY default, and rtl/noc_node.v's
    // PE_ACC_LATENCY default (threaded into its gemm_tile instantiation).
    parameter PE_ACC_LATENCY = 2,
    // Must match operand_mem.v's RD_LATENCY localparam (the source of
    // truth). Sites that must stay in sync if that value ever changes:
    // rtl/operand_mem.v's RD_LATENCY localparam, this default,
    // rtl/gemm_tile.v's RD_LATENCY default, and rtl/noc_node.v's RD_LATENCY
    // default (threaded into its gemm_tile instantiation).
    parameter RD_LATENCY     = 1
) (
    input  wire                          clk,
    input  wire                          rst,        // sync system reset -> force IDLE
    input  wire                          start,      // pulse to run one N-block
    input  wire [3:0]                    k_chunks,   // K-chunks in this N-block (1..KMAX)
    output reg  [$clog2(N*KMAX)-1:0]     rd_addr,    // -> operand_mem read address (chunk*N + col)
    output reg                           tile_reset, // -> tile.reset (pulsed once per N-block)
    output wire                          feed_valid, // -> tile.in_valid, delayed RD_LATENCY cycles
    output reg                           busy,
    output reg                           done        // latches high once the result is valid
);

    localparam P            = 3*N - 2;  // 22 -- one wave's cycle budget (matches feed_wave)
    localparam RST_CYCLES   = 2;        // cycles to hold tile_reset at N-block start
    // Provable minimum is 2*(N-1) + PE_ACC_LATENCY: (N-1) cycles of skew in
    // rtl/skew_feeder.v ahead of the array, PLUS (N-1) cycles of skew inside
    // the array itself (rtl/systolic_array.v), PLUS PE_ACC_LATENCY cycles to
    // accumulate -- two separate skew stages, not one. (2*N + PE_ACC_LATENCY)
    // keeps the same generous slack the original 2*N had over that minimum.
    // RD_LATENCY is added on top: operand_mem's registered read means the
    // last chunk's real data reaches the array RD_LATENCY cycles after the
    // address-generation counter below finishes issuing addresses for it
    // (see the feed_valid_pipe comment), so the drain window must cover
    // that extra trailing delay too.
    localparam DRAIN_CYCLES = 2*N + PE_ACC_LATENCY + RD_LATENCY;

    localparam S_IDLE  = 3'd0,
               S_RESET = 3'd1,
               S_RUN   = 3'd2,
               S_DRAIN = 3'd3,
               S_DONE  = 3'd4;

    reg [2:0] state;
    reg [4:0] c_cyc;       // 0..P-1, cycle within the current wave
    reg [3:0] chunk_idx;   // which K-chunk is being fed
    reg [3:0] k_chunks_r;  // latched k_chunks for this run
    reg [4:0] aux_cnt;     // shared reset/drain counter

    // ---- Combinational operand addressing ----
    // Read slot addr = chunk_idx*N + col, where the active column index is c_cyc
    // during the feed window (clamped otherwise so the address stays in range).
    // rd_col_valid marks a cycle where rd_addr is a real (non-padding) column;
    // it is NOT what drives feed_valid -- see the pipe below.
    reg  [4:0] col_idx;
    reg        rd_col_valid;
    always @* begin
        col_idx      = (c_cyc < N) ? c_cyc : 5'd0;
        rd_col_valid = (state == S_RUN) && (c_cyc < N);
        rd_addr      = chunk_idx * N + col_idx;
    end

    // ---- feed_valid pipe ----
    // operand_mem's read is registered: data addressed by rd_addr at cycle t
    // only appears on rd_a_col/rd_b_row at cycle t+RD_LATENCY. feed_valid
    // gates the tile's in_valid, so it must trail rd_col_valid by exactly
    // RD_LATENCY cycles to line up with when the data actually arrives,
    // rather than when the address was issued. This shift register runs
    // every cycle regardless of `state`, so it drains correctly across the
    // S_RUN -> S_DRAIN boundary (DRAIN_CYCLES above already budgets the
    // extra RD_LATENCY cycles this adds at the tail of the last chunk).
    reg [RD_LATENCY-1:0] feed_valid_sr;
    integer fv;
    always @(posedge clk) begin
        if (rst) begin
            feed_valid_sr <= {RD_LATENCY{1'b0}};
        end else begin
            feed_valid_sr[0] <= rd_col_valid;
            for (fv = 1; fv < RD_LATENCY; fv = fv + 1) begin
                feed_valid_sr[fv] <= feed_valid_sr[fv-1];
            end
        end
    end
    assign feed_valid = feed_valid_sr[RD_LATENCY-1];

    // ---- Sequential control ----
    task start_run;
        begin
            k_chunks_r <= k_chunks;
            chunk_idx  <= 4'd0;
            c_cyc      <= 5'd0;
            aux_cnt    <= 5'd0;
            busy       <= 1'b1;
            done       <= 1'b0;
            tile_reset <= 1'b1;   // begin clearing the accumulators
            state      <= S_RESET;
        end
    endtask

    always @(posedge clk) begin
        if (rst) begin
            state      <= S_IDLE;
            tile_reset <= 1'b1;
            busy       <= 1'b0;
            done       <= 1'b0;
            c_cyc      <= 5'd0;
            chunk_idx  <= 4'd0;
            aux_cnt    <= 5'd0;
            k_chunks_r <= 4'd0;
        end else begin
            case (state)
                S_IDLE: begin
                    tile_reset <= 1'b0;
                    busy       <= 1'b0;
                    if (start) start_run;
                end

                S_RESET: begin
                    busy       <= 1'b1;
                    tile_reset <= 1'b1;
                    if (aux_cnt >= RST_CYCLES - 1) begin
                        tile_reset <= 1'b0;
                        aux_cnt    <= 5'd0;
                        c_cyc      <= 5'd0;
                        chunk_idx  <= 4'd0;
                        state      <= S_RUN;
                    end else begin
                        aux_cnt <= aux_cnt + 1'b1;
                    end
                end

                S_RUN: begin
                    busy       <= 1'b1;
                    tile_reset <= 1'b0;
                    if (c_cyc == P - 1) begin
                        c_cyc <= 5'd0;
                        if (chunk_idx == k_chunks_r - 1) begin
                            aux_cnt <= 5'd0;
                            state   <= S_DRAIN;
                        end else begin
                            chunk_idx <= chunk_idx + 1'b1;  // next K-chunk, NO reset
                        end
                    end else begin
                        c_cyc <= c_cyc + 1'b1;
                    end
                end

                S_DRAIN: begin
                    busy       <= 1'b1;
                    tile_reset <= 1'b0;
                    if (aux_cnt >= DRAIN_CYCLES - 1) begin
                        state <= S_DONE;
                    end else begin
                        aux_cnt <= aux_cnt + 1'b1;
                    end
                end

                S_DONE: begin
                    done <= 1'b1;   // level-held until the next run
                    busy <= 1'b0;
                    if (start) start_run;
                end

                default: state <= S_IDLE;
            endcase
        end
    end

endmodule
