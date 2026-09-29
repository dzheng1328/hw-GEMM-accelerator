`timescale 1ns / 1ps

// rtl/cmd_seq.v -- the command processor's sequencer (milestone 4.2,
// docs/specs/2026-09-25-command-processor-cifar10-design.md sections 2-3):
// fetch, decode, the sixteen registers, the one-level loop, and the
// ordering the hardware owns. compiler/golden.py is the reference and
// compiler/isa.py the encoding.
//
//   ADD      dst = src + imm; r0 stays zero
//   BLOCK    stall while the tile's write-back FIFO is full (returning
//            BLOCKs only), then start rtl/dma_gather.v, push the write-back
//            entry, and wait for the DMA's handoff
//   WAIT     stall until rtl/writeback.v and the DMA are idle
//   LOOP     push (pc + 1, count); ENDLOOP counts down and jumps back
//   END      stall until write-back and the DMA are idle, then raise done
//
// Fetch reads ahead. Program memory reads are registered, so the executing
// command is prog_rdata itself, and a command that completes reads its
// successor in the same cycle: one command per cycle, no fetch state.
// A BLOCK leaves prog_rdata -- and with it every BLOCK field the DMA reads --
// untouched until the DMA's handoff (the cycle it emits the BLOCK's last
// OPERAND beat; it carries what it still needs, including rtl/flit_pack.v's
// fields, down its own pipeline), and reads ahead in that cycle. The next
// BLOCK issues as soon as the DMA is ready, while this one drains, so the
// injection port sees no gap between BLOCKs. WAIT and END also wait for the
// DMA to drain: a no_ret BLOCK has no write-back entry to wait on.
// Registers change only on ADD, so they too hold while a BLOCK runs: the
// DMA's stable-input contract.
//
// Write-back entry: RESULT8 row i of group g, pixel block pb goes to word
// OUT_BASE + (8g + i) * OSTRIDE + pb, raw cell (i, j) to
// OUT_BASE + ((8g + i) * OSTRIDE + pb) * 8 + j. The entry is the i = j = 0
// word (base) and the per-row step (OSTRIDE, times 8 for raw), fixed at
// issue so a later ADD cannot move results still in flight.
//
// Faults -- an invalid opcode, a tile outside the W x H mesh, LOOP inside a
// loop, LOOP 0, ENDLOOP with no loop -- set the sticky error and error_pc
// and stop fetch; with FATAL (the default) the simulation ends with $fatal.
// start restarts a finished program (registers and loop cleared) but not a
// faulted one: that takes rst.
module cmd_seq #(
    parameter W      = 2,
    parameter H      = 2,
    parameter AW     = 2,              // mesh coordinate width in flits
    parameter ACT_BW = 15,             // activation bank address bits
    parameter WT_AW  = 15,             // weight memory address bits
    parameter PC_W   = 12,             // program memory address bits
    parameter FATAL  = 1,
    // Derived -- do not override.
    parameter NN     = W * H,
    parameter TIW    = (NN > 1) ? $clog2(NN) : 1,   // tile index bits
    parameter WA     = ACT_BW + 2                   // activation word address bits
) (
    input  wire                clk,
    input  wire                rst,
    input  wire                start,
    output reg                 done,
    output reg                 error,
    output reg  [PC_W-1:0]     error_pc,
    output wire                busy,          // running (rtl/cmd_perf.v)
    output wire                wait_stall,    // WAIT or END waiting on write-back or the DMA to drain
    output wire                credit_stall,  // returning BLOCK waiting on a full FIFO
    // Program memory read port.
    output wire                prog_re,
    output wire [PC_W-1:0]     prog_raddr,
    input  wire [63:0]         prog_rdata,
    // rtl/dma_gather.v: every output below holds from dma_start until dma_handoff.
    output wire                dma_start,
    input  wire                dma_busy,
    input  wire                dma_ready,     // the DMA accepts a start this cycle
    input  wire                dma_handoff,   // the DMA no longer reads the BLOCK's inputs
    output wire [5:0]          group,
    output wire [7:0]          pixel_block,
    output wire [6:0]          round,
    output wire [2:0]          ky0,
    output wire [2:0]          kx0,
    output wire [ACT_BW+4:0]   in_base,
    output wire [WT_AW-1:0]    w_base,
    output wire [3:0]          cin_log2,
    output wire [3:0]          h_log2,
    output wire [3:0]          w_log2,
    output wire [3:0]          wout_log2,
    output wire                stride2,
    output wire                pad,
    output wire [3:0]          ksize,
    output wire [15:0]         ks,
    output wire [15:0]         bias_start,
    output wire [7:0]          bias_val,
    // rtl/flit_pack.v.
    output wire [AW-1:0]       tile_x,
    output wire [AW-1:0]       tile_y,
    output wire                acc_keep,
    output wire                no_ret,
    output wire                requant,
    output wire                relu,
    output wire [5:0]          sh,
    output wire [15:0]         m,
    // rtl/writeback.v.
    output wire                wb_push,
    output wire [TIW-1:0]      wb_tile,
    output wire                wb_raw,
    output wire [WA-1:0]       wb_base,
    output wire [11:0]         wb_step,
    input  wire [(1<<TIW)-1:0] wb_full,
    input  wire                wb_idle
);

    localparam [3:0] OP_ADD = 4'd1, OP_BLOCK = 4'd2, OP_WAIT = 4'd3,
                     OP_LOOP = 4'd4, OP_ENDLOOP = 4'd5, OP_END = 4'd6;
    // Hardware-defined registers (compiler/isa.py).
    localparam R_IN_BASE = 1, R_OUT_BASE = 2, R_W_BASE = 3, R_CIN_LOG2 = 4, R_H_LOG2 = 5,
               R_W_LOG2 = 6, R_WOUT_LOG2 = 7, R_STRIDE = 8, R_PAD = 9, R_KSIZE = 10,
               R_KS = 11, R_BIAS = 12, R_OSTRIDE = 13;
    // S_HALT: stopped by END (done) or a fault (error).
    localparam [1:0] S_IDLE = 2'd0, S_EXEC = 2'd1, S_BLOCK = 2'd2, S_HALT = 2'd3;
    localparam [PC_W-1:0] PC_ONE = 1;
    localparam [31:0] W32 = W, H32 = H;

    reg [1:0]      state;
    reg [PC_W-1:0] pc;           // address of prog_rdata, the executing command
    reg [31:0]     regs [0:15];  // regs[0] is never written: r0 reads zero
    reg            loop_on;
    reg [PC_W-1:0] loop_pc;
    reg [15:0]     loop_left;

    // ---- Decode ----
    wire [63:0] insn  = prog_rdata;
    wire [3:0]  op    = insn[63:60];
    wire [3:0]  dst   = insn[59:56];
    wire [3:0]  src   = insn[55:52];
    wire [31:0] imm   = insn[31:0];
    wire [15:0] count = insn[15:0];
    wire [2:0]  bx    = insn[59:57];
    wire [2:0]  by    = insn[56:54];

    assign group       = insn[53:48];
    assign pixel_block = insn[47:40];
    assign round       = insn[39:33];
    assign ky0         = insn[32:30];
    assign kx0         = insn[29:27];
    assign acc_keep    = insn[26];
    assign no_ret      = insn[25];
    assign requant     = insn[24];
    assign relu        = insn[23];
    assign sh          = insn[22:17];
    assign m           = insn[15:0];
    assign tile_x      = bx[AW-1:0];
    assign tile_y      = by[AW-1:0];

    wire is_add     = (op == OP_ADD);
    wire is_block   = (op == OP_BLOCK);
    wire is_wait    = (op == OP_WAIT);
    wire is_loop    = (op == OP_LOOP);
    wire is_endloop = (op == OP_ENDLOOP);
    wire is_end     = (op == OP_END);
    wire exec       = (state == S_EXEC);

    wire [31:0]    tile_lin = {29'd0, by} * W32 + {29'd0, bx};
    wire [TIW-1:0] tile     = tile_lin[TIW-1:0];
    wire           tile_out = ({29'd0, bx} >= W32) || ({29'd0, by} >= H32);
    wire           unused_tile_lin = &{1'b0, tile_lin};

    wire bad_op   = !(is_add || is_block || is_wait || is_loop || is_endloop || is_end);
    wire bad_tile = is_block && tile_out;
    wire bad_loop = is_loop && (loop_on || count == 16'd0);
    wire bad_endl = is_endloop && !loop_on;
    wire fault    = exec && (bad_op || bad_tile || bad_loop || bad_endl);

    wire drain  = (is_wait || is_end) && (!wb_idle || dma_busy);
    wire credit = is_block && !no_ret && wb_full[tile];
    wire issue  = exec && !fault && is_block && !credit && dma_ready;
    wire step   = exec && !fault && !is_block && !drain;   // a non-BLOCK command completes

    wire            loop_back = is_endloop && (loop_left != 16'd1);
    wire [PC_W-1:0] pc_next   = loop_back ? loop_pc : pc + PC_ONE;
    wire            restart   = start && (state == S_IDLE || (state == S_HALT && done));

    assign prog_re    = restart || step || (state == S_BLOCK && dma_handoff);
    assign prog_raddr = restart ? {PC_W{1'b0}} : pc_next;

    assign busy         = (state == S_EXEC) || (state == S_BLOCK);
    assign wait_stall   = exec && !fault && drain;
    assign credit_stall = exec && !fault && credit;
    assign dma_start    = issue;

    // ---- Layer registers, narrowed to the DMA's ports ----
    assign in_base    = regs[R_IN_BASE][ACT_BW+4:0];
    assign w_base     = regs[R_W_BASE][WT_AW-1:0];
    assign cin_log2   = regs[R_CIN_LOG2][3:0];
    assign h_log2     = regs[R_H_LOG2][3:0];
    assign w_log2     = regs[R_W_LOG2][3:0];
    assign wout_log2  = regs[R_WOUT_LOG2][3:0];
    assign stride2    = (regs[R_STRIDE] == 32'd2);
    assign pad        = regs[R_PAD][0];
    assign ksize      = regs[R_KSIZE][3:0];
    assign ks         = regs[R_KS][15:0];
    assign bias_start = regs[R_BIAS][15:0];
    assign bias_val   = regs[R_BIAS][23:16];

    // ---- Write-back entry ----
    wire [8:0]    ostride = regs[R_OSTRIDE][8:0];   // at most 256 pixel blocks
    wire [WA-1:0] row0    = {{(WA-9){1'b0}}, group, 3'b000} * {{(WA-9){1'b0}}, ostride}
                          + {{(WA-8){1'b0}}, pixel_block};
    assign wb_push = issue && !no_ret;
    assign wb_tile = tile;
    assign wb_raw  = !requant;
    assign wb_base = regs[R_OUT_BASE][WA-1:0] + (wb_raw ? {row0[WA-4:0], 3'b000} : row0);
    assign wb_step = wb_raw ? {ostride, 3'b000} : {3'b000, ostride};

    // ---- Execute ----
    integer r;
    always @(posedge clk) begin
        if (rst) begin
            state     <= S_IDLE;
            done      <= 1'b0;
            error     <= 1'b0;
            error_pc  <= {PC_W{1'b0}};
            pc        <= {PC_W{1'b0}};
            loop_on   <= 1'b0;
            loop_pc   <= {PC_W{1'b0}};
            loop_left <= 16'd0;
            for (r = 0; r < 16; r = r + 1)
                regs[r] <= 32'd0;
        end else begin
            case (state)
                S_IDLE, S_HALT: if (restart) begin
                    state   <= S_EXEC;
                    pc      <= {PC_W{1'b0}};
                    done    <= 1'b0;
                    loop_on <= 1'b0;
                    for (r = 1; r < 16; r = r + 1)
                        regs[r] <= 32'd0;
                end
                S_EXEC: if (fault) begin
                    state    <= S_HALT;
                    error    <= 1'b1;
                    error_pc <= pc;
                end else if (issue) begin
                    state <= S_BLOCK;
                end else if (step) begin
                    pc <= pc_next;
                    if (is_add && dst != 4'd0)
                        regs[dst] <= regs[src] + imm;
                    if (is_loop) begin
                        loop_on   <= 1'b1;
                        loop_pc   <= pc + PC_ONE;
                        loop_left <= count;
                    end
                    if (is_endloop) begin
                        if (loop_back) loop_left <= loop_left - 16'd1;
                        else           loop_on   <= 1'b0;
                    end
                    if (is_end) begin
                        state <= S_HALT;
                        done  <= 1'b1;
                    end
                end
                S_BLOCK: if (dma_handoff) begin
                    state <= S_EXEC;
                    pc    <= pc_next;
                end
                default: ;
            endcase
        end
    end

`ifndef SYNTHESIS
    // The messages match compiler/golden.py's faults.
    always @(posedge clk) begin
        if (!rst && fault && FATAL != 0) begin
            if (bad_op)
                $fatal(1, "cmd_seq: invalid opcode %0d at pc %0d", op, pc);
            else if (bad_tile)
                $fatal(1, "cmd_seq: BLOCK tile (%0d, %0d) is outside the %0dx%0d mesh at pc %0d", bx, by, W, H, pc);
            else if (bad_loop && loop_on)
                $fatal(1, "cmd_seq: LOOP inside an active loop at pc %0d", pc);
            else if (bad_loop)
                $fatal(1, "cmd_seq: LOOP count 0 at pc %0d", pc);
            else
                $fatal(1, "cmd_seq: ENDLOOP without an active LOOP at pc %0d", pc);
        end
    end
`endif

endmodule
