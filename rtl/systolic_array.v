`timescale 1ns / 1ps

// rtl/systolic_array.v -- NxN output-stationary systolic array of `pe` MAC
// cells (rtl/pe.v). PE(i,j) accumulates C[i][j] = sum_k A[i][k]*B[k][j].
// A streams eastward, skewed per-row by i cycles before entering row i's
// west edge. B streams southward, skewed per-column by j cycles before
// entering column j's north edge. valid_in is broadcast identically (not
// individually skewed) to every PE -- correct because the skewed
// zero-padding on a_west/b_north makes both operands of every PE exactly
// zero outside that PE's own N-cycle accumulation window (see
// docs/decisions.md for the full derivation; empirically confirmed by
// simulating a 3x3 case against a hand-computed matrix product).
module systolic_array #(
    parameter N = 8
) (
    input  wire                     clk,
    input  wire                     reset,
    input  wire                     valid_in,     // broadcast, same cycle to every PE
    input  wire signed [8*N-1:0]    a_west,       // row i lane = a_west[8*i +: 8]
    input  wire signed [8*N-1:0]    b_north,      // col j lane = b_north[8*j +: 8]
    output wire signed [32*N*N-1:0] acc_out       // PE(i,j) = acc_out[32*(i*N+j) +: 32]
);

    // a_mesh[i][j] feeds PE(i,j)'s a_in from the west; a_mesh[i][N] is row
    // i's (currently unused -- see docs/decisions.md) east-edge output.
    // b_mesh[i][j] feeds PE(i,j)'s b_in from the north; b_mesh[N][j] is
    // column j's (currently unused) south-edge output.
    wire signed [7:0] a_mesh [0:N-1][0:N];
    wire signed [7:0] b_mesh [0:N][0:N-1];

    genvar r, c, i, j;

    generate
        for (r = 0; r < N; r = r + 1) begin : west_feed
            assign a_mesh[r][0] = a_west[8*r +: 8];
        end
        for (c = 0; c < N; c = c + 1) begin : north_feed
            assign b_mesh[0][c] = b_north[8*c +: 8];
        end

        for (i = 0; i < N; i = i + 1) begin : row
            for (j = 0; j < N; j = j + 1) begin : col
                pe pe_inst (
                    .clk      (clk),
                    .reset    (reset),
                    .valid_in (valid_in),
                    .a_in     (a_mesh[i][j]),
                    .b_in     (b_mesh[i][j]),
                    .acc_out  (acc_out[32*(i*N+j) +: 32]),
                    .a_out    (a_mesh[i][j+1]),
                    .b_out    (b_mesh[i+1][j])
                );
            end
        end
    endgenerate

endmodule
