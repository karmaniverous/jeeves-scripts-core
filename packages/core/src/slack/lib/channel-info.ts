/**
 * @module slack/lib/channel-info
 *
 * The shape of a channel entry in slack/poll's `channels.json` registry.
 */

export interface ChannelInfo {
  name: string;
  type: string;
  isPrivate?: boolean;
  isArchived?: boolean;
  /** Legacy read position; migrated to runner state, never written. */
  lastTs?: string;
  metadata?: Record<string, unknown>;
  isSlackConnect?: boolean;
  sharedTeams?: string[];
  participants?: string[];
  _autoDiscovered?: string;
  _account?: string;
}
