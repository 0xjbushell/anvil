import { z } from "zod";

const fixtureDirectoryNameSchema = z
  .string()
  .min(1)
  .regex(/^(?!\.{1,2}$)[A-Za-z0-9][A-Za-z0-9._-]*$/, {
    message: "input must be a fixture directory name, not a path",
  });

const fileContentAssertionSchema = z
  .object({
    file: z.string().min(1),
    matches: z.string(),
  })
  .strict();

const fileRegexAssertionSchema = z
  .object({
    file: z.string().min(1),
    pattern: z.string(),
  })
  .strict();

const ScenarioExpectSchema = z
  .object({
    exit_code: z.number().int().optional(),
    files_exist: z.array(z.string()).optional(),
    files_absent: z.array(z.string()).optional(),
    files_contain: z.array(fileContentAssertionSchema).optional(),
    files_match_regex: z.array(fileRegexAssertionSchema).optional(),
    stdout_contains: z.array(z.string()).optional(),
    stderr_contains: z.array(z.string()).optional(),
    stdout_empty: z.boolean().optional(),
    stderr_empty: z.boolean().optional(),
    files_unchanged_from_input: z.boolean().optional(),
  })
  .strict();

const ptyExpectSendStepSchema = z
  .object({
    expect: z.string(),
    send: z.string(),
  })
  .strict();

const ptyExitStepSchema = z
  .object({
    expect_exit: z.number().int(),
  })
  .strict();

const ScenarioPtySchema = z
  .object({
    command: z.array(z.string()),
    script: z.array(z.union([ptyExpectSendStepSchema, ptyExitStepSchema])),
  })
  .strict();

export const ScenarioSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    input: fixtureDirectoryNameSchema,
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    pty: ScenarioPtySchema.optional(),
    expect: ScenarioExpectSchema,
  })
  .strict()
  .superRefine((scenario, context) => {
    const hasArgs = Object.prototype.hasOwnProperty.call(scenario, "args");
    const hasPty = Object.prototype.hasOwnProperty.call(scenario, "pty");

    if (hasArgs === hasPty) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["args"],
        message: "scenario must specify exactly one of `args` or `pty`",
      });
    }
  });

export type Scenario = z.infer<typeof ScenarioSchema>;

export function parseScenario(input: unknown): Scenario {
  return ScenarioSchema.parse(input);
}
