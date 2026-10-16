import { z } from "zod";

const int = z.number().int();

const categories = z.object({
  "weight matmuls": int,
  attention: int,
  VPU: int,
  other: int,
});

export const lmTraceSchema = z.object({
  config: z.object({
    mesh: z.string(),
    inv_temp: int,
    steps: int,
    prompt_ids: z.array(int),
    seeds: z.array(int),
    float_val_loss: z.number(),
    int_val_loss: z.number(),
  }),
  stories: z.array(
    z.object({
      tokens: z.array(int),
      text: z.string(),
      end_step: int.nullable(),
    }),
  ),
  steps: z.array(
    z.object({
      step: int,
      cycles: int,
      categories,
      tile_busy: z.array(int),
    }),
  ),
  meshes: z.record(z.string(), z.object({ cycles: int, cycles_per_step: z.number() })),
  attention: z.object({
    source: z.string(),
    story: int,
    units: z.string(),
    layout: z.string(),
    probs: z.array(z.array(z.array(z.array(int)))),
  }),
});

export const lmRunsSchema = z.object({
  runs: z.record(
    z.string(),
    z.object({
      case: z.string(),
      mesh: z.string(),
      steps: int,
      inv_temp: int,
      cycles: int,
      slots: int,
      blocks: int,
      slot_utilization: z.number(),
    }),
  ),
});

export const lmVocabSchema = z.object({
  bos: int,
  eos: int,
  pieces: z.array(z.string()),
});

export const cifarSchema = z.object({
  images: int,
  int8_accuracy: z.number(),
  float_accuracy: z.number(),
  mesh: z.string(),
  cycles: int,
  cycles_per_image: z.number(),
  slot_utilization: z.number(),
});

export const scalingSchema = z.array(
  z.object({
    mesh: z.string(),
    images: int,
    cycles: int,
    cycles_per_image: z.number(),
    slot_utilization: z.number(),
  }),
);

export function parseInput<S extends z.ZodType>(name: string, schema: S, raw: unknown): z.infer<S> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const lines = result.error.issues.map(
    (issue) => `  field "${issue.path.join(".") || "(root)"}": ${issue.message}`,
  );
  throw new Error(`docs/perf/${name} does not match the expected shape:\n${lines.join("\n")}`);
}
