import { MomentPlayer } from '@/features/media/MomentPlayer';

import type { ChatMedia } from './chat-logic';

/** A stored photo or video moment inside the chat, shown in the full player. */
export function MediaMoment({ media, topic }: { media: ChatMedia; topic?: string }) {
  return (
    <MomentPlayer momentAt={media.momentAt} kind={media.kind} path={media.path} topic={topic} />
  );
}
