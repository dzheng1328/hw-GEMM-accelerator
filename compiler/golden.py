"""ISA-level golden executor, level 2 of the verification ladder (spec
section 4): runs a program on the program, weight, and activation memory
images with the spec's gather, requant, and write-back semantics. The RTL's
final activation memory must equal this executor's bit for bit.

It executes commands one at a time and completes each BLOCK at once, so it
also enforces the ordering rules the RTL relies on but does not check: a
BLOCK must not read a word that an outstanding returning BLOCK (one not yet
covered by a WAIT or END) writes, and two outstanding BLOCKs must not write
the same word."""

import numpy as np

import isa
from fixedpoint import requant


class GoldenError(Exception):
    """A hardware fault, or a broken ordering rule, at program counter pc."""

    def __init__(self, pc, msg):
        super().__init__(f"pc {pc}: {msg}")
        self.pc = pc


def _load(words, depth, name):
    words = np.asarray(words, dtype="<u8")
    if len(words) > depth:
        raise ValueError(f"{name} image has {len(words)} words; memory holds {depth}")
    mem = np.zeros(depth, dtype="<u8")
    mem[: len(words)] = words
    return mem


class Golden:
    def __init__(self, mesh_w, mesh_h, program, weights, act):
        self.mesh = (mesh_w, mesh_h)
        self.prog = _load(program, isa.PROGRAM_WORDS, "program")
        self.wmem = _load(weights, isa.WEIGHT_WORDS, "weight")
        self.act = _load(act, isa.ACT_WORDS, "activation").view(np.uint8)
        self.regs = [0] * isa.N_REGS
        self.acc = {}
        # pc of the outstanding BLOCK that writes each activation word, or -1.
        self.pending = np.full(isa.ACT_WORDS, -1, dtype=np.int64)
        self.pending_words = []

    def run(self, max_commands=10_000_000):
        """Execute from pc 0 through END; returns the activation memory bytes."""
        pc, loop = 0, None
        for _ in range(max_commands):
            if pc >= isa.PROGRAM_WORDS:
                raise GoldenError(pc, "ran past the end of program memory")
            op, arg = isa.decode(int(self.prog[pc]))
            nxt = pc + 1
            if op == isa.ADD:
                dst, src, imm = arg
                if dst:
                    self.regs[dst] = (self.regs[src] + imm) & isa.REG_MASK
            elif op == isa.BLOCK:
                self._block(pc, arg)
            elif op == isa.WAIT:
                self._retire()
            elif op == isa.LOOP:
                if loop is not None:
                    raise GoldenError(pc, "LOOP inside an active loop")
                if arg == 0:
                    raise GoldenError(pc, "LOOP count 0")
                loop = [nxt, arg]
            elif op == isa.ENDLOOP:
                if loop is None:
                    raise GoldenError(pc, "ENDLOOP without an active LOOP")
                loop[1] -= 1
                if loop[1]:
                    nxt = loop[0]
                else:
                    loop = None
            elif op == isa.END:
                self._retire()
                return self.act
            else:
                raise GoldenError(pc, f"invalid opcode {op}")
            pc = nxt
        raise GoldenError(pc, f"no END within {max_commands} commands")

    def _retire(self):
        for words in self.pending_words:
            self.pending[words] = -1
        self.pending_words.clear()

    def _block(self, pc, b):
        if b.tile_x >= self.mesh[0] or b.tile_y >= self.mesh[1]:
            raise GoldenError(pc, f"tile ({b.tile_x}, {b.tile_y}) is outside the {self.mesh[0]}x{self.mesh[1]} mesh")
        a, bmat = self.operands(b, pc)
        tile = (b.tile_x, b.tile_y)
        acc = self.acc.get(tile, np.zeros((8, 8), np.int64)) if b.acc_keep else np.zeros((8, 8), np.int64)
        acc = acc + a.T @ bmat
        if acc.max() >= 2**31 or acc.min() < -(2**31):
            raise GoldenError(pc, "accumulator outside int32")
        self.acc[tile] = acc
        if not b.no_ret:
            self._write_back(pc, b, acc)

    def operands(self, b, pc=0):
        """(a, bmat), each (n, 8) int64: the A columns and B rows the DMA
        streams for BLOCK b's round under the current registers and memories
        (row k = slot 64 * round + k). Faults like the BLOCK itself would."""
        ks = self.regs[isa.KS]
        k0 = isa.SLOTS_PER_ROUND * b.round
        n = min(isa.SLOTS_PER_ROUND, ks - k0)
        if ks % isa.TILE or n <= 0:
            raise GoldenError(pc, f"round {b.round} is outside KS={ks} (a positive multiple of 8)")
        if self.regs[isa.KSIZE] == 0:
            raise GoldenError(pc, "KSIZE is 0")
        self._check_tap(pc, b, k0)
        return self._a_words(pc, b, ks, k0, n), self._gather(pc, b, k0, n)

    def _check_tap(self, pc, b, k0):
        """(ky0, kx0) must be the tap of the round's first slot, each below
        KSIZE, or (0, 0) for a round that starts in the bias slots: the DMA
        loads them into separate ky/kx counters and never checks them."""
        ksize, bias_start = self.regs[isa.KSIZE], self.regs[isa.BIAS] & 0xFFFF
        if k0 < bias_start:
            want = divmod(k0 >> self.regs[isa.CIN_LOG2], ksize)
        else:
            want = (0, 0)
        if (b.ky0, b.kx0) != want:
            raise GoldenError(pc, f"BLOCK tap ({b.ky0}, {b.kx0}) does not start round {b.round}; expected {want}")

    def _a_words(self, pc, b, ks, k0, n):
        """(n, 8): row k is slot k's A column, lane i = output channel 8g + i."""
        addr = self.regs[isa.W_BASE] + b.group * ks + k0 + np.arange(n)
        if addr[-1] >= isa.WEIGHT_WORDS:
            raise GoldenError(pc, "weight address past weight memory")
        return self.wmem[addr].view(np.int8).reshape(n, 8).astype(np.int64)

    def _gather(self, pc, b, k0, n):
        """(n, 8): row k is slot k's B row (spec: gather semantics)."""
        R = self.regs
        cin_log2, h_log2, w_log2, wout_log2 = R[isa.CIN_LOG2], R[isa.H_LOG2], R[isa.W_LOG2], R[isa.WOUT_LOG2]
        ksize, stride, pad = R[isa.KSIZE], R[isa.STRIDE], R[isa.PAD]
        bias_start, bias_val = R[isa.BIAS] & 0xFFFF, (R[isa.BIAS] >> 16) & 0xFF
        bias_val -= 256 if bias_val >= 128 else 0
        cmask = (1 << cin_log2) - 1
        j = np.arange(n)
        c = (k0 + j) & cmask
        # The DMA's tap counter: start at (ky0, kx0), advance when c wraps.
        tap = b.ky0 * ksize + b.kx0 + (((k0 & cmask) + j) >> cin_log2)
        ky, kx = tap // ksize, tap % ksize
        lane = np.arange(8)
        lane_ok = lane >= 0 if wout_log2 else lane == 0
        p = 8 * b.pixel_block + lane
        oy, ox = p >> wout_log2, p & ((1 << wout_log2) - 1)
        iy = oy[None, :] * stride + ky[:, None] - pad
        ix = ox[None, :] * stride + kx[:, None] - pad
        is_tap = (k0 + j < bias_start)[:, None]
        read = is_tap & lane_ok & (iy >= 0) & (iy < (1 << h_log2)) & (ix >= 0) & (ix < (1 << w_log2))
        addr = R[isa.IN_BASE] + (c[:, None] << (h_log2 + w_log2)) + (iy << w_log2) + ix
        out = np.zeros((n, 8), np.int64)
        words = addr >> 3
        span = np.where(read, words, -1).max(axis=1) - np.where(read, words, 1 << 62).min(axis=1)
        if (span >= isa.ACT_BANKS - 1).any():
            k = k0 + int(np.argmax(span >= isa.ACT_BANKS - 1))
            raise GoldenError(pc, f"slot {k} reads more than 3 consecutive words, past the one-cycle bank window")
        ra = addr[read]
        if ra.size:
            if ra.max() >= len(self.act):
                raise GoldenError(pc, "gather address past activation memory")
            writer = self.pending[ra >> 3]
            if (writer >= 0).any():
                word = int(ra[writer >= 0][0] >> 3)
                raise GoldenError(pc, f"reads activation word {word}, which the BLOCK at pc {self.pending[word]} writes, before a WAIT")
            out[read] = self.act[ra].view(np.int8)
        out[~is_tap & lane_ok] = bias_val
        return out

    def _write_back(self, pc, b, acc):
        out, ostride = self.regs[isa.OUT_BASE], self.regs[isa.OSTRIDE]
        rows = 8 * b.group + np.arange(8)
        if b.requant:
            words = out + rows * ostride + b.pixel_block
            data = np.ascontiguousarray(requant(acc, b.m, b.sh, b.relu).astype(np.int8)).view("<u8").reshape(-1)
        else:
            words = (out + (rows[:, None] * ostride + b.pixel_block) * 8 + np.arange(8)[None, :]).reshape(-1)
            data = acc.reshape(-1).astype(np.int64).view("<u8")
        if words.max() >= isa.ACT_WORDS:
            raise GoldenError(pc, "write-back address past activation memory")
        writer = self.pending[words]
        if (writer >= 0).any():
            word = int(words[writer >= 0][0])
            raise GoldenError(pc, f"writes activation word {word}, which the BLOCK at pc {self.pending[word]} also writes, before a WAIT")
        self.pending[words] = pc
        self.pending_words.append(words)
        self.act.view("<u8")[words] = data
