# Continuing a paused story-model training run on another machine

These steps move a paused `lm_train.py` run from one machine to another, for
example from a Mac to a Windows laptop with an NVIDIA GPU.

## 1. Set up the environment

Install Python 3.12.
Install PyTorch with the CUDA build for your GPU, using the selector at
pytorch.org (Get Started, pick your OS/CUDA version, run the given `pip
install torch` command).
Install the remaining dependencies: `pip install numpy sentencepiece`.

## 2. Get the code

Clone the repository.
Check out the branch: `git checkout feature/story-model`.

## 3. Get the pretokenized data

You need `model/.tinystories_cache/tok512/train.bin` and `val.bin`.
The simplest path is to copy those two files from the paused machine into
the same location on the new machine.
If you cannot copy them, rebuild them instead: run `python
model/tinystories_data.py` on the new machine.
Rebuilding downloads the TinyStories dataset and re-tokenizes it, so it is
slower than copying.

## 4. Do a short timing run first

Before touching the real checkpoint, confirm the new machine works with a
throwaway run into a scratch directory.
Run `python lm_train.py --iters 200 --out-dir /tmp/lm_scratch` from `model/`.
Confirm it prints eval lines with a `cuda_max_alloc_mb` field and a
reasonable `ms_per_iter`, then delete `/tmp/lm_scratch`.

## 5. Bring over the paused state

Copy `model/checkpoints/lm_train_state.pt` from the paused machine into
`model/checkpoints/` on the new machine.
Do not copy `lm_float.pt` or `lm_train_log.json` yet; resuming regenerates
them.

## 6. Resume the real run

Run `python lm_train.py --iters 100000 --resume` from `model/`.
The trainer auto-detects the CUDA GPU and continues from the saved
iteration.
Pass `--device cuda` explicitly if you want to be sure which device is used.

## 7. Pause when needed

Press Ctrl+C to pause.
The trainer finishes the current optimizer step, atomically saves
`lm_train_state.pt`, and exits cleanly.
Windows cannot send a SIGTERM signal, so Ctrl+C is the way to pause on
Windows; it works the same way on Mac and Linux.

## 8. Keep the laptop from sleeping mid-run

Disable Windows sleep for the duration of the run.
Settings > System > Power & battery > Screen and sleep, set both "on
battery" and "plugged in" sleep timers to Never.
A laptop that sleeps mid-run pauses the process without it seeing a signal,
which can leave partial state or a stalled run.

## 9. Bring the results back

When the run finishes (or you are done training for now), copy these three
files back from `model/checkpoints/` on the training machine:
`lm_float.pt`, `lm_train_state.pt`, and `lm_train_log.json`.
