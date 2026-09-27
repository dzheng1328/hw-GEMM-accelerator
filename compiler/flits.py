"""The NoC flit format (rtl/noc_node.v header) in Python, for testbenches:
build and decode OPERAND and GO flits. A flit is {type[1:0], payload[PW-1:0],
dest_y[AW-1:0], dest_x[AW-1:0]}; AW, the coordinate width, is per mesh."""

N, ADDRW = 8, 6
PW = ADDRW + 16 * N
T_OPR, T_GO, T_RES, T_RES8 = 0, 1, 2, 3


def _fit(value, width, name):
    v = int(value)
    if not 0 <= v < (1 << width):
        raise ValueError(f"{name}={value} does not fit in {width} bits")
    return v


def lanes(values):
    """8 int8 lanes -> a 64-bit word, lane j in bits [8j+7:8j]."""
    return sum((int(v) & 0xFF) << (8 * j) for j, v in enumerate(values))


def unlanes(word):
    return tuple(((word >> (8 * j)) & 0xFF) - (256 if (word >> (8 * j)) & 0x80 else 0) for j in range(N))


def _flit(aw, ftype, payload, dest):
    x, y = dest
    return (ftype << (PW + 2 * aw)) | (payload << (2 * aw)) | (_fit(y, aw, "dest_y") << aw) | _fit(x, aw, "dest_x")


def operand(aw, dest, slot, a_col, b_row):
    payload = (_fit(slot, ADDRW, "slot") << (16 * N)) | (lanes(a_col) << (8 * N)) | lanes(b_row)
    return _flit(aw, T_OPR, payload, dest)


def go(aw, dest, k_chunks, m=0, sh=0, relu=False, requant=False, acc_keep=False, no_ret=False, ret=(0, 0)):
    payload = (_fit(k_chunks, 4, "k_chunks") | (_fit(ret[0], aw, "ret_x") << 4) | (_fit(ret[1], aw, "ret_y") << (4 + aw))
               | (_fit(m, 16, "m") << 16) | (_fit(sh, 6, "sh") << 32) | (int(relu) << 38) | (int(requant) << 39)
               | (int(acc_keep) << 40) | (int(no_ret) << 41))
    return _flit(aw, T_GO, payload, dest)


def decode(aw, flit):
    mask = (1 << aw) - 1
    dest = (flit & mask, (flit >> aw) & mask)
    payload = (flit >> (2 * aw)) & ((1 << PW) - 1)
    ftype = flit >> (PW + 2 * aw)
    if ftype == T_OPR:
        return {"type": "OPERAND", "dest": dest, "slot": payload >> (16 * N),
                "a": unlanes((payload >> (8 * N)) & ((1 << 64) - 1)), "b": unlanes(payload & ((1 << 64) - 1))}
    if ftype == T_GO:
        def bit(i):
            return bool((payload >> i) & 1)
        return {"type": "GO", "dest": dest, "k_chunks": payload & 0xF,
                "ret": ((payload >> 4) & mask, (payload >> (4 + aw)) & mask), "m": (payload >> 16) & 0xFFFF,
                "sh": (payload >> 32) & 0x3F, "relu": bit(38), "requant": bit(39), "acc_keep": bit(40), "no_ret": bit(41)}
    raise ValueError(f"flit type {ftype} is not OPERAND or GO")
