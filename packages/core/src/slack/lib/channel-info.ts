/**
 * @module slack/lib/channel-info
 *
 * What the poller knows about a channel, all of it read from Slack and
 * kept in the Slack cache (`{stateDir}/slack/channels.json`). Decisions we
 * make about a channel (project, home directory) are config, in
 * `slack.channels` (channel-config), never here.
 */

export interface ChannelInfo {
  name: string;
  /** `channel`, `dm` or `mpim`. */
  type: string;
  isPrivate?: boolean;
  isArchived?: boolean;
  isSlackConnect?: boolean;
  sharedTeams?: string[];
  /** Member user ids (`conversations.members`). */
  participants?: string[];
  /** When `participants` was last read from Slack (ISO). */
  participantsAt?: string;
  /** When the poller first saw the channel (ISO). */
  _autoDiscovered?: string;
  /** Gateway Slack account whose token reads the channel. */
  _account?: string;
  /** The channel's workspace (team id), for silo routing; see channel-workspace. */
  teamId?: string;
}
