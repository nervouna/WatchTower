import "cloudflare:test";
import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      RUN_AUDIO_E2E: string;
    }
  }
}
