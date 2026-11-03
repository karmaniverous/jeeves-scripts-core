/**
 * @module admin/skill-review/proposals
 *
 * Pending Skill Workshop proposals, through the gateway's `skill_workshop`
 * tool: `list` (status `pending`), then `inspect` each for its metadata
 * and artifacts. Over HTTP the tool has no model context, so `inspect`
 * returns an artifact's text only when it fits OpenClaw's smallest
 * projection budget (about 2,800 characters). Artifact texts therefore
 * come from the Workshop store,
 * `<stateDir>/skill-workshop/proposals/<id>/generations/<gen>/`: the
 * generation whose PROPOSAL.md SHA-256 equals the proposal's `draftHash`,
 * each file checked against the size `inspect` reports. The store keeps
 * no generation metadata, so when several generations hold the same
 * draft (only support files changed) the hash can't say which is current:
 * PROPOSAL.md still comes from the store, support files only from
 * `inspect`. When the store can't supply a file, `inspect`'s inline text
 * is used if it fits; an artifact neither source supplies is marked
 * `missing`, as is any artifact whose path is absolute or leaves the
 * proposal (`..`), whatever its source. Read-only.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';

import { z } from 'zod';

import type { GatewayInvoker } from '../../lib/gateway-client.js';
import { isSafeRelative, type SkillFs } from './skill-fs.js';

/** The most proposals `skill_workshop list` returns (its schema maximum). */
export const LIST_LIMIT = 50;

/** The draft file every proposal has. */
export const PROPOSAL_FILE = 'PROPOSAL.md';

const listedSchema = z.looseObject({
  id: z.string().regex(/^[A-Za-z0-9._-]+$/),
  kind: z.string(),
  status: z.string(),
  title: z.string().default(''),
  description: z.string().default(''),
  skillName: z.string(),
  skillKey: z.string().optional(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
  scanState: z.string().default('unknown'),
});

const toolResultSchema = <T extends z.ZodType>(details: T) =>
  z.looseObject({
    content: z
      .array(z.looseObject({ type: z.string(), text: z.string().optional() }))
      .default([]),
    details,
  });

const listResultSchema = toolResultSchema(
  z.looseObject({ proposals: z.array(listedSchema) }),
);

const inspectResultSchema = toolResultSchema(
  z.looseObject({
    targetSkillFile: z.string().optional(),
    draftHash: z.string().optional(),
    inspect: z
      .looseObject({
        contentIncluded: z.boolean().default(false),
        availableArtifacts: z
          .array(z.looseObject({ path: z.string(), sizeBytes: z.number() }))
          .default([]),
      })
      .optional(),
  }),
);

/** One proposal artifact (PROPOSAL.md or a support file). */
export interface ProposalArtifact {
  /** Path relative to the proposal (`PROPOSAL.md`, `scripts/x.cjs`). */
  path: string;
  /** Size the Workshop reports. */
  sizeBytes: number;
  /** Full text, unless missing. */
  content?: string;
  /** Where the text came from. */
  source: 'gateway' | 'store' | 'missing';
}

/** A pending proposal with its artifacts. */
export type PendingProposal = z.infer<typeof listedSchema> & {
  /** The live SKILL.md an update targets (or a create would write). */
  targetSkillFile?: string;
  /** SHA-256 of the draft. */
  draftHash?: string;
  /** PROPOSAL.md first, then support files. */
  artifacts: ProposalArtifact[];
};

/** What gathering proposals needs. */
export interface ProposalEnv {
  /** Gateway tool invoker. */
  invoke: GatewayInvoker;
  /** File system port (Workshop store). */
  fs: SkillFs;
  /** OpenClaw's state directory. */
  stateDir: string;
}

const sha256 = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

/** The text after `--- <path> ---` in an inspect result, if included. */
const inlineContent = (
  content: { text?: string }[],
  artifactPath: string,
): string | undefined => {
  const text = content.map((c) => c.text ?? '').join('\n');
  const marker = `\n--- ${artifactPath} ---\n`;
  const at = text.indexOf(marker);
  return at < 0 ? undefined : text.slice(at + marker.length);
};

/** The store generation directories holding this draft. */
const generationDirs = (
  env: ProposalEnv,
  id: string,
  draftHash: string | undefined,
): string[] => {
  if (!draftHash) return [];
  const gens = path.join(
    env.stateDir,
    'skill-workshop',
    'proposals',
    id,
    'generations',
  );
  return env.fs
    .listDirs(gens)
    .map((g) => path.join(gens, g))
    .filter((dir) => {
      const text = env.fs.readText(path.join(dir, PROPOSAL_FILE));
      return text !== undefined && sha256(text) === draftHash.toLowerCase();
    });
};

/**
 * List the pending proposals.
 *
 * @param invoke - Gateway tool invoker.
 * @returns Pending proposals as listed (no artifacts yet).
 */
export async function listPendingProposals(
  invoke: GatewayInvoker,
): Promise<z.infer<typeof listedSchema>[]> {
  const raw = await invoke('skill_workshop', {
    action: 'list',
    status: 'pending',
    limit: LIST_LIMIT,
  });
  const parsed = listResultSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      `skill_workshop list: unexpected result (${parsed.error.message})`,
    );
  return parsed.data.details.proposals.filter((p) => p.status === 'pending');
}

/** Inspect one artifact; the parsed result. */
const inspect = async (
  invoke: GatewayInvoker,
  id: string,
  artifactPath?: string,
): Promise<z.infer<typeof inspectResultSchema>> => {
  const raw = await invoke('skill_workshop', {
    action: 'inspect',
    proposal_id: id,
    ...(artifactPath ? { artifact_path: artifactPath } : {}),
  });
  const parsed = inspectResultSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(`skill_workshop inspect ${id}: unexpected result`);
  return parsed.data;
};

/**
 * Inspect one listed proposal and collect every artifact's text.
 *
 * @param env - Invoker, file system and state dir.
 * @param listed - The proposal as listed.
 * @returns The proposal with its artifacts.
 */
export async function loadProposal(
  env: ProposalEnv,
  listed: z.infer<typeof listedSchema>,
): Promise<PendingProposal> {
  const first = await inspect(env.invoke, listed.id);
  const { draftHash, targetSkillFile } = first.details;
  const available = first.details.inspect?.availableArtifacts ?? [];
  const gens = generationDirs(env, listed.id, draftHash);
  const artifacts: ProposalArtifact[] = [];
  for (const a of available) {
    // Any matching generation's draft is this draft; a support file only
    // when one generation matches.
    const gen = gens.length === 1 || a.path === PROPOSAL_FILE ? gens[0] : '';
    if (!isSafeRelative(a.path)) {
      artifacts.push({ ...a, source: 'missing' });
      continue;
    }
    const fromStore = gen ? env.fs.readText(path.join(gen, a.path)) : undefined;
    if (
      fromStore !== undefined &&
      Buffer.byteLength(fromStore) === a.sizeBytes
    ) {
      artifacts.push({ ...a, content: fromStore, source: 'store' });
      continue;
    }
    const result =
      a.path === PROPOSAL_FILE
        ? first
        : await inspect(env.invoke, listed.id, a.path);
    const inline = result.details.inspect?.contentIncluded
      ? inlineContent(result.content, a.path)
      : undefined;
    artifacts.push(
      inline === undefined
        ? { ...a, source: 'missing' }
        : { ...a, content: inline, source: 'gateway' },
    );
  }
  return {
    ...listed,
    ...(targetSkillFile ? { targetSkillFile } : {}),
    ...(draftHash ? { draftHash } : {}),
    artifacts,
  };
}

/**
 * Every pending proposal with its artifacts.
 *
 * @param env - Invoker, file system and state dir.
 * @returns The proposals, in list order.
 */
export async function gatherProposals(
  env: ProposalEnv,
): Promise<PendingProposal[]> {
  const listed = await listPendingProposals(env.invoke);
  const out: PendingProposal[] = [];
  for (const p of listed) out.push(await loadProposal(env, p));
  return out;
}
