`timescale 1ns / 1ps

// tb/accel/accel_tb.v -- test harness for rtl/accel.v that generates the
// clock itself (10 ns period). A cocotb Clock toggles clk from Python on
// every edge, which made CIFAR-sized runs 5x slower under Verilator; here the
// simulator runs free between the testbench's own triggers.
module accel_tb #(
    parameter W  = 2,
    parameter H  = 2,
    parameter AW = 2
) (
    input  wire        rst,
    input  wire        start,
    output reg         clk,
    output wire        done,
    output wire        error,
    output wire [11:0] error_pc
);

    initial clk = 1'b0;
    always #5 clk = ~clk;

    accel #(.W(W), .H(H), .AW(AW)) accel (
        .clk(clk), .rst(rst), .start(start), .done(done), .error(error), .error_pc(error_pc));

endmodule
