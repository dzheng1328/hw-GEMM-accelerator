`timescale 1ns / 1ps

// rtl/cmd_perf.v -- the command processor's performance counters (milestone
// 4.2), in rtl/node_perf.v's style: free-running 32-bit counters cleared only
// by reset, read by hierarchy from cocotb, measured by snapshot and
// subtraction. They feed the scaling study (4.2f): where node (0,0)'s command
// processor spends a run.
module cmd_perf (
    input  wire clk,
    input  wire rst,
    input  wire run,           // cmd_seq running (start to done)
    input  wire block,         // a BLOCK issued to the DMA
    input  wire slot,          // an OPERAND beat accepted from the DMA
    input  wire inj_stall,     // a flit waiting at node (0,0)'s injection port
    input  wire wait_stall,    // WAIT or END waiting for write-back
    input  wire credit_stall,  // a returning BLOCK waiting for its tile's write-back FIFO
    input  wire wb_word        // an activation word written back
);

    reg [31:0] run_cyc, blocks, slot_cyc, inj_stall_cyc, wait_cyc, credit_cyc, wb_words;

    always @(posedge clk) begin
        if (rst) begin
            run_cyc       <= 32'd0;
            blocks        <= 32'd0;
            slot_cyc      <= 32'd0;
            inj_stall_cyc <= 32'd0;
            wait_cyc      <= 32'd0;
            credit_cyc    <= 32'd0;
            wb_words      <= 32'd0;
        end else begin
            run_cyc       <= run_cyc       + {31'd0, run};
            blocks        <= blocks        + {31'd0, block};
            slot_cyc      <= slot_cyc      + {31'd0, slot};
            inj_stall_cyc <= inj_stall_cyc + {31'd0, inj_stall};
            wait_cyc      <= wait_cyc      + {31'd0, wait_stall};
            credit_cyc    <= credit_cyc    + {31'd0, credit_stall};
            wb_words      <= wb_words      + {31'd0, wb_word};
        end
    end

endmodule
