/** One sample means at most one paid call. Saved responses are revalidated locally.
 * Validation and infrastructure errors both stop; repair requires an explicit new attempt. */
export async function validatedHistorySample<T, G extends {output: unknown}>(input: {
  readSaved: () => Promise<G | undefined>;
  generate: () => Promise<G>;
  save: (generated: G) => Promise<void>;
  validate: (output: unknown) => T;
}): Promise<T> {
  let generated = await input.readSaved();
  if (!generated) { generated = await input.generate(); await input.save(generated); }
  return input.validate(generated.output);
}
