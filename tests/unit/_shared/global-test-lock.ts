import { createSerializedQueue } from "../../shared/light-helpers.ts";

export const withGlobalTestLock = createSerializedQueue();
