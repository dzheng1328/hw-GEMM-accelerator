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
// Operands live on wide preloaded buses (a_buf/b_buf), indexed by the FSM. That
// is a deliberate placeholder for a real operand-memory read port -- the natural
// thing a NoC/DMA feeds later. The outer loop over N-blocks (and the fresh reset
// each N-block gets, via a new `start` pulse) stays with the caller, the same
// way a DMA engine issues one descriptor per block.
module gemm_sequencer #(
    parameter N    = 8,
    parameter KMAX = 8   // max K-chunks the operand buffers can hold (layer 1 needs 8)
) (
    input  wire                          clk,
    input  wire                          rst,        // sync system reset -> force IDLE
    input  wire                          start,      // pulse to run one N-block
    input  wire [3:0]                    k_chunks,   // K-chunks in this N-block (1..KMAX)
    input  wire signed [8*N*N*KMAX-1:0]  a_buf,      // A chunks: elem (k,i,c) at 8*((k*N+i)*N+c)
    input  wire signed [8*N*N*KMAX-1:0]  b_buf,      // B chunks: elem (k,c,j) at 8*((k*N+c)*N+j)
    output reg                           tile_reset, // -> tile.reset (pulsed once per N-block)
    output reg                           feed_valid, // -> tile.in_valid
    output reg  signed [8*N-1:0]         a_col,      // -> tile.a_col (unskewed column of A_chunk)
    output reg  signed [8*N-1:0]         b_row,      // -> tile.b_row (unskewed row of B_chunk)
    output reg                           busy,
    output reg                           done        // latches high once the result is valid
);

    localparam P            = 3*N - 2;  // 22 -- one wave's cycle budget (matches feed_wave)
    localparam RST_CYCLES   = 2;        // cycles to hold tile_reset at N-block start
    localparam DRAIN_CYCLES = 2*N;      // slack for the final wave to flush feeder+array

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

    // ---- Combinational operand selection ----
    // a_col lane i = A_chunk[i][col], b_row lane j = B_chunk[col][j], where the
    // active column index is c_cyc during the feed window (clamped otherwise so
    // the dynamic part-select base stays in range; feed_valid gates it anyway).
    reg  [4:0] col_idx;
    integer li;
    always @* begin
        a_col = {8*N{1'b0}};
        b_row = {8*N{1'b0}};
        col_idx    = (c_cyc < N) ? c_cyc : 5'd0;
        feed_valid = (state == S_RUN) && (c_cyc < N);
        for (li = 0; li < N; li = li + 1) begin
            a_col[8*li +: 8] = a_buf[ 8*((chunk_idx*N + li)*N + col_idx) +: 8 ];
            b_row[8*li +: 8] = b_buf[ 8*((chunk_idx*N + col_idx)*N + li) +: 8 ];
        end
    end

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
