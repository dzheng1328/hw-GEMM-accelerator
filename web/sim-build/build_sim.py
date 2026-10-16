#!/usr/bin/env python3
"""Rebuilds the committed simulator artifacts. Task 3 replaces this with the full tool."""

import sys

import data

if __name__ == "__main__":
    if sys.argv[1:] != ["data"]:
        sys.exit("usage: build_sim.py data")
    data.write_data()
