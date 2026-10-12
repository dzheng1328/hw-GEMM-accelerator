"""pytest for compiler/flits.py."""

import pytest

import flits


def test_operand_round_trip_and_layout():
    a, b = tuple(range(-4, 4)), tuple(range(100, 108))
    f = flits.operand(3, (5, 2), 41, a, b)
    assert f & 0b111 == 5 and (f >> 3) & 0b111 == 2 and f >> (flits.PW + 6) == flits.T_OPR
    payload = (f >> 6) & ((1 << flits.PW) - 1)
    assert payload >> 128 == 41 and payload & 0xFF == 100 and (payload >> 64) & 0xFF == 0xFC
    assert flits.decode(3, f) == {"type": "OPERAND", "dest": (5, 2), "slot": 41, "a": a, "b": b}


def test_go_matches_the_noc_node_layout():
    f = flits.go(2, (1, 3), 8, m=0xBEEF, sh=21, relu=True, requant=True, acc_keep=True, no_ret=False)
    payload = (f >> 4) & ((1 << flits.PW) - 1)
    assert payload & 0xF == 8 and (payload >> 16) & 0xFFFF == 0xBEEF and (payload >> 32) & 0x3F == 21
    assert (payload >> 38) & 0xF == 0b0111 and f >> (flits.PW + 4) == flits.T_GO
    assert flits.decode(2, f) == {"type": "GO", "dest": (1, 3), "k_chunks": 8, "ret": (0, 0), "m": 0xBEEF,
                                  "sh": 21, "relu": True, "requant": True, "acc_keep": True, "no_ret": False,
                                  "q16": False, "rows": 8}


def test_fields_out_of_range_are_rejected():
    with pytest.raises(ValueError):
        flits.operand(2, (4, 0), 0, (0,) * 8, (0,) * 8)
    with pytest.raises(ValueError):
        flits.operand(2, (0, 0), 64, (0,) * 8, (0,) * 8)


@pytest.mark.parametrize("rows", [1, 8])
def test_go_q16_and_row_limit_round_trip(rows):
    f = flits.go(2, (1, 3), 1, m=7, sh=9, q16=True, rows=rows)
    payload = (f >> 4) & ((1 << flits.PW) - 1)
    assert (payload >> 39) & 1 == 1, "q16 implies requant"
    assert (payload >> 42) & 1 == 1 and (payload >> 43) & 7 == rows - 1
    d = flits.decode(2, f)
    assert d["q16"] is True and d["requant"] is True and d["rows"] == rows


def test_go_without_q16_leaves_the_new_bits_at_their_defaults():
    payload = (flits.go(2, (0, 0), 1) >> 4) & ((1 << flits.PW) - 1)
    assert (payload >> 42) & 1 == 0 and (payload >> 43) & 7 == 7  # rows = 8


def test_go_rows_out_of_range_is_rejected():
    for rows in (0, 9):
        with pytest.raises(ValueError):
            flits.go(2, (0, 0), 1, rows=rows)


def test_result16_flit_decodes_with_its_flag():
    aw, dw = 2, 64
    data = sum((v & 0xFFFF) << (16 * j) for j, v in enumerate((-32768, -1, 0, 32767)))
    payload = (1 << (dw + 6 + 2 * aw)) | (3 << (dw + 6 + aw)) | (1 << (dw + 6)) | (5 << dw) | data  # q16, src (1, 3), idx 5
    f = (flits.T_RES8 << (flits.PW + 2 * aw)) | (payload << (2 * aw)) | (2 << aw) | 1
    d = flits.decode(aw, f)
    assert d == {"type": "RESULT8", "dest": (1, 2), "src": (1, 3), "idx": 5, "q16": True, "data": data}
    assert flits.unlanes16(d["data"]) == (-32768, -1, 0, 32767)
