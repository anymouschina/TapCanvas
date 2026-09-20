import { startAtCanonicalOrigin } from './runtime/localOrigin'

// Import the application only after choosing the origin. Auth modules read
// cookies/storage at import time; OAuth/referral handlers also mutate the URL.
void startAtCanonicalOrigin(window.location, () => import('./main'))
