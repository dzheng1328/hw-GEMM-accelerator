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
                                  "sh": 21, "relu": True, "requant": True, "acc_keep": True, "no_ret": False}


def test_fields_out_of_range_are_rejected():
    with pytest.raises(ValueError):
        flits.operand(2, (4, 0), 0, (0,) * 8, (0,) * 8)
    with pytest.raises(ValueError):
        flits.operand(2, (0, 0), 64, (0,) * 8, (0,) * 8)
