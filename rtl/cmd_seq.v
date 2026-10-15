`timescale 1ns / 1ps

// rtl/cmd_seq.v -- the command processor's sequencer (milestone 4.2,
// docs/specs/2026-09-25-command-processor-cifar10-design.md sections 2-3):
// fetch, decode, the 32 registers, the four-deep loop stack, and the
// ordering the hardware owns. compiler/golden.py is the reference and
// compiler/isa.py the encoding.
//
//   ADD      dst = src + imm (r0-r15); r0 stays zero
//   ALU      dst = src op (src2 or imm), op in add, sub, shr (count mod 32),
//            and; 32-bit wrap; a destination of r0 is ignored (r0-r31)
//   BLOCK    stall while the tile's write-back FIFO is full (returning
//            BLOCKs only), then start rtl/dma_gather.v, push the write-back
//            entry, and wait for the DMA's handoff. A register-form BLOCK
//            (reg_form, bit 16) takes its round, row limit and result mode
//            from ROUND, ROWS and RMODE: it accumulates when acc_keep is set
//            or ROUND > 0, returns only on the last round of KS slots, and
//            returns RESULT8, RESULT16 or raw cells, the first ROWS + 1 rows.
//            The round, acc_keep, no_ret, requant, q16 and rows_m1 outputs
//            carry the resolved values.
//   WAIT     stall until rtl/writeback.v and the DMA are idle
//   LOOP     push (pc + 1, count); ENDLOOP counts down and jumps back
//   LOOPR    LOOP whose count is a register's value
//   END      stall until write-back and the DMA are idle, then raise done
//   VOP      drain like WAIT (every outstanding BLOCK written back), pulse
//            vop_start with the sub-op and its operand registers' values,
//            and wait for rtl/vpu.v's done; the next command starts after it.
//            The VPU owns the memories meanwhile (rtl/accel.v's mux), so
//            nothing else issues. A VPU fault is the command's fault. The
//            wait_stall output covers both the drain and the VPU's run, so
//            cmd_perf counts a VOP as wait_cyc; rtl/vpu_perf.v's counters
//            split it out (4.3g's report).
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
// Registers change only on ADD and ALU, and a command executes only after
// the previous BLOCK's handoff, so they hold while a BLOCK is in the DMA's
// input stage: the DMA's stable-input contract.
//
// Write-back entry: RESULT8 row i of group g, pixel block pb goes to word
// OUT_BASE + (8g + i) * OSTRIDE + pb, raw cell (i, j) to
// OUT_BASE + ((8g + i) * OSTRIDE + pb) * 8 + j. The entry is the i = j = 0
// word (base) and the per-row step (OSTRIDE, times 8 for raw), fixed at
// issue so a later ADD or ALU cannot move results still in flight.
//
// Faults -- an invalid opcode, an invalid VOP sub-op, a tile outside the W x H
// mesh, a register-form ROUND, ROWS or RMODE out of range, a fifth nested
// LOOP, LOOP 0, a LOOPR count of 0 or above 65535, ENDLOOP with no loop, and
// whatever rtl/vpu.v faults on -- set the sticky error and error_pc and stop
// fetch; with FATAL (the default) the simulation ends with $fatal.
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
    output wire                wait_stall,    // WAIT, END or VOP waiting on write-back or the DMA to drain, or a VOP running
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
    output wire [6:0]          round,         // resolved (register form: ROUND)
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
    output wire                acc_keep,      // resolved (register form: or ROUND > 0)
    output wire                no_ret,        // resolved (register form: not the last round)
    output wire                requant,       // resolved (register form: RMODE != raw)
    output wire                relu,
    output wire [5:0]          sh,
    output wire [15:0]         m,
    output wire                reg_form,      // the BLOCK's register-form bit
    output wire                q16,           // RESULT16 rows (also the write-back entry's mode)
    output wire [2:0]          rows_m1,       // rows the BLOCK returns, minus one (also the entry's)
    // rtl/writeback.v.
    output wire                wb_push,
    output wire [TIW-1:0]      wb_tile,
    output wire                wb_raw,
    output wire [WA-1:0]       wb_base,
    output wire [11:0]         wb_step,
    input  wire [(1<<TIW)-1:0] wb_full,
    input  wire                wb_idle,
    // rtl/vpu.v: vop_start is a single-cycle pulse, the operands are the
    // registers' values then, and the VPU latches them.
    output wire                vop_start,
    output wire [3:0]          vop_sub,
    output wire [31:0]         vop_ra,
    output wire [31:0]         vop_rb,
    output wire [31:0]         vop_rc,
    output wire [31:0]         vop_t,
    output wire [31:0]         vop_plen,
    output wire [31:0]         vop_inv_temp,
    input  wire                vop_done,      // the command finished (one cycle)
    input  wire                vop_fault      // sticky: the VPU rejected or failed the command
);

    localparam [3:0] OP_ADD = 4'd1, OP_BLOCK = 4'd2, OP_WAIT = 4'd3,
                     OP_LOOP = 4'd4, OP_ENDLOOP = 4'd5, OP_END = 4'd6,
                     OP_ALU = 4'd7, OP_LOOPR = 4'd8, OP_VOP = 4'd9;
    // Hardware-defined registers (compiler/isa.py).
    localparam R_IN_BASE = 1, R_OUT_BASE = 2, R_W_BASE = 3, R_CIN_LOG2 = 4, R_H_LOG2 = 5,
               R_W_LOG2 = 6, R_WOUT_LOG2 = 7, R_STRIDE = 8, R_PAD = 9, R_KSIZE = 10,
               R_KS = 11, R_BIAS = 12, R_OSTRIDE = 13,
               R_T = 16, R_PLEN = 17, R_INV_TEMP = 18, R_ROUND = 19, R_ROWS = 20, R_RMODE = 21;
    localparam [31:0] SLOTS_PER_ROUND = 32'd64;
    // S_HALT: stopped by END (done) or a fault (error). S_VOP: a VOP is running in the VPU.
    localparam [2:0] S_IDLE = 3'd0, S_EXEC = 3'd1, S_BLOCK = 3'd2, S_HALT = 3'd3, S_VOP = 3'd4;
    localparam [PC_W-1:0] PC_ONE = 1;
    localparam [31:0] W32 = W, H32 = H;

    reg [2:0]      state;
    reg [PC_W-1:0] pc;           // address of prog_rdata, the executing command
    reg [31:0]     regs [0:31];  // regs[0] is never written: r0 reads zero
    // The loop stack: depth entries, the innermost at index depth - 1.
    reg [2:0]      depth;
    reg [PC_W-1:0] loop_pc   [0:3];
    reg [15:0]     loop_left [0:3];

    // ---- Decode ----
    wire [63:0] insn  = prog_rdata;
    wire [3:0]  op    = insn[63:60];
    wire [3:0]  dst   = insn[59:56];
    wire [3:0]  src   = insn[55:52];
    wire [4:0]  a_dst = insn[59:55];   // ALU and LOOPR use five-bit register fields
    wire [4:0]  a_src = insn[54:50];
    wire [1:0]  a_op  = insn[49:48];
    wire        a_imm = insn[47];
    wire [4:0]  a_src2 = insn[46:42];
    wire [31:0] imm   = insn[31:0];
    wire [15:0] count = insn[15:0];
    wire [2:0]  bx    = insn[59:57];
    wire [2:0]  by    = insn[56:54];

    assign group       = insn[53:48];
    assign pixel_block = insn[47:40];
    assign ky0         = insn[32:30];
    assign kx0         = insn[29:27];
    assign relu        = insn[23];
    assign sh          = insn[22:17];
    assign m           = insn[15:0];
    assign reg_form    = insn[16];
    assign tile_x      = bx[AW-1:0];
    assign tile_y      = by[AW-1:0];

    wire is_add     = (op == OP_ADD);
    wire is_block   = (op == OP_BLOCK);
    wire is_wait    = (op == OP_WAIT);
    wire is_alu     = (op == OP_ALU);
    wire is_loop    = (op == OP_LOOP);
    wire is_loopr   = (op == OP_LOOPR);
    wire is_endloop = (op == OP_ENDLOOP);
    wire is_end     = (op == OP_END);
    wire is_vop     = (op == OP_VOP);
    wire exec       = (state == S_EXEC);

    wire [31:0]    tile_lin = {29'd0, by} * W32 + {29'd0, bx};
    wire [TIW-1:0] tile     = tile_lin[TIW-1:0];
    wire           tile_out = ({29'd0, bx} >= W32) || ({29'd0, by} >= H32);
    wire           unused_tile_lin = &{1'b0, tile_lin};

    // ---- ALU, loop count, loop stack ----
    wire [31:0] alu_x = regs[a_src];
    wire [31:0] alu_y = a_imm ? imm : regs[a_src2];
    reg  [31:0] alu_r;
    always @* begin
        case (a_op)
            2'd0:    alu_r = alu_x + alu_y;
            2'd1:    alu_r = alu_x - alu_y;
            2'd2:    alu_r = alu_x >> alu_y[4:0];
            default: alu_r = alu_x & alu_y;
        endcase
    end

    wire [31:0] loop_n   = is_loopr ? regs[a_dst] : {16'd0, count};   // the count a LOOP or LOOPR pushes
    wire        loop_any = is_loop || is_loopr;
    wire [1:0]  top      = depth[1:0] - 2'd1;                         // innermost loop, when depth > 0

    // ---- Register-form BLOCK: round, row limit and result mode from registers ----
    wire [31:0] rf_round = regs[R_ROUND];
    wire [31:0] rf_rows  = regs[R_ROWS];
    wire [31:0] rf_rmode = regs[R_RMODE];
    wire        rf_final = ({25'd0, rf_round[6:0]} + 32'd1) * SLOTS_PER_ROUND >= regs[R_KS];
    wire        rf       = is_block && reg_form;
    wire        bad_rf   = rf && (rf_round > 32'd127 || rf_rows > 32'd7 || rf_rmode > 32'd2);

    assign round    = reg_form ? rf_round[6:0] : insn[39:33];
    assign acc_keep = insn[26] || (reg_form && rf_round[6:0] != 7'd0);
    assign no_ret   = reg_form ? !rf_final : insn[25];
    assign requant  = reg_form ? (rf_rmode != 32'd0) : insn[24];
    assign q16      = reg_form && rf_rmode == 32'd2;
    assign rows_m1  = reg_form ? rf_rows[2:0] : 3'd7;

    wire [3:0] sub_op = insn[59:56];
    wire bad_op   = !(is_add || is_block || is_wait || is_loop || is_endloop || is_end || is_alu || is_loopr || is_vop);
    wire bad_sub  = is_vop && (sub_op == 4'd0 || sub_op > 4'd9);
    wire bad_tile = is_block && tile_out;
    wire bad_deep = loop_any && depth == 3'd4;
    wire bad_cnt  = loop_any && (loop_n == 32'd0 || loop_n > 32'd65535);
    wire bad_endl = is_endloop && depth == 3'd0;
    wire fault    = exec && (bad_op || bad_sub || bad_tile || bad_rf || bad_deep || bad_cnt || bad_endl);

    wire drain  = (is_wait || is_end || is_vop) && (!wb_idle || dma_busy);
    wire credit = is_block && !no_ret && wb_full[tile];
    wire issue  = exec && !fault && is_block && !credit && dma_ready;
    wire vop_go = exec && !fault && is_vop && !drain;
    wire step   = exec && !fault && !is_block && !is_vop && !drain;   // a command other than BLOCK or VOP completes
    wire in_vop = (state == S_VOP);
    wire vop_fin = in_vop && !vop_fault && vop_done;

    wire            loop_back = is_endloop && (loop_left[top] != 16'd1);
    wire [PC_W-1:0] pc_next   = loop_back ? loop_pc[top] : pc + PC_ONE;
    wire            restart   = start && (state == S_IDLE || (state == S_HALT && done));

    assign prog_re    = restart || step || vop_fin || (state == S_BLOCK && dma_handoff);
    assign prog_raddr = restart ? {PC_W{1'b0}} : pc_next;

    assign busy         = (state == S_EXEC) || (state == S_BLOCK) || in_vop;
    assign wait_stall   = (exec && !fault && drain) || in_vop;
    assign credit_stall = exec && !fault && credit;
    assign dma_start    = issue;

    // ---- VOP: the sub-op and its operand registers ----
    assign vop_start    = vop_go;
    assign vop_sub      = sub_op;
    assign vop_ra       = regs[insn[55:51]];
    assign vop_rb       = regs[insn[50:46]];
    assign vop_rc       = regs[insn[45:41]];
    assign vop_t        = regs[R_T];
    assign vop_plen     = regs[R_PLEN];
    assign vop_inv_temp = regs[R_INV_TEMP];

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
            depth     <= 3'd0;
            for (r = 0; r < 4; r = r + 1) begin
                loop_pc[r]   <= {PC_W{1'b0}};
                loop_left[r] <= 16'd0;
            end
            for (r = 0; r < 32; r = r + 1)
                regs[r] <= 32'd0;
        end else begin
            case (state)
                S_IDLE, S_HALT: if (restart) begin
                    state   <= S_EXEC;
                    pc      <= {PC_W{1'b0}};
                    done    <= 1'b0;
                    depth   <= 3'd0;
                    for (r = 1; r < 32; r = r + 1)
                        regs[r] <= 32'd0;
                end
                S_EXEC: if (fault) begin
                    state    <= S_HALT;
                    error    <= 1'b1;
                    error_pc <= pc;
                end else if (issue) begin
                    state <= S_BLOCK;
                end else if (vop_go) begin
                    state <= S_VOP;
                end else if (step) begin
                    pc <= pc_next;
                    if (is_add && dst != 4'd0)
                        regs[{1'b0, dst}] <= regs[{1'b0, src}] + imm;
                    if (is_alu && a_dst != 5'd0)
                        regs[a_dst] <= alu_r;
                    if (loop_any) begin
                        loop_pc[depth[1:0]]   <= pc + PC_ONE;
                        loop_left[depth[1:0]] <= loop_n[15:0];
                        depth                 <= depth + 3'd1;
                    end
                    if (is_endloop) begin
                        if (loop_back) loop_left[top] <= loop_left[top] - 16'd1;
                        else           depth          <= depth - 3'd1;
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
                S_VOP: if (vop_fault) begin
                    state    <= S_HALT;
                    error    <= 1'b1;
                    error_pc <= pc;
                end else if (vop_done) begin
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
            else if (bad_sub)
                $fatal(1, "cmd_seq: invalid VOP sub-op %0d at pc %0d", sub_op, pc);
            else if (bad_tile)
                $fatal(1, "cmd_seq: BLOCK tile (%0d, %0d) is outside the %0dx%0d mesh at pc %0d", bx, by, W, H, pc);
            else if (bad_rf && rf_round > 32'd127)
                $fatal(1, "cmd_seq: register-form ROUND %0d out of range at pc %0d", rf_round, pc);
            else if (bad_rf && rf_rows > 32'd7)
                $fatal(1, "cmd_seq: register-form ROWS %0d out of range (rows minus 1, 0..7) at pc %0d", rf_rows, pc);
            else if (bad_rf)
                $fatal(1, "cmd_seq: register-form RMODE %0d out of range at pc %0d", rf_rmode, pc);
            else if (bad_deep)
                $fatal(1, "cmd_seq: LOOP nested deeper than 4 at pc %0d", pc);
            else if (bad_cnt)
                $fatal(1, "cmd_seq: %s count %0d is not 1 to 65535 at pc %0d", is_loopr ? "LOOPR" : "LOOP", loop_n, pc);
            else
                $fatal(1, "cmd_seq: ENDLOOP without an active LOOP at pc %0d", pc);
        end
        if (!rst && in_vop && vop_fault && FATAL != 0)
            $fatal(1, "cmd_seq: the VPU faulted on the VOP at pc %0d", pc);
    end
`endif

endmodule
