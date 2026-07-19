import { CoverProcessingError } from "../cover/jobs";
import { ExplorationProcessingError } from "../exploration/jobs";

export const MAX_QUEUE_DELIVERY_ATTEMPTS = 3;

export function isTerminalQueueFailure(error: unknown, attempts: number): boolean {
  return attempts >= MAX_QUEUE_DELIVERY_ATTEMPTS ||
    (error instanceof ExplorationProcessingError && !error.retryable) ||
    (error instanceof CoverProcessingError && !error.retryable);
}
