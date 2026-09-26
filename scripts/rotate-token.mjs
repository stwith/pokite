import { stateDirectory } from "../server/state-paths.mjs";
import { acquireInstanceLock } from "../server/instance-lock.mjs";
import {
  rotateAccessToken,
  clearSavedPushAccess,
} from "../server/access-token.mjs";
const directory = stateDirectory();
const release = acquireInstanceLock(directory);
try {
  clearSavedPushAccess(directory);
  rotateAccessToken(directory);
  console.log(
    "Access code reset. The old code no longer works on any network. Start Pokite and run npm run open. Agent accounts and sessions are unchanged.",
  );
} finally {
  release();
}
