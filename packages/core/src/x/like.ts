#!/usr/bin/env tsx
/**
 * @module like
 *
 * Processes the like queue by liking tweets via X API v2.
 *
 * Entry-point script invoked by the runner scheduler. Dequeues tweet IDs
 * from the x-like-{handle} runner queue and calls likePost from x-api
 * for each one, reporting success and failure counts.
 */

import { runXQueueAction } from './lib/run-x-queue-action.js';
import { likePost } from './lib/x-api.js';

runXQueueAction({
  scriptName: 'x/like',
  queuePrefix: 'x-like',
  actionLabel: 'like',
  successLabel: 'liked',
  actionFn: likePost,
});
