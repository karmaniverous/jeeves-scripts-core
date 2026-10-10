/**
 * @module config/people-schema
 *
 * The `people` config block (Decision 34): which accounts and email
 * addresses belong to one person. Grouping accounts is a decision we
 * make, so it is config; what each account says about itself (name,
 * email, bot flag) still comes from the channel (e.g. the Slack cache).
 */

import { z } from 'zod';

/** A person id: a lowercase slug (`jason-williscroft`). */
export const personIdSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'expected a lowercase slug like jason-williscroft',
  );

/** One account of a person on a channel (`slack` / `vc` / `U0123`). */
export const personAccountSchema = z.strictObject({
  /** Channel kind, as OpenClaw names it: `slack`, `telegram`, ... */
  channel: z.string().min(1),
  /** The channel account (gateway account id): `default`, `vc`, ... */
  account: z.string().min(1),
  /** The person's id on that account (Slack user id, ...). */
  id: z.string().min(1),
});

/** One account of a person. */
export type PersonAccount = z.infer<typeof personAccountSchema>;

/** One person. */
export const personSchema = z.strictObject({
  /** The name to show for this person everywhere. */
  name: z.string().min(1),
  /** Their email addresses (matched case-insensitively). */
  emails: z.array(z.email()).optional(),
  /** Their channel accounts. */
  accounts: z.array(personAccountSchema).optional(),
});

/** One person. */
export type Person = z.infer<typeof personSchema>;

/** The key an account is matched on. */
export const accountKey = (a: PersonAccount): string =>
  JSON.stringify([a.channel, a.account, a.id]);

/** The `people` block: person id → person. No account or email belongs to two people. */
export const peopleSchema = z
  .record(personIdSchema, personSchema)
  .superRefine((people, ctx) => {
    const accountOwner = new Map<string, string>();
    const emailOwner = new Map<string, string>();
    const claim = (
      owners: Map<string, string>,
      key: string,
      personId: string,
      label: string,
      pathTail: (string | number)[],
    ) => {
      const owner = owners.get(key);
      if (owner !== undefined && owner !== personId)
        ctx.addIssue({
          code: 'custom',
          message: `${label} belongs to both "${owner}" and "${personId}"`,
          path: [personId, ...pathTail],
        });
      else owners.set(key, personId);
    };
    for (const [personId, person] of Object.entries(people)) {
      person.accounts?.forEach((a, i) => {
        claim(
          accountOwner,
          accountKey(a),
          personId,
          `account ${a.channel}/${a.account}/${a.id}`,
          ['accounts', i],
        );
      });
      person.emails?.forEach((e, i) => {
        claim(emailOwner, e.toLowerCase(), personId, `email ${e}`, [
          'emails',
          i,
        ]);
      });
    }
  });

/** The `people` block. */
export type People = z.infer<typeof peopleSchema>;
