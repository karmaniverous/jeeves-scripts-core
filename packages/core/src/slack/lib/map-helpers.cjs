/**
 * @module slack/lib/map-helpers
 *
 * CommonJS helpers for watcher inference rules: map Slack user ids to
 * emails and channel ids to channel metadata, from `users.json` and
 * `channels.json` next to this file.
 */

const fs = require('fs');
const path = require('path');
const USERS_FILE = path.join(__dirname, 'users.json');
const CHANNELS_FILE = path.join(__dirname, 'channels.json');

/** @typedef {Record<string, { emails?: string[] } | undefined>} UsersMap */
/** @typedef {Record<string, { metadata?: Record<string, unknown> } | undefined>} ChannelsMap */

/** @type {UsersMap | null} */
let usersCache = null;
/** @type {ChannelsMap | null} */
let channelsCache = null;

/** @returns {UsersMap} */
function loadUsers() {
  if (!usersCache)
    usersCache = /** @type {UsersMap} */ (
      JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))
    );
  return usersCache;
}

/** @returns {ChannelsMap} */
function loadChannels() {
  if (!channelsCache)
    channelsCache = /** @type {ChannelsMap} */ (
      JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf8'))
    );
  return channelsCache;
}

/**
 * @param {string | string[] | null | undefined} userIds
 * @returns {string[]}
 */
function resolveSlackUserEmails(userIds) {
  if (!userIds) return [];
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  const users = loadUsers();
  /** @type {string[]} */
  const emails = [];
  for (const id of ids) {
    const user = users[id];
    if (user?.emails) {
      for (const e of user.emails) emails.push(e);
    }
  }
  return emails;
}

/**
 * @param {unknown} channelId
 * @returns {Record<string, unknown>}
 */
function resolveSlackChannelMeta(channelId) {
  if (!channelId || typeof channelId !== 'string') return {};
  const channels = loadChannels();
  return channels[channelId]?.metadata ?? {};
}

module.exports = { resolveSlackUserEmails, resolveSlackChannelMeta };
