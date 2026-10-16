import harness


def test_render_substitutes_every_token_and_has_one_word_per_node():
    for w, h in [(1, 1), (2, 2), (4, 4)]:
        nn = w * h
        cpp = harness.render(w, h)
        assert "@" not in cpp
        assert f"constexpr int NN = {nn};" in cpp
        assert f"words[{nn - 1}] = NODE_WORD({nn - 1});" in cpp
        assert f"words[{nn}] =" not in cpp
        assert f"perf[{4 + nn - 1}] = " in cpp
        assert f"perf[{4 + nn}] = " not in cpp


def test_render_exports_the_c_api_the_chip_wrapper_calls():
    cpp = harness.render(2, 2)
    for name in ["sim_init", "sim_load", "sim_set_input", "sim_run", "sim_trace_ptr", "sim_trace_bytes",
                 "sim_record_bytes", "sim_copy_act", "sim_perf", "sim_free"]:
        assert f"EMSCRIPTEN_KEEPALIVE" in cpp and f" {name}(" in cpp, name


def test_the_record_layout_matches_the_documented_one():
    cpp = harness.render(2, 2)
    assert "RECORD_BYTES = 6 + 2 * NN" in cpp
    assert "(FLIT_TYPE(NODE(i, lcl_in_flit)) << 14)" in cpp


def test_the_context_gets_command_args_because_sim_mem_reads_plusargs():
    # rtl/sim_mem.v calls $value$plusargs; Verilator aborts the first eval unless commandArgs was called.
    cpp = harness.render(2, 2)
    assert cpp.index("commandArgs(") < cpp.index("new Vaccel(ctx)")
