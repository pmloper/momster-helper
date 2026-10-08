// Browser glue: loads the bundled Convex client and exposes window.MomsterCloud.
// Set CONVEX_URL to the deployment URL (public, safe to commit), e.g. "https://happy-animal-123.convex.cloud".
import { ConvexClient, anyApi } from "./vendor/convex.js";
import { createCloud } from "./cloud-core.js";

const CONVEX_URL = "";

window.MomsterCloud = createCloud({ ConvexClient, anyApi, url: CONVEX_URL, storage: window.localStorage });
window.dispatchEvent(new Event("momster-cloud-ready"));
