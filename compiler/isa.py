"""The milestone 4.2 command processor's instruction set
(docs/specs/2026-09-25-command-processor-cifar10-design.md, section 2):
command encoding, the register map, memory sizes, and the layer shapes the
compiler guarantees. The single source for the compiler, the golden
executor, and the testbenches' disassembler."""

from dataclasses import dataclass

# Opcodes in [63:60]; 0 is invalid, so zeroed program memory faults.
ADD, BLOCK, WAIT, LOOP, ENDLOOP, END = 1, 2, 3, 4, 5, 6
OP_NAMES = {ADD: "ADD", BLOCK: "BLOCK", WAIT: "WAIT", LOOP: "LOOP", ENDLOOP: "ENDLOOP", END: "END"}

# Hardware-defined registers; r0 reads as zero.
(ZERO, IN_BASE, OUT_BASE, W_BASE, CIN_LOG2, H_LOG2, W_LOG2, WOUT_LOG2,
 STRIDE, PAD, KSIZE, KS, BIAS, OSTRIDE) = range(14)
# Free registers the compiler uses as per-image pointers: the input's byte
# address and the final output's word address.
IMG_IN, IMG_OUT = 14, 15
N_REGS = 16
REG_MASK = 0xFFFF_FFFF

PROGRAM_WORDS = 4096
WEIGHT_WORDS = 32768
ACT_WORDS = 131072
# Word-interleaved (bank = word mod 4): a stride-2 gather window spans at
# most 3 consecutive words, which then sit in 3 different banks.
ACT_BANKS = 4
SLOTS_PER_ROUND = 64
TILE = 8
MAX_MESH = 8


@dataclass(frozen=True)
class Block:
    """One round of one output block (spec: BLOCK)."""

    tile_x: int
    tile_y: int
    group: int
    pixel_block: int
    round: int
    ky0: int = 0
    kx0: int = 0
    acc_keep: bool = False
    no_ret: bool = False
    requant: bool = False
    relu: bool = False
    sh: int = 0
    m: int = 0


# BLOCK field -> (lsb, width); one-bit fields decode as bool.
BLOCK_FIELDS = {
    "tile_x": (57, 3), "tile_y": (54, 3), "group": (48, 6), "pixel_block": (40, 8),
    "round": (33, 7), "ky0": (30, 3), "kx0": (27, 3), "acc_keep": (26, 1),
    "no_ret": (25, 1), "requant": (24, 1), "relu": (23, 1), "sh": (17, 6), "m": (0, 16),
}
FLAGS = ("acc_keep", "no_ret", "requant", "relu")


def _fit(value, width, name):
    v = int(value)
    if not 0 <= v < (1 << width):
        raise ValueError(f"{name}={value} does not fit in {width} bits")
    return v


def add(dst, src, imm):
    """dst = src + imm (mod 2**32)."""
    if not -(1 << 31) <= imm < (1 << 32):
        raise ValueError(f"imm={imm} does not fit in 32 bits")
    return (ADD << 60) | (_fit(dst, 4, "dst") << 56) | (_fit(src, 4, "src") << 52) | (imm & REG_MASK)


def block(b):
    word = BLOCK << 60
    for name, (lsb, width) in BLOCK_FIELDS.items():
        word |= _fit(getattr(b, name), width, name) << lsb
    return word


def wait():
    return WAIT << 60


def loop(count):
    if count < 1:
        raise ValueError("LOOP count must be at least 1")
    return (LOOP << 60) | _fit(count, 16, "count")


def endloop():
    return ENDLOOP << 60


def end():
    return END << 60


def decode(word):
    """(opcode, operands): (dst, src, imm) for ADD, a Block for BLOCK, the
    count for LOOP, None for the rest and for invalid opcodes."""
    word = int(word)
    op = word >> 60
    if op == ADD:
        return op, ((word >> 56) & 0xF, (word >> 52) & 0xF, word & REG_MASK)
    if op == BLOCK:
        f = {n: (word >> lsb) & ((1 << w) - 1) for n, (lsb, w) in BLOCK_FIELDS.items()}
        return op, Block(**{n: bool(v) if BLOCK_FIELDS[n][1] == 1 else v for n, v in f.items()})
    if op == LOOP:
        return op, word & 0xFFFF
    return op, None


def disassemble(word):
    op, arg = decode(word)
    if op not in OP_NAMES:
        return f"INVALID {int(word):016x}"
    if op == ADD:
        return f"ADD r{arg[0]}, r{arg[1]}, {arg[2]}"
    if op == BLOCK:
        flags = ",".join(f for f in FLAGS if getattr(arg, f))
        return (f"BLOCK tile=({arg.tile_x},{arg.tile_y}) g={arg.group} pb={arg.pixel_block} r={arg.round} "
                f"tap0=({arg.ky0},{arg.kx0}) m={arg.m} sh={arg.sh}" + (f" {flags}" if flags else ""))
    if op == LOOP:
        return f"LOOP {arg}"
    return OP_NAMES[op]


class ShapeError(ValueError):
    """A layer outside the shapes the hardware supports (spec section 1)."""


def is_pow2(n):
    return n >= 1 and n & (n - 1) == 0


def log2(n):
    return int(n).bit_length() - 1


def conv_out(size, ksize, stride, pad):
    return (size + 2 * pad - ksize) // stride + 1


def check_shape(name, cin, h, w, cout, ksize, stride, pad):
    """(Hout, Wout) of a layer, or ShapeError naming the violated rule."""

    def bad(msg):
        raise ShapeError(f"{name}: {msg}")

    if not (is_pow2(cin) and is_pow2(h) and is_pow2(w)):
        bad(f"Cin, H, W must be powers of two, got {cin}, {h}, {w}")
    if w % TILE:
        bad(f"W={w} must be a multiple of 8 so every row starts word-aligned")
    if stride not in (1, 2) or pad not in (0, 1):
        bad(f"stride must be 1 or 2 and pad 0 or 1, got {stride}, {pad}")
    if not 1 <= ksize <= TILE:
        bad(f"KSIZE={ksize} must be 1..8")
    if cout % TILE or not TILE <= cout <= 512:
        bad(f"Cout={cout} must be a multiple of 8 in 8..512")
    hout, wout = conv_out(h, ksize, stride, pad), conv_out(w, ksize, stride, pad)
    if hout < 1 or wout < 1:
        bad(f"kernel {ksize} does not fit a {h}x{w} input")
    if wout == 1:
        if hout != 1:
            bad(f"an output with Wout=1 must have Hout=1, got {hout}")
    elif not (is_pow2(wout) and wout >= TILE):
        bad(f"Wout={wout} must be 1 or a power of two >= 8")
    if hout * wout > 256 * TILE:
        bad(f"{hout * wout // TILE} pixel blocks exceed the 256 a BLOCK can address")
    return hout, wout
