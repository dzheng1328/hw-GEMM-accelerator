`timescale 1ns / 1ps

// rtl/cmd_perf.v -- the command processor's performance counters (milestone
// 4.2), in rtl/node_perf.v's style: free-running 32-bit counters cleared only
// by reset, read by hierarchy from cocotb, measured by snapshot and
// subtraction. They feed the scaling study (4.2f): where node (0,0)'s command
// processor spends a run.
//
// Six of them partition the run cycles. All six are measured at one
// interface, node (0,0)'s injection port, so every run cycle lands in exactly
// one of them and they sum to run_cyc:
//   slot_cyc       an OPERAND flit injected (valid && ready)
//   go_cyc         a GO flit injected
//   inj_stall_cyc  a flit waiting at the port (valid && !ready)
//   and, with no flit at the port, the first of these that applies:
//   wait_cyc       WAIT or END waiting for write-back or the DMA to drain
//   credit_cyc     a returning BLOCK waiting for its tile's write-back FIFO
//   other_cyc      anything else: the DMA pipeline filling, non-BLOCK
//                  commands, the command processor's own latency
// Counting flits where the DMA hands them to rtl/flit_pack.v instead would
// not partition the cycles: flit_pack's skid buffer accepts a beat whether
// or not the port is stalled (4.3a follow-up, docs/learnings.md).
module cmd_perf (
    input  wire clk,
    input  wire rst,
    input  wire run,           // cmd_seq running (start to done)
    input  wire block,         // a BLOCK issued to the DMA
    input  wire inj_valid,     // node (0,0)'s injection port
    input  wire inj_ready,
    input  wire inj_go,        // the flit at the port is a GO flit
    input  wire wait_stall,    // WAIT or END waiting for write-back or the DMA to drain
    input  wire credit_stall,  // a returning BLOCK waiting for its tile's write-back FIFO
    input  wire wb_word        // an activation word written back
);

    reg [31:0] run_cyc, blocks, slot_cyc, go_cyc, inj_stall_cyc, wait_cyc, credit_cyc, other_cyc, wb_words;

    wire xfer    = run && inj_valid && inj_ready;
    wire stall   = run && inj_valid && !inj_ready;
    wire idle    = run && !inj_valid;
    wire c_slot  = xfer && !inj_go;
    wire c_go    = xfer && inj_go;
    wire c_wait  = idle && wait_stall;
    wire c_cred  = idle && !wait_stall && credit_stall;
    wire c_other = idle && !wait_stall && !credit_stall;

    always @(posedge clk) begin
        if (rst) begin
            run_cyc       <= 32'd0;
            blocks        <= 32'd0;
            slot_cyc      <= 32'd0;
            go_cyc        <= 32'd0;
            inj_stall_cyc <= 32'd0;
            wait_cyc      <= 32'd0;
            credit_cyc    <= 32'd0;
            other_cyc     <= 32'd0;
            wb_words      <= 32'd0;
        end else begin
            run_cyc       <= run_cyc       + {31'd0, run};
            blocks        <= blocks        + {31'd0, block};
            slot_cyc      <= slot_cyc      + {31'd0, c_slot};
            go_cyc        <= go_cyc        + {31'd0, c_go};
            inj_stall_cyc <= inj_stall_cyc + {31'd0, stall};
            wait_cyc      <= wait_cyc      + {31'd0, c_wait};
            credit_cyc    <= credit_cyc    + {31'd0, c_cred};
            other_cyc     <= other_cyc     + {31'd0, c_other};
            wb_words      <= wb_words      + {31'd0, wb_word};
        end
    end

endmodule
